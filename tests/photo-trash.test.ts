import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { museumPhotoStorageKey } from "../src/data/photo-access.ts";
import { manageScopedPhotoTrash } from "../src/data/photo-trash.ts";
import { deleteUploadedPhotoInDatabase } from "../src/data/photo-deletion-service.ts";
import { queryWorkspacePhotoCatalogInDatabase } from "../src/data/photo-repository.ts";
import { manageScopedMemory, readScopedMemory } from "../src/data/scoped-memory.ts";
import { configureScopedShare } from "../src/data/scoped-share.ts";
import {
  getSharedMemoryInDatabase,
  isSharedImageAccessibleInDatabase,
} from "../src/data/share-repository.ts";
import { isPhotoMediaAvailable } from "../src/data/photo-access.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "foreign"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museum = createMuseumInDatabase(db, {
    ownerId: users[0].id,
    name: "Photos",
    slug: "photo-trash",
  });
  db.prepare(
    "INSERT INTO museum_memberships(museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museum.id, users[1].id);
  const key = museumPhotoStorageKey(museum.id);
  db.prepare(
    "INSERT INTO uploaded_photos(id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at,library_archived_at) VALUES ('photo',?,'Original','image/webp',?,1,1,'then','archived')",
  ).run(museum.id, key);
  db.prepare(
    "INSERT INTO memories(id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Title','Story','now','now')",
  ).run(museum.id);
  db.prepare(
    "INSERT INTO memory_images(id,memory_id,museum_id,storage_key,created_at,is_cover) VALUES ('image','memory',?,?,'then',1)",
  ).run(museum.id, key);
  db.prepare("UPDATE museums SET storage_used_bytes=123,storage_usage_ready=1 WHERE id=?").run(
    museum.id,
  );
  db.prepare(
    "INSERT INTO photo_asset_usage(storage_key,museum_id,bytes,state) VALUES (?,?,123,'stored')",
  ).run(key, museum.id);
  return { db, key, scopes: users.map((user) => ({ userId: user.id, museumId: museum.id })) };
}

test("trash is excluded from catalogs, Memory images and shared media; restoration reconnects existing references", () => {
  const { db, key, scopes } = fixture();
  try {
    const token = configureScopedShare(db, scopes[0], "memory", {
      enabled: true,
      mode: "link",
      password: "",
      rotate: false,
    })!;
    assert.equal(readScopedMemory(db, scopes[1], "memory").images.length, 1);
    manageScopedPhotoTrash(db, scopes[1], "photo", "trash");
    assert.equal(
      queryWorkspacePhotoCatalogInDatabase(db, { source: "library" }, scopes[0].museumId).items
        .length,
      0,
    );
    assert.equal(readScopedMemory(db, scopes[1], "memory").images.length, 0);
    assert.equal(readScopedMemory(db, scopes[1], "memory").coverKey, null);
    assert.equal(getSharedMemoryInDatabase(db, token)!.images.length, 0);
    assert.equal(isPhotoMediaAvailable(db, key), false);
    assert.equal(isSharedImageAccessibleInDatabase(db, token, key), false);
    assert.throws(
      () =>
        manageScopedMemory(db, scopes[1], "memory", {
          action: "setCover",
          photoId: "photo",
          version: 1,
        }),
      (error: unknown) => error instanceof Error && error.message === "INVALID_MEMORY_BINDING",
    );
    manageScopedPhotoTrash(db, scopes[0], "photo", "restore");
    assert.equal(
      queryWorkspacePhotoCatalogInDatabase(db, { source: "library" }, scopes[0].museumId).items
        .length,
      1,
    );
    assert.equal(getSharedMemoryInDatabase(db, token)!.images.length, 1);
    assert.equal(isPhotoMediaAvailable(db, key), true);
  } finally {
    db.close();
  }
});

test("migration 33 adds an empty trash state without changing historical archive state or file keys", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE uploaded_photos(id TEXT PRIMARY KEY,optimized_storage_key TEXT,library_archived_at TEXT); INSERT INTO uploaded_photos VALUES ('legacy','Keep key','Keep archive'); CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT)",
    );
    for (let version = 1; version <= 32; version++)
      db.prepare("INSERT INTO schema_migrations VALUES (?,'then')").run(version);
    runDatabaseMigrations(db);
    runDatabaseMigrations(db);
    const row = db.prepare("SELECT * FROM uploaded_photos").get()!;
    assert.equal(row.trashed_at, null);
    assert.equal(row.optimized_storage_key, "Keep key");
    assert.equal(row.library_archived_at, "Keep archive");
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=33").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});

test("soft trash and restore retain physical keys, archive status, references and accounted bytes", () => {
  const { db, scopes } = fixture();
  try {
    const before = db.prepare("SELECT * FROM uploaded_photos").get()!;
    const references = db.prepare("SELECT * FROM memory_images").all();
    const ledger = db.prepare("SELECT * FROM photo_asset_usage").all();
    manageScopedPhotoTrash(db, scopes[1], "photo", "trash");
    const trashed = db.prepare("SELECT * FROM uploaded_photos").get()!;
    assert.ok(trashed.trashed_at);
    assert.deepEqual({ ...trashed, trashed_at: null }, { ...before });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM photo_deletion_jobs").get()!.n, 0);
    assert.equal(
      db.prepare("SELECT storage_used_bytes FROM museums").get()!.storage_used_bytes,
      123,
    );
    assert.deepEqual(db.prepare("SELECT * FROM memory_images").all(), references);
    assert.deepEqual(db.prepare("SELECT * FROM photo_asset_usage").all(), ledger);
    manageScopedPhotoTrash(db, scopes[0], "photo", "restore");
    assert.deepEqual(db.prepare("SELECT * FROM uploaded_photos").get(), before);
    assert.deepEqual(db.prepare("SELECT * FROM memory_images").all(), references);
  } finally {
    db.close();
  }
});

test("foreign, revoked, unverified and frozen actors cannot trash or restore photos", () => {
  const { db, scopes } = fixture();
  try {
    assert.throws(() => manageScopedPhotoTrash(db, scopes[2], "photo", "trash"));
    db.prepare("UPDATE users SET email_verified=0 WHERE id=?").run(scopes[1].userId);
    assert.throws(() => manageScopedPhotoTrash(db, scopes[1], "photo", "trash"));
    db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(scopes[1].userId);
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.throws(() => manageScopedPhotoTrash(db, scopes[1], "photo", "trash"));
    db.prepare("UPDATE museums SET status='pending_deletion'").run();
    assert.throws(() => manageScopedPhotoTrash(db, scopes[0], "photo", "trash"));
    assert.equal(db.prepare("SELECT trashed_at FROM uploaded_photos").get()!.trashed_at, null);
  } finally {
    db.close();
  }
});

test("referenced trash cannot be permanently deleted; collaborator still cannot physically delete", async () => {
  const { db, scopes } = fixture();
  try {
    manageScopedPhotoTrash(db, scopes[1], "photo", "trash");
    let removed = false;
    const storage = {
      remove: async () => {
        removed = true;
      },
    };
    await assert.rejects(deleteUploadedPhotoInDatabase(db, storage, "photo", scopes[1]));
    await assert.rejects(deleteUploadedPhotoInDatabase(db, storage, "photo", scopes[0]));
    assert.equal(removed, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 1);
  } finally {
    db.close();
  }
});

test("trash-only permanent deletion refuses active photos and releases quota only after unreferenced cleanup", async () => {
  const { db, scopes } = fixture();
  try {
    let removed = 0;
    const storage = {
      remove: async () => {
        removed++;
      },
    };
    await assert.rejects(deleteUploadedPhotoInDatabase(db, storage, "photo", scopes[0], true));
    assert.equal(removed, 0);
    manageScopedPhotoTrash(db, scopes[1], "photo", "trash");
    db.prepare("DELETE FROM memory_images WHERE memory_id='memory'").run();
    await deleteUploadedPhotoInDatabase(db, storage, "photo", scopes[0], true);
    assert.equal(removed, 1);
    assert.equal(db.prepare("SELECT storage_used_bytes FROM museums").get()!.storage_used_bytes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM photo_asset_usage").get()!.n, 0);
  } finally {
    db.close();
  }
});

test("photo trash rolls back on audit failure and refuses pending physical cleanup", () => {
  const { db, key, scopes } = fixture();
  try {
    db.exec(
      "CREATE TRIGGER fail_trash_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    );
    assert.throws(() => manageScopedPhotoTrash(db, scopes[0], "photo", "trash"));
    assert.equal(db.prepare("SELECT trashed_at FROM uploaded_photos").get()!.trashed_at, null);
    db.exec("DROP TRIGGER fail_trash_audit");
    db.prepare(
      "INSERT INTO photo_deletion_jobs(photo_id,museum_id,optimized_storage_key,created_at) VALUES ('pending',?,?,'now')",
    ).run(scopes[0].museumId, key);
    assert.throws(() => manageScopedPhotoTrash(db, scopes[0], "photo", "trash"));
    assert.equal(db.prepare("SELECT trashed_at FROM uploaded_photos").get()!.trashed_at, null);
  } finally {
    db.close();
  }
});
