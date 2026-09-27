import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { migratePhotoStorage } from "../scripts/migrate-photo-storage.ts";
import { restoreBackup } from "../scripts/restore-backup.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "palace-photo-migration-"));
  const data = path.join(root, "data");
  mkdirSync(data);
  const db = initializeDatabase(path.join(data, "palace.sqlite"), false);
  const user = createUserInDatabase(db, {
    email: "test@example.com",
    displayName: "Owner",
    passwordHash: "hash",
  });
  const museum = createMuseumInDatabase(db, {
    ownerId: user.id,
    name: "Museum",
    slug: "photo-migration",
  });
  const key = "uploads/owner/optimized/11111111-1111-4111-8111-111111111111.webp";
  const original = key.replace("optimized", "original").replace(".webp", ".png");
  for (const file of [key, original]) {
    const target = path.join(data, "images", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `bytes:${file}`);
  }
  db.prepare(
    "INSERT INTO uploaded_photos (id,museum_id,original_name,mime_type,optimized_storage_key,original_storage_key,width,height,created_at) VALUES ('photo',?,'Photo','image/webp',?,?,1,1,'now')",
  ).run(museum.id, key, original);
  db.prepare(
    "INSERT INTO stages (id,museum_id,title,created_at,updated_at) VALUES ('stage',?,'Stage','now','now')",
  ).run(museum.id);
  db.prepare("INSERT INTO stage_covers (stage_id,museum_id,storage_key) VALUES ('stage',?,?)").run(
    museum.id,
    key,
  );
  db.prepare(
    "INSERT INTO memories (id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Memory','Story','now','now')",
  ).run(museum.id);
  db.prepare(
    "INSERT INTO memory_images (id,museum_id,memory_id,storage_key,created_at) VALUES ('image',?,'memory',?,'now')",
  ).run(museum.id, key);
  db.close();
  return { root, data, key, original, museumId: museum.id, backupRoot: path.join(root, "backups") };
}

test("offline photo migration preserves bytes, updates all references, repeats safely and restores backups", async () => {
  const f = fixture();
  try {
    const dry = await migratePhotoStorage({ dataDirectory: f.data });
    assert.equal(dry.migrated, 0);
    assert.equal(dry.planned, 1);
    await assert.rejects(
      migratePhotoStorage({ dataDirectory: f.data, apply: true, backupRoot: f.backupRoot }),
      /quiesced/,
    );
    const result = await migratePhotoStorage({
      dataDirectory: f.data,
      apply: true,
      quiesced: true,
      backupRoot: f.backupRoot,
    });
    assert.equal(result.migrated, 1);
    const newKey = f.key.replace("uploads/owner/", `uploads/museums/${f.museumId}/`);
    assert.deepEqual(
      readFileSync(path.join(f.data, "images", newKey)),
      readFileSync(path.join(f.data, "images", f.key)),
    );
    const db = new DatabaseSync(path.join(f.data, "palace.sqlite"), { readOnly: true });
    try {
      assert.equal(
        db.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos").get()!.k,
        newKey,
      );
      assert.equal(db.prepare("SELECT storage_key AS k FROM memory_images").get()!.k, newKey);
      assert.equal(db.prepare("SELECT storage_key AS k FROM stage_covers").get()!.k, newKey);
    } finally {
      db.close();
    }
    assert.equal(
      (
        await migratePhotoStorage({
          dataDirectory: f.data,
          apply: true,
          quiesced: true,
          backupRoot: f.backupRoot,
        })
      ).migrated,
      0,
    );
    await restoreBackup({
      backupDirectory: result.backupDirectory!,
      targetDataDirectory: path.join(f.root, "rollback"),
    });
    const rollback = new DatabaseSync(path.join(f.root, "rollback", "palace.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(
        rollback.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos").get()!.k,
        f.key,
      );
    } finally {
      rollback.close();
    }
    // A post-migration backup must include Museum files, not only legacy Owner files.
    const { createBackup } = await import("../scripts/backup.mjs");
    const post = await createBackup({
      dataDirectory: f.data,
      backupRoot: path.join(f.root, "post"),
      quiesced: true,
    });
    const restored = path.join(f.root, "post-restored");
    await restoreBackup({ backupDirectory: post, targetDataDirectory: restored });
    assert.deepEqual(
      readFileSync(path.join(restored, "images", newKey)),
      readFileSync(path.join(f.data, "images", newKey)),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("migration rejects mismatched bindings and unfinished file operations before updating records", async () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(path.join(f.data, "palace.sqlite"));
    db.prepare("UPDATE memory_images SET museum_id=NULL").run();
    db.close();
    await assert.rejects(migratePhotoStorage({ dataDirectory: f.data }), /binding/);
    const fixed = new DatabaseSync(path.join(f.data, "palace.sqlite"));
    fixed.prepare("UPDATE memory_images SET museum_id=?").run(f.museumId);
    fixed
      .prepare("INSERT INTO pending_uploads (id,storage_key,created_at) VALUES ('pending',?,'now')")
      .run(f.key);
    fixed.close();
    await assert.rejects(migratePhotoStorage({ dataDirectory: f.data }), /file operations/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a conflicting destination leaves database and old files unchanged", async () => {
  const f = fixture();
  try {
    const target = path.join(
      f.data,
      "images",
      f.key.replace("uploads/owner/", `uploads/museums/${f.museumId}/`),
    );
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "different bytes");
    await assert.rejects(
      migratePhotoStorage({
        dataDirectory: f.data,
        apply: true,
        quiesced: true,
        backupRoot: f.backupRoot,
      }),
      /conflict/,
    );
    const db = new DatabaseSync(path.join(f.data, "palace.sqlite"), { readOnly: true });
    try {
      assert.equal(
        db.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos").get()!.k,
        f.key,
      );
    } finally {
      db.close();
    }
    assert.equal(readFileSync(target, "utf8"), "different bytes");
    assert.ok(readFileSync(path.join(f.data, "images", f.key)).length);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("source directory symlinks cannot redirect a migration outside the image root", async () => {
  const f = fixture();
  try {
    const directory = path.dirname(path.join(f.data, "images", f.key));
    const redirected = path.join(f.root, "redirected");
    renameSync(directory, redirected);
    symlinkSync(redirected, directory, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(migratePhotoStorage({ dataDirectory: f.data }), /Unsafe photo filesystem/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("unsafe keys and missing source files are rejected without changing references", async () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(path.join(f.data, "palace.sqlite"));
    db.prepare("UPDATE uploaded_photos SET optimized_storage_key='../outside.webp'").run();
    db.close();
    await assert.rejects(
      migratePhotoStorage({ dataDirectory: f.data }),
      /unsafe photo storage key/,
    );
    const fixed = new DatabaseSync(path.join(f.data, "palace.sqlite"));
    fixed.prepare("UPDATE uploaded_photos SET optimized_storage_key=?").run(f.key);
    fixed.close();
    rmSync(path.join(f.data, "images", f.key));
    await assert.rejects(migratePhotoStorage({ dataDirectory: f.data }), /ENOENT/);
    const unchanged = new DatabaseSync(path.join(f.data, "palace.sqlite"), { readOnly: true });
    try {
      assert.equal(
        unchanged.prepare("SELECT optimized_storage_key AS k FROM uploaded_photos").get()!.k,
        f.key,
      );
    } finally {
      unchanged.close();
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
