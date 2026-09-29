import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { uploadScopedPhoto } from "../src/application/scoped-photo-upload.ts";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { museumPhotoStorageKey } from "../src/data/photo-access.ts";
import {
  deleteUploadedPhotoInDatabase,
  deleteUploadedPhotosInDatabase,
  recoverPendingPhotoDeletions,
  recoverPendingUploads,
} from "../src/data/photo-deletion-service.ts";
import type { ImageStorage } from "../src/storage/image-storage.ts";

function fixture() {
  const db = initializeDatabase(":memory:", false);
  const users = ["owner", "member", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "never-log-this",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = [users[0], users[2]].map((user, index) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      name: "Museum",
      slug: `audit-${index}`,
      storageQuotaBytes: 1024 * 1024,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const insert = db.prepare(`INSERT INTO uploaded_photos
    (id,museum_id,original_name,mime_type,optimized_storage_key,width,height,created_at)
    VALUES (?,?,'private-file-name.webp','image/webp',?,2,2,'now')`);
  for (const id of ["free", "used", "retry"])
    insert.run(id, museums[0].id, museumPhotoStorageKey(museums[0].id));
  insert.run("foreign", museums[1].id, museumPhotoStorageKey(museums[1].id));
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Title','Private','now','now')",
  ).run(museums[0].id);
  db.prepare(
    `INSERT INTO memory_images (id,memory_id,museum_id,storage_key,created_at)
    SELECT 'image','memory',museum_id,optimized_storage_key,'now' FROM uploaded_photos WHERE id='used'`,
  ).run();
  return {
    db,
    owner: { userId: users[0].id, museumId: museums[0].id },
    member: { userId: users[1].id, museumId: museums[0].id },
    other: { userId: users[2].id, museumId: museums[0].id },
  };
}

const storage: Pick<ImageStorage, "saveOptimized"> = {
  saveOptimized: async (image, key) => {
    assert.ok(key);
    return {
      optimizedStorageKey: key,
      originalStorageKey: null,
      width: image.width,
      height: image.height,
    };
  },
};

function imageData() {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } })
    .webp()
    .toBuffer();
}

test("upload event uses the committed photo ID, trusted actor and safe dimensions", async () => {
  const { db, member } = fixture();
  try {
    const result = await uploadScopedPhoto(
      db,
      member,
      { data: await imageData(), requestedName: "private-upload-name.webp" },
      storage,
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Upload expected");
    const logs = db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "photo.upload");
    assert.equal(logs[0].actor_user_id, member.userId);
    assert.equal(logs[0].museum_id, member.museumId);
    assert.equal(logs[0].object_type, "photo");
    assert.equal(logs[0].object_id, result.photo.id);
    assert.deepEqual(JSON.parse(String(logs[0].diff)), { width: 2, height: 2 });
    assert.doesNotMatch(String(logs[0].diff), /private|uploads|password|token/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()?.n, 0);
  } finally {
    db.close();
  }
});

test("invalid image and failed file saving never produce an upload success event", async () => {
  const { db, member } = fixture();
  let saves = 0;
  const failing: Pick<ImageStorage, "saveOptimized"> = {
    saveOptimized: async () => {
      saves++;
      throw new Error("disk failure");
    },
  };
  try {
    const photoCount = db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get()?.n;
    assert.deepEqual(
      await uploadScopedPhoto(
        db,
        member,
        { data: Buffer.from("invalid"), requestedName: null },
        failing,
      ),
      { ok: false, error: "INVALID_OPTIMIZED_IMAGE" },
    );
    assert.equal(saves, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()?.n, 0);
    assert.deepEqual(
      await uploadScopedPhoto(
        db,
        member,
        { data: await imageData(), requestedName: null },
        failing,
      ),
      { ok: false, error: "IMAGE_STORAGE_FAILED" },
    );
    assert.equal(saves, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get()?.n, photoCount);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()?.n, 1);
  } finally {
    db.close();
  }
});

test("audit failure after saving rolls photo commit back and leaves a recoverable upload journal", async () => {
  const { db, member } = fixture();
  const savedKeys: string[] = [];
  const removed: (string | null)[] = [];
  try {
    db.exec(
      "CREATE TRIGGER fail_upload_audit AFTER INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    );
    const photoCount = db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get()?.n;
    const result = await uploadScopedPhoto(
      db,
      member,
      { data: await imageData(), requestedName: "private-name" },
      {
        saveOptimized: async (image, key) => {
          assert.ok(key);
          savedKeys.push(key);
          return storage.saveOptimized(image, key);
        },
      },
    );
    assert.deepEqual(result, { ok: false, error: "IMAGE_STORAGE_FAILED" });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get()?.n, photoCount);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()?.n, 1);
    assert.deepEqual(
      await recoverPendingUploads(db, {
        remove: async (keys) => {
          removed.push(...keys);
        },
      }),
      { recovered: 1, failed: 0 },
    );
    assert.deepEqual(removed, savedKeys);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()?.n, 0);
  } finally {
    db.close();
  }
});

test("upload rejects nonmembers and rechecks revocation during saving before audit or commit", async () => {
  const { db, member, other } = fixture();
  try {
    assert.throws(() =>
      uploadScopedPhoto(db, other, { data: Buffer.from("invalid"), requestedName: null }, storage),
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()?.n, 0);
    const photoCount = db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get()?.n;
    await assert.rejects(
      uploadScopedPhoto(
        db,
        member,
        { data: await imageData(), requestedName: null },
        {
          saveOptimized: async (image, key) => {
            db.exec("UPDATE museum_memberships SET status='revoked'");
            return storage.saveOptimized(image, key);
          },
        },
      ),
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM uploaded_photos").get()?.n, photoCount);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pending_uploads").get()?.n, 1);
  } finally {
    db.close();
  }
});

test("delete audit failure rolls back both queue and photo row before touching files", async () => {
  const { db, owner } = fixture();
  let removes = 0;
  try {
    const before = db.prepare("SELECT * FROM uploaded_photos WHERE id='free'").get();
    db.exec(
      "CREATE TRIGGER fail_delete_audit AFTER INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    );
    await assert.rejects(
      deleteUploadedPhotoInDatabase(
        db,
        {
          remove: async () => {
            removes++;
          },
        },
        "free",
        owner,
      ),
      /audit failure/,
    );
    assert.deepEqual(db.prepare("SELECT * FROM uploaded_photos WHERE id='free'").get(), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photo_deletion_jobs").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
    assert.equal(removes, 0);
  } finally {
    db.close();
  }
});

test("failed file cleanup records queued state only; retry never changes or duplicates the event", async () => {
  const { db, owner } = fixture();
  let calls = 0;
  const remove = async () => {
    if (++calls === 1) throw new Error("disk busy");
  };
  try {
    await assert.rejects(
      deleteUploadedPhotoInDatabase(db, { remove }, "free", owner),
      /PHOTO_DELETE_FAILED/,
    );
    const events = db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "photo.deleteQueued");
    assert.equal(events[0].object_type, "photo");
    assert.equal(events[0].object_id, "free");
    assert.equal(events[0].actor_user_id, owner.userId);
    assert.equal(events[0].museum_id, owner.museumId);
    assert.equal(events[0].diff, null);
    assert.equal(db.prepare("SELECT id FROM uploaded_photos WHERE id='free'").get(), undefined);
    assert.ok(db.prepare("SELECT photo_id FROM photo_deletion_jobs WHERE photo_id='free'").get());
    assert.deepEqual(await deleteUploadedPhotoInDatabase(db, { remove }, "free", owner), {
      deleted: true,
      alreadyDeleted: false,
    });
    assert.equal(calls, 2);
    assert.deepEqual(db.prepare("SELECT * FROM audit_logs").all(), events);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photo_deletion_jobs").get()?.n, 0);
    // The existing scoped endpoint returns not-found on another completed-delete request.
    await assert.rejects(
      deleteUploadedPhotoInDatabase(db, { remove }, "free", owner),
      /PHOTO_NOT_FOUND/,
    );
    assert.equal(calls, 2);
    assert.deepEqual(db.prepare("SELECT * FROM audit_logs").all(), events);
  } finally {
    db.close();
  }
});

test("failed queue finalization can be retried without duplicating the queued event", async () => {
  const { db, owner } = fixture();
  let removes = 0;
  try {
    db.exec(
      "CREATE TRIGGER fail_finalization BEFORE DELETE ON photo_deletion_jobs BEGIN SELECT RAISE(ABORT,'db busy'); END",
    );
    const remove = async () => {
      removes++;
    };
    await assert.rejects(
      deleteUploadedPhotoInDatabase(db, { remove }, "free", owner),
      /PHOTO_DELETE_INCOMPLETE/,
    );
    const events = db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "photo.deleteQueued");
    db.exec("DROP TRIGGER fail_finalization");
    assert.deepEqual(await deleteUploadedPhotoInDatabase(db, { remove }, "free", owner), {
      deleted: true,
      alreadyDeleted: false,
    });
    assert.equal(removes, 2);
    assert.deepEqual(db.prepare("SELECT * FROM audit_logs").all(), events);
  } finally {
    db.close();
  }
});

test("startup recovery preserves original actor and does not manufacture another event", async () => {
  const { db, owner } = fixture();
  try {
    await assert.rejects(
      deleteUploadedPhotoInDatabase(
        db,
        {
          remove: async () => {
            throw new Error("offline");
          },
        },
        "free",
        owner,
      ),
    );
    const events = db.prepare("SELECT * FROM audit_logs").all();
    assert.deepEqual(await recoverPendingPhotoDeletions(db, { remove: async () => {} }), {
      recovered: 1,
      failed: 0,
    });
    assert.deepEqual(await recoverPendingPhotoDeletions(db, { remove: async () => {} }), {
      recovered: 0,
      failed: 0,
    });
    assert.deepEqual(db.prepare("SELECT * FROM audit_logs").all(), events);
    assert.equal(events[0].actor_user_id, owner.userId);
  } finally {
    db.close();
  }
});

test("permission denial, foreign IDs and in-use photos never queue deletion or audit success", async () => {
  const { db, owner, member, other } = fixture();
  let removes = 0;
  try {
    const before = db.prepare("SELECT * FROM uploaded_photos ORDER BY id").all();
    for (const [scope, id] of [
      [member, "free"],
      [other, "free"],
      [owner, "foreign"],
      [owner, "missing"],
      [owner, "used"],
    ] as const) {
      await assert.rejects(
        deleteUploadedPhotoInDatabase(
          db,
          {
            remove: async () => {
              removes++;
            },
          },
          id,
          scope,
        ),
      );
    }
    assert.equal(removes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photo_deletion_jobs").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
    assert.deepEqual(db.prepare("SELECT * FROM uploaded_photos ORDER BY id").all(), before);
  } finally {
    db.close();
  }
});

test("batch deletion audits each newly queued photo once while preserving failed items", async () => {
  const { db, owner } = fixture();
  let removes = 0;
  try {
    const result = await deleteUploadedPhotosInDatabase(
      db,
      {
        remove: async () => {
          removes++;
        },
      },
      ["free", "free", "used", "foreign"],
      owner,
    );
    assert.deepEqual(result.deletedIds, ["free"]);
    assert.deepEqual(
      result.failures.map((failure) => failure.photoId),
      ["used", "foreign"],
    );
    const events = db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(events.length, 1);
    assert.equal(events[0].object_id, "free");
    assert.equal(events[0].action, "photo.deleteQueued");
    assert.equal(removes, 1);
    assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id='used'").get());
    assert.ok(db.prepare("SELECT id FROM uploaded_photos WHERE id='foreign'").get());
  } finally {
    db.close();
  }
});

test("retrying a pre-existing deletion job does not invent its missing historical actor", async () => {
  const { db, owner } = fixture();
  try {
    db.prepare(
      `INSERT INTO photo_deletion_jobs (photo_id,museum_id,optimized_storage_key,created_at)
      SELECT id,museum_id,optimized_storage_key,'before-audit' FROM uploaded_photos WHERE id='retry'`,
    ).run();
    db.exec("DELETE FROM uploaded_photos WHERE id='retry'");
    assert.deepEqual(
      await deleteUploadedPhotoInDatabase(db, { remove: async () => {} }, "retry", owner),
      { deleted: true, alreadyDeleted: false },
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get()?.n, 0);
  } finally {
    db.close();
  }
});
