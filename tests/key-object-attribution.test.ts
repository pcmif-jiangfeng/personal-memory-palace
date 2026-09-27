import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase, findMuseumByIdInDatabase } from "../src/data/museum-repository.ts";
import { createScopedStage, manageScopedStage, readScopedStage } from "../src/data/scoped-stage.ts";
import { updateOwnMuseumProfileInDatabase } from "../src/data/museum-profile.ts";
import { updateOwnMuseumSlugInDatabase } from "../src/data/museum-slug.ts";
import { DatabaseSync } from "node:sqlite";
import { runDatabaseMigrations } from "../src/data/migrations.ts";

test("migration 17 preserves unknown historical Stage and Museum actors and runs once", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE stages (id TEXT PRIMARY KEY,title TEXT); INSERT INTO stages VALUES ('legacy','Chapter'); CREATE TABLE museums (id TEXT PRIMARY KEY,name TEXT); INSERT INTO museums VALUES ('museum','Museum'); CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    const record = db.prepare("INSERT INTO schema_migrations VALUES (?,'now')");
    db.exec("CREATE TABLE memories (id TEXT PRIMARY KEY)");
    for (let version = 1; version <= 16; version++) record.run(version);
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    const stage = db.prepare("SELECT * FROM stages").get()!;
    assert.equal(stage.title, "Chapter");
    assert.equal(stage.created_by_user_id, null);
    assert.equal(stage.last_edited_by_user_id, null);
    assert.equal(
      db.prepare("SELECT last_edited_by_user_id FROM museums").get()!.last_edited_by_user_id,
      null,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=17").get()!.n,
      1,
    );
    assert.throws(() => db.prepare("UPDATE stages SET created_by_user_id='missing'").run());
  } finally {
    db.close();
  }
});

test("Stage creation and successful edits use trusted actors without changing its creator", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const users = ["Owner", "Member"].map((name) =>
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
      slug: "actor",
    });
    db.prepare(
      "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
    ).run(museum.id, users[1].id);
    const owner = { userId: users[0].id, museumId: museum.id };
    const member = { userId: users[1].id, museumId: museum.id };
    const stage = createScopedStage(db, member, { title: "Chapter" });
    assert.equal(stage.createdByUserId, member.userId);
    assert.equal(stage.lastEditedByUserId, member.userId);
    const updated = manageScopedStage(db, owner, stage.id, {
      action: "details",
      input: { title: "Updated", version: stage.version },
    })!;
    assert.equal(updated.createdByUserId, member.userId);
    assert.equal(updated.lastEditedByUserId, owner.userId);
    assert.equal(updated.createdByDisplayName, "Member");
    db.exec(
      "CREATE TRIGGER fail_actor BEFORE UPDATE OF last_edited_by_user_id ON stages BEGIN SELECT RAISE(ABORT,'actor failure'); END",
    );
    assert.throws(
      () =>
        manageScopedStage(db, member, stage.id, {
          action: "details",
          input: { title: "Must roll back", version: updated.version },
        }),
      /actor failure/,
    );
    assert.equal(readScopedStage(db, owner, stage.id).title, "Updated");
    assert.equal(readScopedStage(db, owner, stage.id).lastEditedByUserId, owner.userId);
    db.exec("DROP TRIGGER fail_actor");
    manageScopedStage(db, member, stage.id, { action: "publication", isPublic: false });
    assert.throws(() =>
      manageScopedStage(db, owner, stage.id, {
        action: "details",
        input: { title: "", version: readScopedStage(db, owner, stage.id).version },
      }),
    );
    assert.equal(readScopedStage(db, owner, stage.id).lastEditedByUserId, member.userId);
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.throws(() =>
      manageScopedStage(db, member, stage.id, { action: "publication", isPublic: true }),
    );
    manageScopedStage(db, owner, stage.id, { action: "trash" });
    manageScopedStage(db, owner, stage.id, { action: "restore" });
    assert.equal(readScopedStage(db, owner, stage.id).lastEditedByUserId, owner.userId);
    assert.equal(readScopedStage(db, owner, stage.id).createdByUserId, member.userId);
  } finally {
    db.close();
  }
});

test("Museum settings record the owner on changes but preserve attribution on no-op and failure", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const owner = createUserInDatabase(db, {
      email: "owner@example.com",
      displayName: "Owner",
      passwordHash: "hash",
    });
    const museum = createMuseumInDatabase(db, {
      ownerId: owner.id,
      name: "Museum",
      slug: "settings",
    });
    assert.equal(museum.lastEditedByUserId, null);
    const unchanged = updateOwnMuseumProfileInDatabase(db, owner.id, {
      name: "Museum",
      description: "",
      coverPhotoId: null,
      version: museum.version,
    });
    assert.equal(unchanged.lastEditedByUserId, null);
    assert.throws(() =>
      updateOwnMuseumProfileInDatabase(db, owner.id, {
        name: "Other",
        description: "",
        coverPhotoId: "missing",
        version: museum.version,
      }),
    );
    assert.equal(findMuseumByIdInDatabase(db, museum.id)!.lastEditedByUserId, null);
    const updated = updateOwnMuseumProfileInDatabase(db, owner.id, {
      name: "Updated",
      description: "About",
      coverPhotoId: null,
      version: museum.version,
    });
    assert.equal(updated.lastEditedByUserId, owner.id);
    assert.equal(updated.lastEditedByDisplayName, "Owner");
    db.prepare("UPDATE museums SET last_edited_by_user_id=NULL WHERE id=?").run(museum.id);
    assert.equal(updateOwnMuseumSlugInDatabase(db, owner.id, "settings").lastEditedByUserId, null);
    assert.equal(
      updateOwnMuseumSlugInDatabase(db, owner.id, "new-settings").lastEditedByUserId,
      owner.id,
    );
  } finally {
    db.close();
  }
});
