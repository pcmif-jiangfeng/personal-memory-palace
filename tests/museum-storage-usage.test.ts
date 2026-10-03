import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase, findMuseumByIdInDatabase } from "../src/data/museum-repository.ts";
import {
  recalculateMuseumStorageUsageInDatabase,
  readMuseumStorageSummaryInDatabase,
} from "../src/data/museum-storage-usage.ts";
import { deleteUploadedPhotoInDatabase } from "../src/data/photo-deletion-service.ts";
import { ApiError } from "../src/http/errors.ts";

test("storage summary shows only the current palace's use and the owner's account remainder", () => {
  const f = fixture();
  try {
    f.db.exec("UPDATE users SET email_verified=1");
    f.db.prepare("UPDATE users SET storage_quota_bytes=100 WHERE id=?").run(f.museums[0].ownerId);
    f.db.prepare("UPDATE museums SET storage_used_bytes=20 WHERE id=?").run(f.museums[0].id);
    const sibling = createMuseumInDatabase(f.db, {
      ownerId: f.museums[0].ownerId,
      museumType: "shared",
      name: "PRIVATE-OTHER-NAME",
      slug: "sibling",
    });
    f.db.prepare("UPDATE museums SET storage_used_bytes=30 WHERE id=?").run(sibling.id);
    for (const [museum, bytes] of [
      [f.museums[0], 5],
      [sibling, 7],
    ] as const)
      f.db
        .prepare(
          "INSERT INTO photo_asset_usage(storage_key,museum_id,bytes,state) VALUES (?,?,?,'reserved')",
        )
        .run(f.key(museum), museum.id, bytes);
    const summary = readMuseumStorageSummaryInDatabase(f.db, f.museums[0].ownerId, f.museums[0].id);
    assert.deepEqual(summary, {
      museumId: f.museums[0].id,
      storageUsedBytes: 20,
      reservedBytes: 5,
      ownerRemainingBytes: 38,
    });
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE-OTHER-NAME|email|ownerId|museumIds/);
    assert.equal(JSON.stringify(summary).includes(sibling.id), false);
    assert.throws(
      () => readMuseumStorageSummaryInDatabase(f.db, f.museums[1].ownerId, f.museums[0].id),
      ApiError,
    );
    f.db
      .prepare(
        "INSERT INTO museum_memberships(museum_id,user_id,created_at,updated_at) VALUES (?,?,'now','now')",
      )
      .run(f.museums[0].id, f.museums[1].ownerId);
    assert.deepEqual(
      readMuseumStorageSummaryInDatabase(f.db, f.museums[1].ownerId, f.museums[0].id),
      summary,
    );
    f.db.exec("UPDATE museum_memberships SET status='revoked'");
    assert.throws(
      () => readMuseumStorageSummaryInDatabase(f.db, f.museums[1].ownerId, f.museums[0].id),
      ApiError,
    );
    f.db.prepare("UPDATE museums SET storage_usage_ready=0 WHERE id=?").run(sibling.id);
    assert.equal(
      readMuseumStorageSummaryInDatabase(f.db, f.museums[0].ownerId, f.museums[0].id)
        .ownerRemainingBytes,
      null,
    );
    f.db.prepare("UPDATE museums SET status='pending_deletion' WHERE id=?").run(f.museums[0].id);
    assert.throws(
      () => readMuseumStorageSummaryInDatabase(f.db, f.museums[0].ownerId, f.museums[0].id),
      ApiError,
    );
  } finally {
    f.close();
  }
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "museum-storage-usage-"));
  const root = path.join(directory, "images");
  mkdirSync(root);
  const db = initializeDatabase(path.join(directory, "palace.sqlite"), false);
  const museums = ["one", "two"].map((name) => {
    const user = createUserInDatabase(db, {
      email: `${name}@example.com`,
      passwordHash: "hash",
      displayName: name,
    });
    return createMuseumInDatabase(db, { ownerId: user.id, name, slug: name });
  });
  const key = (museum = museums[0], variant = "optimized") =>
    `uploads/museums/${museum.id}/${variant}/${randomUUID()}.${variant === "optimized" ? "webp" : "jpg"}`;
  const file = (storageKey: string, size: number) => {
    const target = path.join(root, storageKey);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.alloc(size));
  };
  const photo = (
    storageKey: string,
    originalKey: string | null = null,
    museumId = museums[0].id,
  ) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO uploaded_photos
      (id,museum_id,original_name,mime_type,optimized_storage_key,original_storage_key,width,height,created_at)
      VALUES (?,?,'photo','image/webp',?,?,10,10,'now')`,
    ).run(id, museumId, storageKey, originalKey);
    return id;
  };
  const recalculate = () => recalculateMuseumStorageUsageInDatabase(db, museums[0].id, root);
  const used = () => findMuseumByIdInDatabase(db, museums[0].id)!.storageUsedBytes;
  const close = () => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return { directory, root, db, museums, key, file, photo, recalculate, used, close };
}

test("actual optimized and original assets count once, independently of visibility/archive and other Museums", () => {
  const f = fixture();
  try {
    const optimized = f.key();
    const original = f.key(f.museums[0], "original");
    const id = f.photo(optimized, original);
    f.file(optimized, 11);
    f.file(original, 29);
    f.db.prepare("UPDATE uploaded_photos SET library_archived_at='now' WHERE id=?").run(id);
    f.db
      .prepare(
        "INSERT INTO pending_uploads (id,museum_id,storage_key,created_at) VALUES ('overlap',?,?,'now')",
      )
      .run(f.museums[0].id, optimized);
    const other = f.key(f.museums[1]);
    f.photo(other, null, f.museums[1].id);
    f.file(other, 100);
    f.file(`cache/${optimized}.thumbnail.webp`, 200);
    const before = findMuseumByIdInDatabase(f.db, f.museums[0].id)!;
    assert.deepEqual(f.recalculate(), { storageUsedBytes: 40, fileCount: 2, missingKeys: [] });
    assert.equal(f.used(), 40);
    assert.equal(findMuseumByIdInDatabase(f.db, f.museums[1].id)!.storageUsedBytes, 0);
    const after = findMuseumByIdInDatabase(f.db, f.museums[0].id)!;
    assert.equal(after.version, before.version);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.storageQuotaBytes, before.storageQuotaBytes);
    assert.equal(f.recalculate().storageUsedBytes, 40);
  } finally {
    f.close();
  }
});

test("pending upload, deletion and orphan final files count only while physically present", () => {
  const f = fixture();
  try {
    const pending = f.key();
    const deleted = f.key();
    const orphan = f.key();
    f.db
      .prepare(
        "INSERT INTO pending_uploads (id,museum_id,storage_key,created_at) VALUES ('pending',?,?,'now')",
      )
      .run(f.museums[0].id, pending);
    f.db
      .prepare(
        "INSERT INTO photo_deletion_jobs (photo_id,museum_id,optimized_storage_key,created_at) VALUES ('deleted',?,?,'now')",
      )
      .run(f.museums[0].id, deleted);
    f.file(pending, 7);
    f.file(deleted, 13);
    f.file(orphan, 17);
    f.file(`${orphan}.unfinished.tmp`, 100);
    assert.equal(f.recalculate().storageUsedBytes, 37);
    rmSync(path.join(f.root, deleted));
    assert.deepEqual(f.recalculate(), {
      storageUsedBytes: 24,
      fileCount: 2,
      missingKeys: [deleted],
    });
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM photo_deletion_jobs").get()!.count, 1);
  } finally {
    f.close();
  }
});

test("legacy owned originals are counted and deduplicated without moving existing files", () => {
  const f = fixture();
  try {
    const original = `uploads/owner/original/${randomUUID()}.png`;
    const first = `uploads/owner/optimized/${randomUUID()}.webp`;
    const second = `uploads/demo/optimized/${randomUUID()}.webp`;
    f.photo(first, original);
    f.photo(second, original);
    f.file(first, 2);
    f.file(second, 3);
    f.file(original, 5);
    assert.deepEqual(f.recalculate(), { storageUsedBytes: 10, fileCount: 3, missingKeys: [] });
  } finally {
    f.close();
  }
});

test("unscoped interrupted jobs remain attributable through their Museum physical namespace", () => {
  const f = fixture();
  try {
    const storageKey = f.key();
    f.db
      .prepare("INSERT INTO pending_uploads (id,storage_key,created_at) VALUES ('old-job',?,'now')")
      .run(storageKey);
    f.file(storageKey, 19);
    assert.equal(f.recalculate().storageUsedBytes, 19);
  } finally {
    f.close();
  }
});

test("missing registered files contribute no fictional bytes and empty Museums reset stale totals", () => {
  const f = fixture();
  try {
    const missing = f.key();
    f.photo(missing);
    f.db.prepare("UPDATE museums SET storage_used_bytes=123 WHERE id=?").run(f.museums[0].id);
    assert.deepEqual(f.recalculate(), {
      storageUsedBytes: 0,
      fileCount: 0,
      missingKeys: [missing],
    });
    f.db.prepare("DELETE FROM uploaded_photos").run();
    assert.deepEqual(f.recalculate(), { storageUsedBytes: 0, fileCount: 0, missingKeys: [] });
  } finally {
    f.close();
  }
});

test("foreign binding, traversal and ambiguous legacy ownership fail without changing the cached total", () => {
  for (const mode of ["foreign", "traversal", "unassigned", "shared"]) {
    const f = fixture();
    try {
      const storageKey =
        mode === "foreign"
          ? f.key(f.museums[1])
          : mode === "traversal"
            ? "../outside.webp"
            : `uploads/owner/optimized/${randomUUID()}.webp`;
      f.db.prepare("UPDATE museums SET storage_used_bytes=123 WHERE id=?").run(f.museums[0].id);
      if (mode === "unassigned") {
        f.db
          .prepare("INSERT INTO pending_uploads (id,storage_key,created_at) VALUES ('old',?,'now')")
          .run(storageKey);
      } else if (mode === "shared") {
        const original = `uploads/owner/original/${randomUUID()}.jpg`;
        f.photo(storageKey, original);
        f.photo(f.key(f.museums[1]), original, f.museums[1].id);
      } else f.photo(storageKey);
      assert.throws(f.recalculate, /binding|ownership repair|another Museum/);
      assert.equal(f.used(), 123);
      assert.equal(f.db.isTransaction, false);
    } finally {
      f.close();
    }
  }
});

test("linked directories cannot read outside the image root, and failed measurements roll back", () => {
  const f = fixture();
  const external = mkdtempSync(path.join(tmpdir(), "museum-storage-outside-"));
  try {
    const directory = path.join(f.root, `uploads/museums/${f.museums[0].id}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(external, `${randomUUID()}.webp`), Buffer.alloc(777));
    symlinkSync(external, path.join(directory, "optimized"), "junction");
    f.db.prepare("UPDATE museums SET storage_used_bytes=123 WHERE id=?").run(f.museums[0].id);
    assert.throws(f.recalculate, /Linked photo assets/);
    assert.equal(f.used(), 123);
  } finally {
    f.close();
    rmSync(external, { recursive: true, force: true });
  }
});

test("missing Museum cannot measure or modify another Museum", () => {
  const f = fixture();
  try {
    assert.throws(
      () => recalculateMuseumStorageUsageInDatabase(f.db, randomUUID(), f.root),
      /Museum not found/,
    );
    assert.equal(f.used(), 0);
  } finally {
    f.close();
  }
});

test("legacy deletion entry points preserve Museum ownership when file removal fails", async () => {
  const f = fixture();
  try {
    const storageKey = f.key();
    const id = f.photo(storageKey);
    f.file(storageKey, 23);
    await assert.rejects(
      deleteUploadedPhotoInDatabase(
        f.db,
        {
          remove: async () => {
            throw new Error("disk busy");
          },
        },
        id,
      ),
    );
    assert.equal(
      f.db.prepare("SELECT museum_id FROM photo_deletion_jobs WHERE photo_id=?").get(id)!.museum_id,
      f.museums[0].id,
    );
    assert.equal(f.recalculate().storageUsedBytes, 23);
  } finally {
    f.close();
  }
});

test("maintenance command requires quiescence acknowledgement and updates an isolated existing database", () => {
  const f = fixture();
  try {
    const storageKey = f.key();
    f.photo(storageKey);
    f.file(storageKey, 31);
    f.db.prepare("UPDATE museums SET storage_used_bytes=123 WHERE id=?").run(f.museums[0].id);
    const command = (flags: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          fileURLToPath(new URL("../scripts/recalculate-storage-usage.ts", import.meta.url)),
          f.museums[0].id,
          ...flags,
        ],
        {
          env: {
            ...process.env,
            MEMORY_PALACE_DATA_DIR: f.directory,
            MEMORY_PALACE_DATASET: "owner",
          },
          encoding: "utf8",
        },
      );
    const refused = command([]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /pause all file writers/);
    assert.equal(f.used(), 123);
    const result = command(["--quiesced"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      museumId: f.museums[0].id,
      storageUsedBytes: 31,
      fileCount: 1,
      missingKeys: [],
    });
    assert.equal(f.used(), 31);
  } finally {
    f.close();
  }
});
