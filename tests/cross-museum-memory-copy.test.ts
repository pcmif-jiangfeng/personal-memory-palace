import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { readScopedMemory } from "../src/data/scoped-memory.ts";
import { museumPhotoStorageKey } from "../src/storage/photo-storage-key.ts";
import { copyMemoryToMuseum } from "../src/application/cross-museum-memory-copy.ts";
import { recoverPendingUploads } from "../src/data/photo-deletion-service.ts";
import { ApiError } from "../src/http/errors.ts";

function fixture(t: TestContext) {
  const db = initializeDatabase(":memory:", false);
  t.after(() => db.close());
  const users = ["source", "target"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "fixture-hash",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = users.map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: user.displayName,
      slug: user.displayName,
      storageQuotaBytes: 100000,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[1].id, users[0].id);
  const scope = { userId: users[0].id, museumId: museums[0].id };
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES ('source-stage',?,'Stage','now','now')",
  ).run(scope.museumId);
  db.prepare(
    "INSERT INTO memories (id,museum_id,stage_id,title,story,is_public,created_at,updated_at) VALUES ('source-memory',?,'source-stage','Title','Original Story',1,'now','now')",
  ).run(scope.museumId);
  const files = new Map<string, Buffer>();
  for (const index of [0, 1]) {
    const key = museumPhotoStorageKey(scope.museumId);
    files.set(key, Buffer.from(`photo-${index}`));
    db.prepare(
      `INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at)
      VALUES (?,?,'photo.webp','image/webp',?,2,2,'now')`,
    ).run(`photo-${index}`, scope.museumId, key);
    db.prepare(
      `INSERT INTO memory_images (id,museum_id,memory_id,storage_key,alt_text,exhibit_title,exhibit_description,sort_order,is_cover,created_at)
      VALUES (?,?,'source-memory',?,'alt','Exhibit','Description',?,?,'now')`,
    ).run(`image-${index}`, scope.museumId, key, index, index === 1 ? 1 : 0);
  }
  db.prepare(
    "INSERT INTO later_notes (id,museum_id,memory_id,content,created_at) VALUES ('source-note',?,'source-memory','Later words','2026-01-01T00:00:00.000Z')",
  ).run(scope.museumId);
  const storage = {
    size: async (key: string) => files.get(key)!.length,
    copy: async (from: string, to: string) => {
      files.set(to, Buffer.from(files.get(from)!));
    },
    remove: async (keys: Array<string | null>) => {
      for (const key of keys) if (key) files.delete(key);
    },
  };
  const copy = () => copyMemoryToMuseum(db, scope, "source-memory", museums[1].id, storage);
  return { db, scope, museums, files, storage, copy };
}

test("K2 copies content, cover/order/metadata and notes into independent private entities without source Stage or sharing", async (t) => {
  const f = fixture(t);
  const before = readScopedMemory(f.db, f.scope, "source-memory");
  const result = await f.copy();
  const copied = readScopedMemory(f.db, { ...f.scope, museumId: result.museumId }, result.memoryId);
  assert.equal(copied.title, before.title);
  assert.equal(copied.story, before.story);
  assert.equal(copied.stageId, null);
  assert.equal(copied.isPublic, false);
  assert.equal(copied.visibility, "private");
  assert.equal(copied.version, 1);
  assert.equal(copied.createdByUserId, f.scope.userId);
  assert.deepEqual(copied.relatedMemories, []);
  assert.equal(copied.laterNotes[0].content, before.laterNotes[0].content);
  assert.equal(copied.laterNotes[0].createdAt, before.laterNotes[0].createdAt);
  assert.notEqual(copied.laterNotes[0].id, before.laterNotes[0].id);
  for (const [index, image] of copied.images.entries()) {
    const original = before.images[index];
    assert.notEqual(image.id, original.id);
    assert.notEqual(image.photoId, original.photoId);
    assert.notEqual(image.storageKey, original.storageKey);
    for (const field of [
      "sortOrder",
      "isCover",
      "altText",
      "exhibitTitle",
      "exhibitDescription",
    ] as const)
      assert.equal(image[field], original[field]);
  }
  assert.deepEqual(readScopedMemory(f.db, f.scope, "source-memory"), before);
  f.db.exec("UPDATE memories SET story='Later source edit' WHERE id='source-memory'");
  assert.equal(
    readScopedMemory(f.db, { ...f.scope, museumId: result.museumId }, result.memoryId).story,
    "Original Story",
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM share_configs WHERE memory_id=?").get(result.memoryId)!.n,
    0,
  );
});

test("K2 combined quota failure occurs before copying any photos or publishing a partial Memory", async (t) => {
  const f = fixture(t);
  f.db
    .prepare(
      "UPDATE users SET storage_quota_bytes=7 WHERE id=(SELECT owner_id FROM museums WHERE id=?)",
    )
    .run(f.museums[1].id);
  await assert.rejects(
    f.copy(),
    (error) => error instanceof ApiError && error.code === "STORAGE_QUOTA_EXCEEDED",
  );
  assert.equal(f.files.size, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM pending_uploads").get()!.n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM memories").get()!.n, 1);
});

test("K2 a changed source version during copying rolls back all target Photos and Memory with recoverable files", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    copyMemoryToMuseum(f.db, f.scope, "source-memory", f.museums[1].id, {
      ...f.storage,
      copy: async (from, to) => {
        await f.storage.copy(from, to);
        f.db.exec("UPDATE memories SET version=version+1 WHERE id='source-memory'");
      },
    }),
    (error) => error instanceof ApiError && error.code === "MEMORY_VERSION_CONFLICT",
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM uploaded_photos").get()!.n, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM memories").get()!.n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs").get()!.n, 0);
  assert.equal((await recoverPendingUploads(f.db, f.storage)).recovered, 2);
  assert.equal(f.files.size, 2);
});

test("K2 final Memory audit failure rolls back copied Photos, exhibits, notes and Photo audits as one unit", async (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER fail_memory_copy BEFORE INSERT ON audit_logs WHEN NEW.action='memory.copy' BEGIN SELECT RAISE(ABORT,'copy audit failure'); END",
  );
  await assert.rejects(f.copy(), /copy audit failure/);
  for (const [table, count] of [
    ["memories", 1],
    ["uploaded_photos", 2],
    ["memory_images", 2],
    ["later_notes", 1],
    ["audit_logs", 0],
  ] as const)
    assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, count);
  assert.equal((await recoverPendingUploads(f.db, f.storage)).recovered, 2);
});

test("K2 refuses foreign, trashed and corrupt cross-Museum content before copying files", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    copyMemoryToMuseum(
      f.db,
      { ...f.scope, museumId: f.museums[1].id },
      "source-memory",
      f.museums[0].id,
      f.storage,
    ),
  );
  f.db.exec("UPDATE memories SET trashed_at='now' WHERE id='source-memory'");
  await assert.rejects(f.copy());
  f.db.exec("UPDATE memories SET trashed_at=NULL WHERE id='source-memory'");
  f.db.prepare("UPDATE later_notes SET museum_id=? WHERE id='source-note'").run(f.museums[1].id);
  await assert.rejects(
    f.copy(),
    (error) => error instanceof ApiError && error.code === "INVALID_MEMORY_BINDING",
  );
  assert.equal(f.files.size, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM pending_uploads").get()!.n, 0);
});

test("K2 copies an existing text-only Memory without fabricating photos or losing its Story", async (t) => {
  const f = fixture(t);
  f.db.exec("DELETE FROM memory_images");
  const result = await f.copy();
  const copy = readScopedMemory(f.db, { ...f.scope, museumId: result.museumId }, result.memoryId);
  assert.equal(copy.story, "Original Story");
  assert.deepEqual(copy.images, []);
  assert.equal(f.files.size, 2);
});
