import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { writeAuditLogInDatabase, type WriteAuditLogInput } from "../src/data/audit-log.ts";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const actor = createUserInDatabase(db, {
    email: "audit@example.com",
    passwordHash: "test-hash",
    displayName: "Actor",
  });
  const museum = createMuseumInDatabase(db, {
    ownerId: actor.id,
    name: "Audit Museum",
    slug: "audit-museum",
  });
  const input: WriteAuditLogInput = {
    actorUserId: actor.id,
    museumId: museum.id,
    action: "memory.update",
    objectType: "memory",
    objectId: "memory-deleted-later",
  };
  return { db, input };
}

test("migration 20 preserves existing content, creates audit storage and runs once", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY,display_name TEXT);
      CREATE TABLE museums (id TEXT PRIMARY KEY);
      CREATE TABLE memories (id TEXT PRIMARY KEY, story TEXT);
      INSERT INTO users (id) VALUES ('actor');
      INSERT INTO museums VALUES ('museum');
      INSERT INTO memories VALUES ('memory', 'Keep this story');
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    `);
    const record = db.prepare("INSERT INTO schema_migrations VALUES (?, 'before-h1')");
    for (let version = 1; version <= 19; version++) record.run(version);
    runDatabaseMigrations(db);
    const entry = writeAuditLogInDatabase(db, {
      actorUserId: "actor",
      museumId: "museum",
      action: "memory.update",
      objectType: "memory",
      objectId: "memory",
    });
    runDatabaseMigrations(db);
    assert.equal(db.prepare("SELECT story FROM memories").get()?.story, "Keep this story");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 1);
    assert.equal(db.prepare("SELECT id FROM audit_logs").get()?.id, entry.id);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 20").get()?.n,
      1,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const indexes = db
      .prepare("PRAGMA index_list(audit_logs)")
      .all()
      .map((row) => row.name);
    assert.ok(indexes.includes("audit_logs_museum_timestamp"));
    assert.ok(indexes.includes("audit_logs_museum_object_timestamp"));
  } finally {
    db.close();
  }
});

test("migration 34 leaves old nicknames unknown and clears only explicitly deleted object details", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE audit_logs(id TEXT PRIMARY KEY,museum_id TEXT,object_type TEXT,object_id TEXT,action TEXT,diff TEXT);
      INSERT INTO audit_logs VALUES
      ('a','palace','memory','same','memory.details','private'),
      ('b','palace','memory','same','memory.permanent','private'),
      ('c','other','memory','same','memory.details','keep'),
      ('d','palace','stage','same','stage.details','keep'),
      ('e','palace','memory','live','memory.details','keep');`);
    const record = db.prepare("INSERT INTO schema_migrations VALUES (?,'old')");
    for (let version = 1; version <= 33; version++) record.run(version);
    runDatabaseMigrations(db);
    const rows = db.prepare("SELECT * FROM audit_logs ORDER BY id").all();
    assert.deepEqual(
      rows.map((row) => row.diff),
      [null, null, "keep", "keep", "keep"],
    );
    assert.ok(rows.every((row) => row.actor_name === null));
    runDatabaseMigrations(db);
    assert.deepEqual(db.prepare("SELECT * FROM audit_logs ORDER BY id").all(), rows);
  } finally {
    db.close();
  }
});

test("audit nickname snapshots survive profile changes; historical snapshots stay unknown", () => {
  const { db, input } = fixture();
  try {
    const first = writeAuditLogInDatabase(db, input);
    db.prepare("UPDATE users SET display_name='Renamed' WHERE id=?").run(input.actorUserId);
    const second = writeAuditLogInDatabase(db, input);
    assert.equal(
      db.prepare("SELECT actor_name FROM audit_logs WHERE id=?").get(first.id)!.actor_name,
      "Actor",
    );
    assert.equal(
      db.prepare("SELECT actor_name FROM audit_logs WHERE id=?").get(second.id)!.actor_name,
      "Renamed",
    );
    db.prepare("UPDATE audit_logs SET actor_name=NULL WHERE id=?").run(first.id);
    assert.equal(
      db.prepare("SELECT actor_name FROM audit_logs WHERE id=?").get(first.id)!.actor_name,
      null,
    );
  } finally {
    db.close();
  }
});

test("writer persists actor, museum, object, server timestamp and optional JSON diff", () => {
  const { db, input } = fixture();
  try {
    const action = "memory.update'); DROP TABLE museums; --";
    const diff = {
      title: { before: "旧标题", after: "新标题" },
      photoIds: ["a", "b"],
      cover: null,
    };
    const start = Date.now();
    const entry = writeAuditLogInDatabase(db, { ...input, action, diff });
    const row = db.prepare("SELECT * FROM audit_logs WHERE id = ?").get(entry.id)!;
    assert.match(entry.id, /^[0-9a-f-]{36}$/);
    assert.equal(row.actor_user_id, input.actorUserId);
    assert.equal(row.museum_id, input.museumId);
    assert.equal(row.action, action);
    assert.equal(row.object_type, input.objectType);
    assert.equal(row.object_id, input.objectId);
    assert.equal(row.timestamp, entry.timestamp);
    assert.ok(Date.parse(entry.timestamp) >= start && Date.parse(entry.timestamp) <= Date.now());
    assert.deepEqual(JSON.parse(String(row.diff)), diff);
    const withoutDiff = writeAuditLogInDatabase(db, input);
    assert.notEqual(entry.id, withoutDiff.id);
    assert.equal(
      db.prepare("SELECT diff FROM audit_logs WHERE id = ?").get(withoutDiff.id)?.diff,
      null,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM museums").get()?.n, 1);
  } finally {
    db.close();
  }
});

test("writer rejects missing actors, museums and blank required fields without inserting", () => {
  const { db, input } = fixture();
  try {
    for (const field of ["actorUserId", "museumId", "action", "objectType", "objectId"] as const) {
      assert.throws(() => writeAuditLogInDatabase(db, { ...input, [field]: "  " }), /required/);
    }
    assert.throws(
      () => writeAuditLogInDatabase(db, { ...input, actorUserId: "unknown" }),
      /FOREIGN KEY/,
    );
    assert.throws(
      () => writeAuditLogInDatabase(db, { ...input, museumId: "unknown" }),
      /FOREIGN KEY/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
  } finally {
    db.close();
  }
});

test("diff rejects lossy or invalid JSON rather than silently dropping values", () => {
  const { db, input } = fixture();
  try {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const diff of [
      null,
      [],
      { n: NaN },
      { n: Infinity },
      { n: 1n },
      { n: undefined },
      { n: new Date() },
      { n: new Map([["key", "value"]]) },
      cycle,
    ]) {
      assert.throws(() =>
        writeAuditLogInDatabase(db, {
          ...input,
          diff: diff as WriteAuditLogInput["diff"],
        }),
      );
    }
    const insert = db.prepare(`INSERT INTO audit_logs
      (id, actor_user_id, museum_id, action, object_type, object_id, timestamp, diff)
      VALUES ('invalid', ?, ?, 'update', 'memory', 'id', 'now', ?)`);
    for (const diff of ["invalid-json", "[]", "null", "42"]) {
      assert.throws(() => insert.run(input.actorUserId, input.museumId, diff), /CHECK constraint/);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
  } finally {
    db.close();
  }
});

test("business changes and audit entries commit or roll back together", () => {
  const { db, input } = fixture();
  try {
    const rename = () =>
      db.prepare("UPDATE museums SET name = 'Changed' WHERE id = ?").run(input.museumId);
    assert.throws(
      () =>
        withTransaction(db, () => {
          rename();
          writeAuditLogInDatabase(db, input);
          throw new Error("business failure");
        }),
      /business failure/,
    );
    assert.equal(db.prepare("SELECT name FROM museums").get()?.name, "Audit Museum");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
    assert.throws(
      () =>
        withTransaction(db, () => {
          rename();
          writeAuditLogInDatabase(db, { ...input, actorUserId: "missing" });
        }),
      /FOREIGN KEY/,
    );
    assert.equal(db.prepare("SELECT name FROM museums").get()?.name, "Audit Museum");
    withTransaction(db, () => {
      rename();
      writeAuditLogInDatabase(db, input);
    });
    assert.equal(db.prepare("SELECT name FROM museums").get()?.name, "Changed");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 1);
  } finally {
    db.close();
  }
});

test("deleting an actor preserves the event; deleting a museum requires explicit audit cleanup", () => {
  const { db, input } = fixture();
  try {
    const actor = createUserInDatabase(db, {
      email: "collaborator@example.com",
      passwordHash: "test-hash",
      displayName: "Collaborator",
    });
    const entry = writeAuditLogInDatabase(db, { ...input, actorUserId: actor.id });
    db.prepare("DELETE FROM users WHERE id = ?").run(actor.id);
    assert.equal(
      db.prepare("SELECT actor_name FROM audit_logs WHERE id=?").get(entry.id)!.actor_name,
      "Collaborator",
    );
    assert.equal(
      db.prepare("SELECT actor_user_id FROM audit_logs WHERE id = ?").get(entry.id)?.actor_user_id,
      null,
    );
    assert.throws(
      () => db.prepare("DELETE FROM museums WHERE id = ?").run(input.museumId),
      /FOREIGN KEY/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 1);
  } finally {
    db.close();
  }
});
