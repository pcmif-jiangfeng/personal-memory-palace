import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { createMemoryInDatabase } from "../src/data/memory-write-repository.ts";
import { manageScopedMemory, readScopedMemory } from "../src/data/scoped-memory.ts";
import { configureScopedShare } from "../src/data/scoped-share.ts";
import { DatabaseSync } from "node:sqlite";
import { runDatabaseMigrations } from "../src/data/migrations.ts";

test("Memory creator is immutable and successful edits derive the editor from trusted scope", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["Owner", "Collaborator"].map((name) =>
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
      slug: "attribution",
    });
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, users[1].id);
    db.prepare(
      "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('photo',?,'Photo','image/webp','photo.webp',1,1,'now')",
    ).run(museum.id);
    const owner = { userId: users[0].id, museumId: museum.id };
    const member = { userId: users[1].id, museumId: museum.id };
    const memory = createMemoryInDatabase(
      db,
      { title: "Memory", story: "Story", photoIds: ["photo"], coverPhotoId: "photo" },
      member,
    );
    assert.equal(memory.createdByUserId, member.userId);
    assert.equal(memory.lastEditedByUserId, member.userId);
    assert.equal(readScopedMemory(db, owner, memory.id).createdByDisplayName, "Collaborator");
    manageScopedMemory(db, owner, memory.id, {
      action: "details",
      version: memory.version,
      title: "Updated",
      story: "Story",
      stageId: null,
    });
    let updated = readScopedMemory(db, owner, memory.id);
    assert.equal(updated.createdByUserId, member.userId);
    assert.equal(updated.lastEditedByUserId, owner.userId);
    assert.equal(updated.lastEditedByDisplayName, "Owner");
    manageScopedMemory(db, member, memory.id, { action: "note", content: "Later" });
    assert.equal(readScopedMemory(db, owner, memory.id).lastEditedByUserId, member.userId);
    assert.throws(() =>
      manageScopedMemory(db, owner, memory.id, {
        action: "details",
        version: readScopedMemory(db, owner, memory.id).version,
        title: "",
        story: "Story",
        stageId: null,
      }),
    );
    assert.equal(readScopedMemory(db, owner, memory.id).lastEditedByUserId, member.userId);
    configureScopedShare(db, owner, memory.id, { enabled: true, mode: "link" });
    updated = readScopedMemory(db, owner, memory.id);
    assert.equal(updated.createdByUserId, member.userId);
    assert.equal(updated.lastEditedByUserId, owner.userId);
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.throws(() =>
      manageScopedMemory(db, member, memory.id, { action: "publication", isPublic: false }),
    );
    assert.equal(readScopedMemory(db, owner, memory.id).lastEditedByUserId, owner.userId);
  } finally {
    db.close();
  }
});

test("migration 16 adds nullable attribution without inventing legacy authors and is idempotent", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE memories (id TEXT PRIMARY KEY,title TEXT,story TEXT); INSERT INTO memories VALUES ('legacy','Title','Story'); CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    const applied = db.prepare("INSERT INTO schema_migrations VALUES (?,'now')");
    db.exec(
      "CREATE TABLE stages (id TEXT PRIMARY KEY); CREATE TABLE museums (id TEXT PRIMARY KEY)",
    );
    for (let version = 1; version <= 15; version++) applied.run(version);
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    const memory = db.prepare("SELECT * FROM memories WHERE id='legacy'").get()!;
    assert.equal(memory.created_by_user_id, null);
    assert.equal(memory.last_edited_by_user_id, null);
    assert.equal(memory.story, "Story");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=16").get()!.n,
      1,
    );
    db.exec("PRAGMA foreign_keys=ON");
    assert.throws(() => db.prepare("UPDATE memories SET created_by_user_id='unknown'").run());
  } finally {
    db.close();
  }
});
