import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../src/data/database.ts";
import { permanentlyDeleteMemoryInDatabase } from "../src/data/management-repository.ts";
import {
  deleteUploadedPhotoInDatabase,
  deleteUploadedPhotosInDatabase,
  recoverPendingPhotoDeletions,
  recoverPendingUploads,
} from "../src/data/photo-deletion-service.ts";
import { DomainError } from "../src/domain/errors.ts";

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-photo-delete-"));
  const database = initializeDatabase(path.join(directory, "owner.sqlite"), false);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO uploaded_photos
       (id, original_name, mime_type, optimized_storage_key, original_storage_key,
        width, height, created_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      "photo-1",
      "past.jpg",
      "image/jpeg",
      "uploads/owner/optimized/photo-1.webp",
      "uploads/owner/original/photo-1.jpg",
      1200,
      800,
      now,
    );
  return { directory, database, now };
}

test("deletes only the unreferenced optimized photo and is idempotent", async () => {
  const { directory, database } = createFixture();
  const removed: string[][] = [];
  try {
    const first = await deleteUploadedPhotoInDatabase(
      database,
      {
        remove: async (keys) =>
          void removed.push(keys.filter((key): key is string => Boolean(key))),
      },
      "photo-1",
    );
    const second = await deleteUploadedPhotoInDatabase(
      database,
      {
        remove: async (keys) =>
          void removed.push(keys.filter((key): key is string => Boolean(key))),
      },
      "photo-1",
    );

    assert.deepEqual(first, { deleted: true, alreadyDeleted: false });
    assert.deepEqual(second, { deleted: false, alreadyDeleted: true });
    assert.deepEqual(removed, [
      ["uploads/owner/optimized/photo-1.webp", "uploads/owner/original/photo-1.jpg"],
    ]);
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM uploaded_photos").get() as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM photo_deletion_jobs").get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("batch deletion partially succeeds and preserves referenced photos", async () => {
  const { directory, database, now } = createFixture();
  const removed: string[][] = [];
  try {
    database
      .prepare(
        `INSERT INTO uploaded_photos
         (id, original_name, mime_type, optimized_storage_key, original_storage_key,
          width, height, created_at, used_at)
         VALUES (?, ?, ?, ?, NULL, 1200, 800, ?, NULL)`,
      )
      .run("photo-2", "free.jpg", "image/jpeg", "uploads/owner/optimized/photo-2.webp", now);
    database
      .prepare(
        `INSERT INTO memories
         (id, stage_id, title, story, visibility, created_at, updated_at)
         VALUES (?, NULL, ?, 'Story', 'private', ?, ?)`,
      )
      .run("memory-1", "毕业旅行", now, now);
    database
      .prepare(
        `INSERT INTO memory_images
         (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
         VALUES (?, ?, ?, '', 0, 1, ?)`,
      )
      .run("image-1", "memory-1", "uploads/owner/optimized/photo-1.webp", now);

    const result = await deleteUploadedPhotosInDatabase(
      database,
      {
        remove: async (keys) =>
          void removed.push(keys.filter((key): key is string => Boolean(key))),
      },
      ["photo-1", "photo-2"],
    );

    assert.deepEqual(result.deletedIds, ["photo-2"]);
    assert.deepEqual(result.failures, [
      {
        photoId: "photo-1",
        error: "PHOTO_IN_USE",
        details: {
          references: {
            memories: [{ id: "memory-1", title: "毕业旅行", isCover: true }],
            stages: [],
          },
        },
      },
    ]);
    assert.ok(database.prepare("SELECT id FROM uploaded_photos WHERE id = ?").get("photo-1"));
    assert.equal(
      database.prepare("SELECT id FROM uploaded_photos WHERE id = ?").get("photo-2"),
      undefined,
    );
    assert.deepEqual(removed, [["uploads/owner/optimized/photo-2.webp"]]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blocks deletion and lists every Memory and Stage reference", async () => {
  const { directory, database, now } = createFixture();
  let removeCalls = 0;
  try {
    database
      .prepare(
        `INSERT INTO stages (id, title, description, created_at, updated_at)
         VALUES (?, ?, '', ?, ?)`,
      )
      .run("stage-1", "摄影成长", now, now);
    database
      .prepare("INSERT INTO stage_covers (stage_id, storage_key) VALUES (?, ?)")
      .run("stage-1", "uploads/owner/optimized/photo-1.webp");
    for (const [id, title] of [
      ["memory-1", "大学时光"],
      ["memory-2", "远方与旅途"],
    ]) {
      database
        .prepare(
          `INSERT INTO memories
           (id, stage_id, title, story, visibility, created_at, updated_at)
           VALUES (?, NULL, ?, 'Story', 'private', ?, ?)`,
        )
        .run(id, title, now, now);
      database
        .prepare(
          `INSERT INTO memory_images
           (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
           VALUES (?, ?, ?, '', 0, ?, ?)`,
        )
        .run(
          `image-${id}`,
          id,
          "uploads/owner/optimized/photo-1.webp",
          id === "memory-1" ? 1 : 0,
          now,
        );
    }

    await assert.rejects(
      deleteUploadedPhotoInDatabase(
        database,
        { remove: async () => void (removeCalls += 1) },
        "photo-1",
      ),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, "PHOTO_IN_USE");
        assert.deepEqual(error.details, {
          references: {
            memories: [
              { id: "memory-1", title: "大学时光", isCover: true },
              { id: "memory-2", title: "远方与旅途", isCover: false },
            ],
            stages: [{ id: "stage-1", title: "摄影成长" }],
          },
        });
        return true;
      },
    );
    assert.equal(removeCalls, 0);
    assert.ok(database.prepare("SELECT id FROM uploaded_photos WHERE id = ?").get("photo-1"));

    database.prepare("DELETE FROM memory_images WHERE memory_id = ?").run("memory-1");
    await assert.rejects(
      deleteUploadedPhotoInDatabase(
        database,
        { remove: async () => void (removeCalls += 1) },
        "photo-1",
      ),
      (error: unknown) => error instanceof DomainError && error.code === "PHOTO_IN_USE",
    );
    assert.equal(removeCalls, 0);

    database.prepare("DELETE FROM memory_images").run();
    database.prepare("DELETE FROM stage_covers").run();
    const deleted = await deleteUploadedPhotoInDatabase(
      database,
      { remove: async () => void (removeCalls += 1) },
      "photo-1",
    );
    assert.deepEqual(deleted, { deleted: true, alreadyDeleted: false });
    assert.equal(removeCalls, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps a retryable deletion job when file removal fails", async () => {
  const { directory, database } = createFixture();
  let attempts = 0;
  const storage = {
    remove: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk busy");
    },
  };
  try {
    await assert.rejects(
      deleteUploadedPhotoInDatabase(database, storage, "photo-1"),
      (error: unknown) => error instanceof DomainError && error.code === "PHOTO_DELETE_FAILED",
    );
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM uploaded_photos").get() as {
          count: number;
        }
      ).count,
      0,
    );
    const pending = database
      .prepare("SELECT last_error AS lastError FROM photo_deletion_jobs WHERE photo_id = ?")
      .get("photo-1") as { lastError: string };
    assert.equal(pending.lastError, "Error");

    const retried = await deleteUploadedPhotoInDatabase(database, storage, "photo-1");
    assert.deepEqual(retried, { deleted: true, alreadyDeleted: false });
    assert.equal(attempts, 2);
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM photo_deletion_jobs").get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup recovery drains pending deletion jobs without another user request", async () => {
  const { directory, database } = createFixture();
  let fail = true;
  const storage = {
    remove: async () => {
      if (fail) throw new Error("offline");
    },
  };
  try {
    await assert.rejects(deleteUploadedPhotoInDatabase(database, storage, "photo-1"));
    fail = false;
    assert.deepEqual(await recoverPendingPhotoDeletions(database, storage), {
      recovered: 1,
      failed: 0,
    });
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM photo_deletion_jobs").get() as {
          count: number;
        }
      ).count,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup recovery removes a file left by an interrupted upload", async () => {
  const { directory, database } = createFixture();
  const removed: string[][] = [];
  try {
    database
      .prepare("INSERT INTO pending_uploads (id, storage_key, created_at) VALUES (?, ?, ?)")
      .run("upload-1", "uploads/owner/optimized/orphan.webp", new Date().toISOString());
    assert.deepEqual(
      await recoverPendingUploads(database, {
        remove: async (keys) =>
          void removed.push(keys.filter((key): key is string => Boolean(key))),
      }),
      { recovered: 1, failed: 0 },
    );
    assert.deepEqual(removed, [["uploads/owner/optimized/orphan.webp"]]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("permanent Memory deletion queues only photos with no remaining references", () => {
  const { directory, database, now } = createFixture();
  try {
    database
      .prepare(
        `INSERT INTO memories
      (id, stage_id, title, story, visibility, created_at, updated_at, trashed_at)
      VALUES (?, NULL, 'Memory', 'Story', 'private', ?, ?, ?)`,
      )
      .run("memory-1", now, now, now);
    database
      .prepare(
        `INSERT INTO memory_images
      (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
      VALUES (?, ?, ?, '', 0, 1, ?)`,
      )
      .run("image-1", "memory-1", "uploads/owner/optimized/photo-1.webp", now);

    permanentlyDeleteMemoryInDatabase(database, "memory-1");

    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM uploaded_photos").get() as { count: number })
        .count,
      0,
    );
    const job = database
      .prepare(
        `SELECT optimized_storage_key AS optimized,
      original_storage_key AS original FROM photo_deletion_jobs WHERE photo_id = ?`,
      )
      .get("photo-1") as { optimized: string; original: string };
    assert.equal(job.optimized, "uploads/owner/optimized/photo-1.webp");
    assert.equal(job.original, "uploads/owner/original/photo-1.jpg");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file recovery command runs against an isolated data directory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-file-recovery-command-"));
  const script = fileURLToPath(new URL("../scripts/recover-file-operations.ts", import.meta.url));
  try {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        MEMORY_PALACE_DATA_DIR: directory,
        MEMORY_PALACE_DATASET: "owner",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /File operation recovery: uploads=0\/0; deletions=0\/0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
