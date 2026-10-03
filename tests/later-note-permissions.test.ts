import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { manageScopedMemory } from "../src/data/scoped-memory.ts";
import { manageScopedLaterNote } from "../src/data/scoped-later-note.ts";
import { readScopedMemory } from "../src/data/scoped-memory.ts";
import { configureScopedShare } from "../src/data/scoped-share.ts";
import { getSharedMemoryInDatabase } from "../src/data/share-repository.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "author", "peer", "foreign"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museum = createMuseumInDatabase(db, { ownerId: users[0].id, name: "Notes", slug: "notes" });
  for (const user of users.slice(1, 3))
    db.prepare(
      "INSERT INTO museum_memberships(museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, user.id);
  db.prepare(
    "INSERT INTO memories(id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Title','Original','now','now')",
  ).run(museum.id);
  const scopes = users.map((user) => ({ museumId: museum.id, userId: user.id }));
  manageScopedMemory(db, scopes[1], "memory", { action: "note", content: "Author note" });
  const note = () => db.prepare("SELECT * FROM later_notes WHERE memory_id='memory'").get()!;
  return { db, scopes, note, id: String(note().id) };
}

test("active notes expose only safe author metadata; trash disappears from Memory and sharing", () => {
  const { db, scopes, id } = fixture();
  try {
    const token = configureScopedShare(db, scopes[0], "memory", {
      enabled: true,
      mode: "link",
      password: "",
      rotate: false,
    })!;
    const note = readScopedMemory(db, scopes[1], "memory").laterNotes[0];
    assert.equal(note.authorUserId, scopes[1].userId);
    assert.equal(note.authorDisplayName, "author");
    assert.equal(note.trashedAt, null);
    assert.equal(note.version, 1);
    assert.ok(!JSON.stringify(note).includes("author@example.com"));
    assert.equal(getSharedMemoryInDatabase(db, token)!.laterNotes[0].authorUserId, null);
    manageScopedLaterNote(db, scopes[1], id, { action: "trash" });
    assert.deepEqual(readScopedMemory(db, scopes[0], "memory").laterNotes, []);
    assert.deepEqual(getSharedMemoryInDatabase(db, token)!.laterNotes, []);
    manageScopedLaterNote(db, scopes[0], id, { action: "restore" });
    assert.equal(getSharedMemoryInDatabase(db, token)!.laterNotes.length, 1);
  } finally {
    db.close();
  }
});

test("migration 32 preserves unknown legacy authors and note text, and runs once", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE later_notes(id TEXT PRIMARY KEY, content TEXT, created_at TEXT); INSERT INTO later_notes VALUES ('legacy','Keep','then'); CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT)",
    );
    for (let version = 1; version <= 31; version++)
      db.prepare("INSERT INTO schema_migrations VALUES (?,'then')").run(version);
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    const row = db.prepare("SELECT * FROM later_notes").get()!;
    assert.equal(row.author_user_id, null);
    assert.equal(row.trashed_at, null);
    assert.equal(row.content, "Keep");
    assert.equal(row.created_at, "then");
    assert.equal(row.version, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=32").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});

test("new notes use the authenticated author; only that author edits and stale edits cannot overwrite", () => {
  const { db, scopes, note, id } = fixture();
  try {
    assert.equal(note().author_user_id, scopes[1].userId);
    assert.equal(note().museum_id, scopes[1].museumId);
    for (const scope of [scopes[0], scopes[2], scopes[3]])
      assert.throws(() =>
        manageScopedLaterNote(db, scope, id, { action: "update", content: "Hijack", version: 1 }),
      );
    manageScopedLaterNote(db, scopes[1], id, { action: "update", content: "Updated", version: 1 });
    assert.equal(note().content, "Updated");
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[1], id, { action: "update", content: "Stale", version: 1 }),
    );
    assert.equal(note().content, "Updated");
    assert.equal(db.prepare("SELECT story FROM memories").get()!.story, "Original");
  } finally {
    db.close();
  }
});

test("author and owner may trash/restore; only owner may permanently delete a trashed note", () => {
  const { db, scopes, note, id } = fixture();
  try {
    assert.throws(() => manageScopedLaterNote(db, scopes[2], id, { action: "trash" }));
    manageScopedLaterNote(db, scopes[1], id, { action: "trash" });
    assert.ok(note().trashed_at);
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[1], id, { action: "permanent", confirm: true }),
    );
    manageScopedLaterNote(db, scopes[0], id, { action: "restore" });
    assert.equal(note().trashed_at, null);
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[0], id, { action: "permanent", confirm: true }),
    );
    manageScopedLaterNote(db, scopes[0], id, { action: "trash" });
    manageScopedLaterNote(db, scopes[1], id, { action: "restore" });
    manageScopedLaterNote(db, scopes[0], id, { action: "trash" });
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[0], id, { action: "permanent", confirm: false }),
    );
    manageScopedLaterNote(db, scopes[0], id, { action: "permanent", confirm: true });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM later_notes").get()!.n, 0);
  } finally {
    db.close();
  }
});

test("unknown authors are not assigned to owner; departed and frozen members have no note operations", () => {
  const { db, scopes, note, id } = fixture();
  try {
    db.prepare("UPDATE later_notes SET author_user_id=NULL").run();
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[0], id, { action: "update", content: "Guess", version: 1 }),
    );
    manageScopedLaterNote(db, scopes[0], id, { action: "trash" });
    manageScopedLaterNote(db, scopes[0], id, { action: "restore" });
    db.prepare("UPDATE later_notes SET author_user_id=?").run(scopes[1].userId);
    db.prepare("UPDATE museum_memberships SET status='revoked' WHERE user_id=?").run(
      scopes[1].userId,
    );
    for (const action of ["trash", "restore"] as const)
      assert.throws(() => manageScopedLaterNote(db, scopes[1], id, { action }));
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[1], id, {
        action: "update",
        content: "Gone",
        version: Number(note().version),
      }),
    );
    db.prepare("UPDATE museums SET status='pending_deletion'").run();
    assert.throws(() => manageScopedLaterNote(db, scopes[0], id, { action: "trash" }));
    assert.equal(note().trashed_at, null);
  } finally {
    db.close();
  }
});

test("note mutation and audit roll back together; invalid content and cross-palace scope cannot write", () => {
  const { db, scopes, note, id } = fixture();
  try {
    const before = note();
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[1], id, { action: "update", content: " ", version: 1 }),
    );
    assert.throws(() =>
      manageScopedLaterNote(db, { ...scopes[1], museumId: "foreign" }, id, { action: "trash" }),
    );
    db.exec(
      "CREATE TRIGGER fail_note_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    );
    assert.throws(() =>
      manageScopedLaterNote(db, scopes[1], id, {
        action: "update",
        content: "Rollback",
        version: 1,
      }),
    );
    assert.deepEqual(note(), before);
  } finally {
    db.close();
  }
});
