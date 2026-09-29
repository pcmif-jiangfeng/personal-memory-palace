import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase, findMuseumByIdInDatabase } from "../src/data/museum-repository.ts";
import { createScopedStage, manageScopedStage, readScopedStage } from "../src/data/scoped-stage.ts";
import { updateOwnMuseumProfileInDatabase } from "../src/data/museum-profile.ts";
import { ApiError } from "../src/http/errors.ts";
import { DatabaseSync } from "node:sqlite";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { parseStageInput } from "../src/http/schemas.ts";
import { parseUpdateMuseumProfile } from "../src/http/museum-profile.ts";

test("Stage migration 19 is additive and idempotent", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE stages (id TEXT PRIMARY KEY,title TEXT); INSERT INTO stages VALUES ('legacy','Keep Chapter'); CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    const record = db.prepare("INSERT INTO schema_migrations VALUES (?,'now')");
    db.exec("CREATE TABLE museums (id TEXT PRIMARY KEY)");
    for (let version = 1; version <= 18; version++) record.run(version);
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    assert.equal(db.prepare("SELECT version FROM stages").get()!.version, 1);
    assert.equal(db.prepare("SELECT title FROM stages").get()!.title, "Keep Chapter");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=19").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});

test("Stage edits and Museum Profile saves require valid versions but Stage creation does not", async () => {
  const request = (version: unknown) =>
    new Request("http://localhost/api", {
      method: "PUT",
      body: JSON.stringify({
        title: "Chapter",
        name: "Museum",
        description: "",
        coverPhotoId: null,
        version,
      }),
    });
  for (const version of [undefined, null, 0, -1, "5", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(parseStageInput(request(version), true), /INVALID_STAGE_VERSION/);
    await assert.rejects(parseUpdateMuseumProfile(request(version)), /INVALID_MUSEUM_VERSION/);
  }
  assert.equal((await parseStageInput(request(undefined))).title, "Chapter");
});

test("Stage stale saves cannot replace details, cover or actor and failed writes roll back the version", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const owner = createUserInDatabase(db, {
      email: "owner@example.com",
      displayName: "Owner",
      passwordHash: "hash",
    });
    db.prepare("UPDATE users SET email_verified=1").run();
    const museum = createMuseumInDatabase(db, {
      ownerId: owner.id,
      name: "Museum",
      slug: "stage-version",
    });
    const scope = { userId: owner.id, museumId: museum.id };
    for (const id of ["cover-a", "cover-b"])
      db.prepare(
        "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES (?,?,'Photo','image/webp',?,1,1,'now')",
      ).run(id, museum.id, `${id}.webp`);
    const stage = createScopedStage(db, scope, { title: "Chapter", coverPhotoId: "cover-a" });
    db.prepare("UPDATE stages SET version=5 WHERE id=?").run(stage.id);
    manageScopedStage(db, scope, stage.id, {
      action: "details",
      input: { title: "A saved", version: 5, coverPhotoId: "cover-a" },
    });
    const saved = readScopedStage(db, scope, stage.id);
    assert.equal(saved.version, 6);
    assert.throws(
      () =>
        manageScopedStage(db, scope, stage.id, {
          action: "details",
          input: { title: "B stale", version: 5, coverPhotoId: "cover-b" },
        }),
      (e: unknown) =>
        e instanceof ApiError && e.code === "STAGE_VERSION_CONFLICT" && e.status === 409,
    );
    assert.deepEqual(readScopedStage(db, scope, stage.id), saved);
    assert.equal(saved.coverKey, "cover-a.webp");
    db.exec(
      "CREATE TRIGGER fail_stage_editor BEFORE UPDATE OF last_edited_by_user_id ON stages BEGIN SELECT RAISE(ABORT,'editor failure'); END",
    );
    assert.throws(
      () =>
        manageScopedStage(db, scope, stage.id, {
          action: "details",
          input: { title: "Rollback", version: 6 },
        }),
      /editor failure/,
    );
    assert.deepEqual(readScopedStage(db, scope, stage.id), saved);
  } finally {
    db.close();
  }
});

test("Museum Profile requires the loaded version even when stale values equal current values", () => {
  const db = initializeDatabase(":memory:", false);
  try {
    const user = createUserInDatabase(db, {
      email: "profile@example.com",
      displayName: "Owner",
      passwordHash: "hash",
    });
    const museum = createMuseumInDatabase(db, {
      ownerId: user.id,
      name: "Museum",
      slug: "profile-version",
    });
    db.exec("UPDATE users SET email_verified=1");
    const input = {
      name: "A saved",
      description: "About",
      coverPhotoId: null,
      version: museum.version,
    };
    const updated = updateOwnMuseumProfileInDatabase(db, user.id, input);
    assert.equal(updated.version, 2);
    assert.throws(
      () => updateOwnMuseumProfileInDatabase(db, user.id, { ...input, name: "B stale" }),
      (e: unknown) =>
        e instanceof ApiError && e.code === "MUSEUM_VERSION_CONFLICT" && e.status === 409,
    );
    assert.throws(() => updateOwnMuseumProfileInDatabase(db, user.id, input));
    assert.deepEqual(findMuseumByIdInDatabase(db, museum.id), updated);
    assert.deepEqual(
      updateOwnMuseumProfileInDatabase(db, user.id, { ...input, version: updated.version }),
      updated,
    );
  } finally {
    db.close();
  }
});
