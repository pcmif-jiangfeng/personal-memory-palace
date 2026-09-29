import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { manageScopedMemory, readScopedMemory } from "../src/data/scoped-memory.ts";
import { parseMemoryAction } from "../src/http/schemas.ts";
import { ApiError } from "../src/http/errors.ts";
import { DatabaseSync } from "node:sqlite";
import { runDatabaseMigrations } from "../src/data/migrations.ts";

test("migration 18 gives legacy Memories version 1 without changing their content", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE memories (id TEXT PRIMARY KEY,story TEXT); INSERT INTO memories VALUES ('legacy','Keep Story'); CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    const record = db.prepare("INSERT INTO schema_migrations VALUES (?,'now')");
    db.exec("CREATE TABLE stages (id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE museums (id TEXT PRIMARY KEY)");
    for (let version = 1; version <= 17; version++) record.run(version);
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    assert.equal(db.prepare("SELECT version FROM memories").get()!.version, 1);
    assert.equal(db.prepare("SELECT story FROM memories").get()!.story, "Keep Story");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=18").get()!.n,
      1,
    );
    assert.throws(() => db.prepare("UPDATE memories SET version=0").run());
  } finally {
    db.close();
  }
});

test("two editors loading Memory version 5 cannot overwrite the first save", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["owner", "member"].map((name) =>
      createUserInDatabase(db, {
        email: `${name}@example.com`,
        displayName: name,
        passwordHash: "hash",
      }),
    );
    db.prepare("UPDATE users SET email_verified=1").run();
    const museum = createMuseumInDatabase(db, {
      ownerId: users[0].id,
      name: "Museum",
      slug: "versions",
    });
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, users[1].id);
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Before','Story','now','now')",
    ).run(museum.id);
    db.prepare("UPDATE memories SET version=5 WHERE id='memory'").run();
    const owner = { userId: users[0].id, museumId: museum.id };
    const member = { userId: users[1].id, museumId: museum.id };
    const a = readScopedMemory(db, owner, "memory");
    const b = readScopedMemory(db, member, "memory");
    assert.equal(a.version, 5);
    assert.equal(b.version, 5);
    manageScopedMemory(db, owner, "memory", {
      action: "details",
      title: "A saved",
      story: "A Story",
      stageId: null,
      version: a.version,
    });
    const saved = readScopedMemory(db, owner, "memory");
    assert.equal(saved.version, 6);
    assert.throws(
      () =>
        manageScopedMemory(db, member, "memory", {
          action: "details",
          title: "B stale",
          story: "B Story",
          stageId: null,
          version: b.version,
        }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "MEMORY_VERSION_CONFLICT" &&
        error.status === 409,
    );
    assert.deepEqual(readScopedMemory(db, owner, "memory"), saved);
    manageScopedMemory(db, member, "memory", {
      action: "details",
      title: "B reloaded",
      story: "B Story",
      stageId: null,
      version: 6,
    });
    assert.equal(readScopedMemory(db, owner, "memory").version, 7);
    const beforeFailure = readScopedMemory(db, owner, "memory");
    db.exec(
      "CREATE TRIGGER fail_editor BEFORE UPDATE OF last_edited_by_user_id ON memories BEGIN SELECT RAISE(ABORT,'editor failure'); END",
    );
    assert.throws(
      () =>
        manageScopedMemory(db, owner, "memory", {
          action: "details",
          title: "Roll back",
          story: "Story",
          stageId: null,
          version: 7,
        }),
      /editor failure/,
    );
    assert.deepEqual(readScopedMemory(db, owner, "memory"), beforeFailure);
    assert.throws(() =>
      manageScopedMemory(db, owner, "memory", {
        action: "details",
        title: "",
        story: "Story",
        stageId: null,
        version: 7,
      }),
    );
    assert.equal(readScopedMemory(db, owner, "memory").version, 7);
  } finally {
    db.close();
  }
});

test("Memory basic-info save requires a positive safe integer version", async () => {
  for (const version of [undefined, null, 0, -1, 1.5, "5", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      parseMemoryAction(
        new Request("http://localhost/api/memories/memory", {
          method: "POST",
          body: JSON.stringify({ action: "details", title: "Title", story: "Story", version }),
        }),
      ),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_MEMORY_VERSION",
    );
  }
});
