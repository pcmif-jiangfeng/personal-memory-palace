import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import sharp from "sharp";
import { uploadScopedPhoto } from "../src/application/scoped-photo-upload.ts";
import { initializeDatabase } from "../src/data/database.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { recalculateMuseumStorageUsageInDatabase } from "../src/data/museum-storage-usage.ts";
import {
  deleteUploadedPhotoInDatabase,
  recoverPendingUploads,
  recoverPendingPhotoDeletions,
} from "../src/data/photo-deletion-service.ts";
import { manageScopedMemory } from "../src/data/scoped-memory.ts";
import { createScopedStage, manageScopedStage } from "../src/data/scoped-stage.ts";
import { ApiError } from "../src/http/errors.ts";
import { uploadResponseErrorMessage } from "../src/upload/upload-response-error.ts";
import type { ImageStorage } from "../src/storage/image-storage.ts";

function fixture(quota = 1_000_000) {
  const directory = mkdtempSync(path.join(tmpdir(), "photo-quota-"));
  const imageRoot = path.join(directory, "images");
  mkdirSync(imageRoot);
  const databasePath = path.join(directory, "palace.sqlite");
  const db = initializeDatabase(databasePath, false);
  const users = ["owner", "member", "other"].map((name) =>
    createUserInDatabase(db, {
      email: `${name}@example.com`,
      displayName: name,
      passwordHash: "hash",
    }),
  );
  db.exec("UPDATE users SET email_verified=1");
  const museums = [users[0], users[2]].map((user) =>
    createMuseumInDatabase(db, {
      ownerId: user.id,
      slug: user.displayName,
      name: user.displayName,
      storageQuotaBytes: quota,
    }),
  );
  db.prepare(
    "INSERT INTO museum_memberships (museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
  ).run(museums[0].id, users[1].id);
  const owner = { userId: users[0].id, museumId: museums[0].id };
  const member = { userId: users[1].id, museumId: museums[0].id };
  const other = { userId: users[2].id, museumId: museums[1].id };
  const storage: Pick<ImageStorage, "saveOptimized" | "remove"> = {
    saveOptimized: async (image, key) => {
      assert.ok(key);
      const target = path.join(imageRoot, key);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, image.data);
      return {
        optimizedStorageKey: key,
        originalStorageKey: null,
        width: image.width,
        height: image.height,
      };
    },
    remove: async (keys) => {
      for (const key of keys) if (key) rmSync(path.join(imageRoot, key), { force: true });
    },
  };
  const count = (table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
  const used = () =>
    db.prepare("SELECT storage_used_bytes AS n FROM museums WHERE id=?").get(owner.museumId)!.n;
  const close = () => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    db,
    databasePath,
    directory,
    imageRoot,
    owner,
    member,
    other,
    storage,
    count,
    used,
    close,
  };
}

const imageData = () =>
  sharp({ create: { width: 2, height: 2, channels: 3, background: "#aabbcc" } })
    .webp()
    .toBuffer();

function sharedSibling(f: ReturnType<typeof fixture>) {
  const id = randomUUID();
  f.db
    .prepare(
      `INSERT INTO museums
    (id,owner_id,museum_type,name,slug,created_at,updated_at,storage_usage_ready,storage_quota_bytes)
    VALUES (?,?,'shared','Shared',?,'now','now',1,999999999)`,
    )
    .run(id, f.owner.userId, id);
  return { userId: f.owner.userId, museumId: id };
}

test("uploads across owned palaces share one account quota, regardless of the new palace's legacy allowance", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    const sibling = sharedSibling(f);
    assert.ok(
      (await uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage)).ok,
    );
    await assert.rejects(
      uploadScopedPhoto(f.db, sibling, { data, requestedName: null }, f.storage),
      quotaError,
    );
    assert.equal(f.count("uploaded_photos"), 1);
    assert.equal(f.count("pending_uploads"), 0);
    assert.ok(
      (await uploadScopedPhoto(f.db, f.other, { data, requestedName: null }, f.storage)).ok,
    );
  } finally {
    f.close();
  }
});

test("cross-palace reservations on two database connections cannot spend the same remaining bytes", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  const db2 = new DatabaseSync(f.databasePath);
  let release: () => void = () => {};
  let pending: ReturnType<typeof uploadScopedPhoto> | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const saved = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    const sibling = sharedSibling(f);
    pending = uploadScopedPhoto(
      f.db,
      f.owner,
      { data, requestedName: null },
      {
        ...f.storage,
        saveOptimized: async (image, key) => {
          entered();
          await gate;
          return f.storage.saveOptimized(image, key);
        },
      },
    );
    await saved;
    await assert.rejects(
      uploadScopedPhoto(db2, sibling, { data, requestedName: null }, f.storage),
      quotaError,
    );
    assert.equal(f.count("photo_asset_usage"), 1);
    release();
    assert.ok((await pending).ok);
    assert.equal(f.used(), data.length);
  } finally {
    release();
    if (pending) await pending;
    db2.close();
    f.close();
  }
});

test("an unmeasured owned palace blocks account uploads rather than understating usage", async () => {
  const data = await imageData();
  const f = fixture();
  try {
    const sibling = sharedSibling(f);
    f.db.prepare("UPDATE museums SET storage_usage_ready=0 WHERE id=?").run(sibling.museumId);
    await assert.rejects(
      uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage),
      (error) => error instanceof ApiError && error.code === "STORAGE_USAGE_NOT_READY",
    );
    assert.equal(f.count("photo_asset_usage"), 0);
    assert.equal(f.count("uploaded_photos"), 0);
  } finally {
    f.close();
  }
});
function quotaError(error: unknown) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, "STORAGE_QUOTA_EXCEEDED");
  assert.equal(error.status, 507);
  return true;
}

test("exact compressed-byte boundary succeeds; the next upload is blocked before writing or auditing", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    const result = await uploadScopedPhoto(
      f.db,
      f.owner,
      { data, requestedName: "one.webp" },
      f.storage,
    );
    assert.equal(result.ok, true);
    assert.equal(f.used(), data.length);
    await assert.rejects(
      uploadScopedPhoto(f.db, f.member, { data, requestedName: null }, f.storage),
      (error) => {
        quotaError(error);
        assert.ok(error instanceof ApiError);
        assert.deepEqual(error.details, {
          storageUsedBytes: data.length,
          storageQuotaBytes: data.length,
          reservedBytes: 0,
          newCompressedBytes: data.length,
        });
        return true;
      },
    );
    assert.equal(f.count("uploaded_photos"), 1);
    assert.equal(f.count("pending_uploads"), 0);
    assert.equal(f.count("photo_asset_usage"), 1);
    assert.equal(f.count("audit_logs"), 1);
    assert.equal(
      recalculateMuseumStorageUsageInDatabase(f.db, f.owner.museumId, f.imageRoot).storageUsedBytes,
      data.length,
    );
  } finally {
    f.close();
  }
});

test("one-byte-over and zero quotas are hard limits for both owner and collaborator", async () => {
  const data = await imageData();
  for (const quota of [data.length - 1, 0]) {
    const f = fixture(quota);
    try {
      for (const scope of [f.owner, f.member]) {
        await assert.rejects(
          uploadScopedPhoto(
            f.db,
            scope,
            { data, requestedName: null },
            {
              saveOptimized: async () => {
                assert.fail("quota rejection must precede file writing");
              },
            },
          ),
          quotaError,
        );
      }
      assert.equal(f.used(), 0);
      assert.equal(f.count("pending_uploads"), 0);
      assert.equal(f.count("photo_asset_usage"), 0);
      assert.equal(f.count("audit_logs"), 0);
    } finally {
      f.close();
    }
  }
});

test("two database connections cannot claim the same remaining capacity while saving is asynchronous", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  const second = new DatabaseSync(f.databasePath);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let first: ReturnType<typeof uploadScopedPhoto> | undefined;
  try {
    first = uploadScopedPhoto(
      f.db,
      f.owner,
      { data, requestedName: null },
      {
        saveOptimized: async (image, key) => {
          entered();
          await gate;
          return f.storage.saveOptimized(image, key);
        },
      },
    );
    await started;
    assert.equal(f.used(), 0);
    await assert.rejects(
      uploadScopedPhoto(second, f.member, { data, requestedName: null }, f.storage),
      (error) => {
        quotaError(error);
        assert.ok(error instanceof ApiError);
        assert.equal(error.details?.reservedBytes, data.length);
        return true;
      },
    );
    release();
    assert.equal((await first).ok, true);
    assert.equal(f.used(), data.length);
    assert.equal(f.count("uploaded_photos"), 1);
  } finally {
    release();
    await first;
    second.close();
    f.close();
  }
});

test("other Museum usage and reservations do not consume this Museum quota", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    assert.equal(
      (await uploadScopedPhoto(f.db, f.other, { data, requestedName: null }, f.storage)).ok,
      true,
    );
    assert.equal(f.used(), 0);
    assert.equal(
      (await uploadScopedPhoto(f.db, f.member, { data, requestedName: null }, f.storage)).ok,
      true,
    );
    assert.equal(f.used(), data.length);
  } finally {
    f.close();
  }
});

test("save failure keeps a conservative reservation until file recovery succeeds", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    assert.deepEqual(
      await uploadScopedPhoto(
        f.db,
        f.member,
        { data, requestedName: null },
        {
          saveOptimized: async () => {
            throw new Error("disk failed");
          },
        },
      ),
      { ok: false, error: "IMAGE_STORAGE_FAILED" },
    );
    assert.equal(f.used(), 0);
    await assert.rejects(
      uploadScopedPhoto(f.db, f.member, { data, requestedName: null }, f.storage),
      quotaError,
    );
    assert.deepEqual(
      await recoverPendingUploads(f.db, {
        remove: async () => {
          throw new Error("cleanup failed");
        },
      }),
      { recovered: 0, failed: 1 },
    );
    assert.equal(f.count("photo_asset_usage"), 1);
    assert.deepEqual(await recoverPendingUploads(f.db, f.storage), { recovered: 1, failed: 0 });
    assert.equal(f.count("photo_asset_usage"), 0);
    assert.equal(
      (await uploadScopedPhoto(f.db, f.member, { data, requestedName: null }, f.storage)).ok,
      true,
    );
  } finally {
    f.close();
  }
});

test("audit failure leaves the physically stored file charged until recovery actually removes it", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    f.db.exec(
      "CREATE TRIGGER fail_audit AFTER INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'fail'); END",
    );
    assert.deepEqual(
      await uploadScopedPhoto(f.db, f.member, { data, requestedName: null }, f.storage),
      { ok: false, error: "IMAGE_STORAGE_FAILED" },
    );
    assert.equal(f.count("uploaded_photos"), 0);
    assert.equal(f.count("audit_logs"), 0);
    assert.equal(f.used(), data.length);
    assert.equal(f.db.prepare("SELECT state FROM photo_asset_usage").get()!.state, "stored");
    assert.deepEqual(await recoverPendingUploads(f.db, f.storage), { recovered: 1, failed: 0 });
    assert.equal(f.used(), 0);
    assert.equal(f.count("photo_asset_usage"), 0);
    assert.deepEqual(await recoverPendingUploads(f.db, f.storage), { recovered: 0, failed: 0 });
  } finally {
    f.close();
  }
});

test("deletion frees bytes only after actual cleanup and retry cannot double-release capacity", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    const result = await uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage);
    assert.ok(result.ok);
    await assert.rejects(
      deleteUploadedPhotoInDatabase(
        f.db,
        {
          remove: async () => {
            throw new Error("busy");
          },
        },
        result.photo.id,
        f.owner,
      ),
    );
    assert.equal(f.used(), data.length);
    await assert.rejects(
      uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage),
      quotaError,
    );
    assert.deepEqual(await recoverPendingPhotoDeletions(f.db, f.storage), {
      recovered: 1,
      failed: 0,
    });
    assert.equal(f.used(), 0);
    assert.deepEqual(await deleteUploadedPhotoInDatabase(f.db, f.storage, result.photo.id), {
      deleted: false,
      alreadyDeleted: true,
    });
    assert.equal(f.used(), 0);
    assert.equal(
      (await uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage)).ok,
      true,
    );
  } finally {
    f.close();
  }
});

test("journal insertion failure atomically rolls back its reservation", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    f.db.exec(
      "CREATE TRIGGER fail_journal BEFORE INSERT ON pending_uploads BEGIN SELECT RAISE(ABORT,'fail'); END",
    );
    assert.deepEqual(
      await uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage),
      { ok: false, error: "IMAGE_STORAGE_FAILED" },
    );
    assert.equal(f.count("photo_asset_usage"), 0);
    assert.equal(f.used(), 0);
    assert.equal(f.count("pending_uploads"), 0);
  } finally {
    f.close();
  }
});

test("failed deletion finalization rolls back quota release even when the physical file is gone", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    const result = await uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage);
    assert.ok(result.ok);
    f.db.exec(
      "CREATE TRIGGER fail_finalization BEFORE DELETE ON photo_deletion_jobs BEGIN SELECT RAISE(ABORT,'fail'); END",
    );
    await assert.rejects(deleteUploadedPhotoInDatabase(f.db, f.storage, result.photo.id, f.owner));
    assert.equal(f.used(), data.length);
    assert.equal(f.count("photo_asset_usage"), 1);
    assert.equal(f.count("photo_deletion_jobs"), 1);
    f.db.exec("DROP TRIGGER fail_finalization");
    assert.deepEqual(await recoverPendingPhotoDeletions(f.db, f.storage), {
      recovered: 1,
      failed: 0,
    });
    assert.equal(f.used(), 0);
    assert.equal(f.count("photo_asset_usage"), 0);
  } finally {
    f.close();
  }
});

test("full quota leaves Memory, later notes and Stage text editing available", async () => {
  const f = fixture(0);
  try {
    f.db
      .prepare(
        "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Before','Story','now','now')",
      )
      .run(f.owner.museumId);
    manageScopedMemory(f.db, f.member, "memory", {
      action: "details",
      version: 1,
      title: "After",
      story: "Updated",
      stageId: null,
    });
    manageScopedMemory(f.db, f.member, "memory", { action: "note", content: "Later note" });
    const stage = createScopedStage(f.db, f.member, { title: "New stage" });
    manageScopedStage(f.db, f.member, stage.id, {
      action: "details",
      input: { title: "Edited stage", version: 1 },
    });
    assert.equal(
      f.db.prepare("SELECT title FROM memories WHERE id='memory'").get()!.title,
      "After",
    );
    assert.equal(
      f.db.prepare("SELECT title FROM stages WHERE id=?").get(stage.id)!.title,
      "Edited stage",
    );
    assert.equal(f.count("later_notes"), 1);
    assert.equal(f.count("photo_asset_usage"), 0);
  } finally {
    f.close();
  }
});

test("migration 21 preserves old quota/content and requires measured legacy usage before uploads", async () => {
  const data = await imageData();
  const f = fixture(data.length);
  try {
    f.db.exec(
      "DROP TABLE photo_asset_usage; ALTER TABLE museums DROP COLUMN storage_usage_ready; DELETE FROM schema_migrations WHERE version=21",
    );
    const before = f.db.prepare("SELECT * FROM museums ORDER BY id").all();
    runDatabaseMigrations(f.db);
    const after = f.db.prepare("SELECT * FROM museums ORDER BY id").all();
    assert.deepEqual(
      after.map(({ storage_usage_ready, ...row }) => {
        assert.equal(storage_usage_ready, 0);
        return row;
      }),
      before.map((row) => ({ ...row })),
    );
    await assert.rejects(
      uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage),
      (error) =>
        error instanceof ApiError &&
        error.code === "STORAGE_USAGE_NOT_READY" &&
        error.status === 503,
    );
    assert.equal(f.count("pending_uploads"), 0);
    recalculateMuseumStorageUsageInDatabase(f.db, f.owner.museumId, f.imageRoot);
    assert.equal(
      (await uploadScopedPhoto(f.db, f.owner, { data, requestedName: null }, f.storage)).ok,
      true,
    );
    runDatabaseMigrations(f.db);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=21").get()!.n,
      1,
    );
  } finally {
    f.close();
  }
});

test("quota messages show current usage, limit and pending reservations without trusting arbitrary payloads", () => {
  const message = uploadResponseErrorMessage(507, "STORAGE_QUOTA_EXCEEDED", {
    storageUsedBytes: 2048,
    storageQuotaBytes: 4096,
    reservedBytes: 1024,
  });
  assert.match(message, /当前用量 2.0 KiB，上限 4.0 KiB/);
  assert.match(message, /预留 1.0 KiB/);
  assert.match(message, /文字和记忆仍可编辑/);
  for (const details of [
    null,
    [],
    { storageUsedBytes: "<script>", storageQuotaBytes: Infinity, reservedBytes: -1 },
  ]) {
    assert.doesNotMatch(
      uploadResponseErrorMessage(507, "STORAGE_QUOTA_EXCEEDED", details),
      /script|Infinity|NaN|undefined/,
    );
  }
  assert.match(uploadResponseErrorMessage(503, "STORAGE_USAGE_NOT_READY"), /重算存储用量/);
});
