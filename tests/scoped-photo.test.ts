import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { queryWorkspacePhotoCatalogInDatabase } from "../src/data/photo-repository.ts";
import {
  archiveScopedPhoto,
  requirePhotoAccess,
  museumPhotoStorageKey,
  isMuseumPhotoKey,
  canReadMuseumPhoto,
  isPhotoMediaAvailable,
} from "../src/data/photo-access.ts";
import { deleteUploadedPhotoInDatabase } from "../src/data/photo-deletion-service.ts";
import { recoverPendingUploads } from "../src/data/photo-deletion-service.ts";
import { uploadScopedPhoto } from "../src/application/scoped-photo-upload.ts";
import sharp from "sharp";
import { memoryMuseumUrl } from "../src/client/memory-museum-url.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.prepare("UPDATE users SET email_verified=1").run();
  const museums = [users[0], users[2]].map((user, i) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: "Museum",
      slug: `photo-${i}`,
      storageQuotaBytes: 1024 * 1024,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const insert = db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at,library_archived_at) VALUES (?,?,'Photo','image/webp',?,1,1,'now','now')",
  );
  insert.run("own", museums[0].id, museumPhotoStorageKey(museums[0].id));
  insert.run("foreign", museums[1].id, museumPhotoStorageKey(museums[1].id));
  return {
    db,
    owner: { userId: users[0].id, museumId: museums[0].id },
    member: { userId: users[1].id, museumId: museums[0].id },
    foreignMuseum: museums[1].id,
  };
}
test("catalog pages and Memory reference filters stay within Museum even with malformed cross references", () => {
  const { db, member, foreignMuseum } = fixture();
  try {
    db.prepare(
      "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('foreign-memory',?,'Secret','Story','now','now')",
    ).run(foreignMuseum);
    const key = db
      .prepare("SELECT optimized_storage_key AS k FROM uploaded_photos WHERE id='own'")
      .get()!.k;
    db.prepare(
      "INSERT INTO memory_images (id,memory_id,museum_id,storage_key,created_at) VALUES ('corrupt','foreign-memory',?,?,'now')",
    ).run(foreignMuseum, key);
    const page = queryWorkspacePhotoCatalogInDatabase(
      db,
      { source: "library", limit: 1 },
      member.museumId,
    );
    assert.deepEqual(
      page.items.map((p) => p.id),
      ["own"],
    );
    assert.deepEqual(page.items[0].memoryTitles, []);
    assert.equal(page.items[0].activeMemoryCount, 0);
    assert.equal(page.nextCursor, null);
    assert.equal(
      queryWorkspacePhotoCatalogInDatabase(
        db,
        { source: "library", query: "Secret" },
        member.museumId,
      ).items.length,
      0,
    );
  } finally {
    db.close();
  }
});
test("photo archive/deletion reject foreign IDs and collaborators cannot permanently delete", async () => {
  const { db, owner, member } = fixture();
  const removed: (string | null)[][] = [];
  const storage = {
    remove: async (keys: (string | null)[]) => {
      removed.push(keys);
    },
  };
  try {
    assert.throws(() => requirePhotoAccess(db, member, "foreign"));
    assert.throws(() => archiveScopedPhoto(db, member, "foreign"));
    archiveScopedPhoto(db, member, "own");
    await assert.rejects(deleteUploadedPhotoInDatabase(db, storage, "own", member));
    await assert.rejects(deleteUploadedPhotoInDatabase(db, storage, "foreign", owner));
    assert.equal(removed.length, 0);
    const ownKey = String(
      db.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos WHERE id='own'").get()!.k,
    );
    assert.equal(canReadMuseumPhoto(db, member.userId, ownKey), true);
    assert.equal((await deleteUploadedPhotoInDatabase(db, storage, "own", owner)).deleted, true);
    assert.equal(removed.length, 1);
    assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id='foreign'").get());
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.throws(() => requirePhotoAccess(db, member, "foreign"));
  } finally {
    db.close();
  }
});

test("a foreign deletion journal cannot override an owned photo deletion target", async () => {
  const { db, owner, foreignMuseum } = fixture();
  const removed: (string | null)[][] = [];
  try {
    const key = db
      .prepare("SELECT optimized_storage_key AS k FROM uploaded_photos WHERE id='foreign'")
      .get()!.k;
    db.prepare(
      "INSERT INTO photo_deletion_jobs (photo_id,museum_id,optimized_storage_key,created_at) VALUES ('own',?,?,'now')",
    ).run(foreignMuseum, key);
    await assert.rejects(
      deleteUploadedPhotoInDatabase(
        db,
        {
          remove: async (keys) => {
            removed.push(keys);
          },
        },
        "own",
        owner,
      ),
    );
    assert.equal(removed.length, 0);
    assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id='own'").get());
    assert.ok(db.prepare("SELECT photo_id FROM photo_deletion_jobs WHERE photo_id='own'").get());
  } finally {
    db.close();
  }
});

test("private media permission ends immediately on revocation and does not authorize foreign physical paths", () => {
  const { db, member, foreignMuseum } = fixture();
  try {
    const key = String(
      db.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos WHERE id='own'").get()!.k,
    );
    const foreignKey = String(
      db.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos WHERE id='foreign'").get()!
        .k,
    );
    assert.equal(canReadMuseumPhoto(db, member.userId, key), true);
    assert.equal(isPhotoMediaAvailable(db, key), true);
    assert.equal(canReadMuseumPhoto(db, member.userId, foreignKey), false);
    assert.equal(canReadMuseumPhoto(db, null, key), false);
    db.prepare("UPDATE museum_memberships SET status='revoked'").run();
    assert.equal(canReadMuseumPhoto(db, member.userId, key), false);
    db.prepare("UPDATE museum_memberships SET status='active'").run();
    db.prepare("UPDATE uploaded_photos SET optimized_storage_key=? WHERE id='own'").run(
      museumPhotoStorageKey(foreignMuseum),
    );
    assert.throws(() => requirePhotoAccess(db, member, "own"));
    const wrongKey = String(
      db.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos WHERE id='own'").get()!.k,
    );
    assert.equal(isPhotoMediaAvailable(db, wrongKey), false);
    db.prepare("UPDATE uploaded_photos SET optimized_storage_key=? WHERE id='own'").run(key);
    db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(member.museumId);
    assert.equal(isPhotoMediaAvailable(db, key), false);
  } finally {
    db.close();
  }
});

test("upload journals and records carry Museum scope; revocation during saving leaves only recoverable pending files", async () => {
  const { db, member } = fixture();
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } })
    .webp()
    .toBuffer();
  const storage = {
    saveOptimized: async (image: { width: number; height: number }, key?: string) => ({
      optimizedStorageKey: key!,
      originalStorageKey: null,
      width: image.width,
      height: image.height,
    }),
  };
  try {
    const result = await uploadScopedPhoto(
      db,
      member,
      { data, requestedName: "photo.jpg" },
      storage,
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Expected successful upload");
    assert.ok(isMuseumPhotoKey(result.photo.optimizedStorageKey, member.museumId));
    assert.equal(
      db.prepare("SELECT museum_id FROM uploaded_photos WHERE id=?").get(result.photo.id)
        ?.museum_id,
      member.museumId,
    );
    await assert.rejects(
      uploadScopedPhoto(
        db,
        member,
        { data, requestedName: "revoked.jpg" },
        {
          saveOptimized: async (image, key) => {
            db.prepare("UPDATE museum_memberships SET status='revoked'").run();
            return storage.saveOptimized(image, key);
          },
        },
      ),
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS n FROM uploaded_photos WHERE original_name='revoked.jpg'")
        .get()?.n,
      0,
    );
    assert.equal(
      db.prepare("SELECT museum_id FROM pending_uploads").get()?.museum_id,
      member.museumId,
    );
    const removed: (string | null)[] = [];
    assert.equal(
      (
        await recoverPendingUploads(db, {
          remove: async (keys) => {
            removed.push(...keys);
          },
        })
      ).recovered,
      1,
    );
    assert.ok(isMuseumPhotoKey(String(removed[0]), member.museumId));
  } finally {
    db.close();
  }
});

test("captured Museum upload URLs stay fixed after navigation and preserve other query parameters", () => {
  const captured = memoryMuseumUrl("/api/photos", "museum-a");
  assert.equal(captured, "/api/photos?museumId=museum-a");
  assert.equal(
    memoryMuseumUrl("/memories/new?photos=p1", "museum-a"),
    "/memories/new?photos=p1&museumId=museum-a",
  );
});
test("storage keys are physically namespaced and traversal/other-Museum keys are rejected", () => {
  const { db, owner, foreignMuseum } = fixture();
  try {
    const key = museumPhotoStorageKey(owner.museumId);
    assert.ok(key.startsWith(`uploads/museums/${owner.museumId}/optimized/`));
    assert.ok(isMuseumPhotoKey(key, owner.museumId));
    assert.equal(isMuseumPhotoKey(key, foreignMuseum), false);
    assert.throws(() => museumPhotoStorageKey("../../foreign"));
    assert.equal(
      isMuseumPhotoKey(
        `uploads/museums/${owner.museumId}/optimized/../../secret.webp`,
        owner.museumId,
      ),
      false,
    );
  } finally {
    db.close();
  }
});
