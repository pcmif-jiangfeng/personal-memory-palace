import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";

test("creates an integrity-checked backup and restores it into an isolated data directory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "memory-palace-backup-"));
  const dataDirectory = path.join(directory, "data");
  const backupRoot = path.join(directory, "backups");
  const restoreDirectory = path.join(directory, "restore-test");
  const storageKey = "uploads/owner/optimized/test-image.webp";

  try {
    mkdirSync(path.join(dataDirectory, "images", "uploads", "owner", "optimized"), { recursive: true });
    writeFileSync(path.join(dataDirectory, "images", storageKey), "test-image");
    const database = initializeDatabase(path.join(dataDirectory, "palace.sqlite"), false);
    database.prepare(`INSERT INTO uploaded_photos
      (id, original_name, mime_type, optimized_storage_key, original_storage_key, width, height, created_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
    ).run("photo-test", "test.webp", "image/webp", storageKey, 10, 10, new Date().toISOString());
    database.close();

    const backupResult = spawnSync(process.execPath, ["scripts/backup.mjs", dataDirectory, backupRoot], {
      cwd: process.cwd(), encoding: "utf8",
    });
    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backupDirectory = path.join(backupRoot, readdirSync(backupRoot)[0]);

    const restoreResult = spawnSync(
      process.execPath,
      ["scripts/restore-backup.mjs", backupDirectory, restoreDirectory],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(restoreResult.status, 0, restoreResult.stderr);
    assert.match(restoreResult.stdout, /"referencedImages":1/);
    assert.equal(
      readdirSync(path.join(restoreDirectory, "images", "uploads", "owner", "optimized")).length,
      1,
    );

    const restored = initializeDatabase(path.join(restoreDirectory, "palace.sqlite"), false);
    const count = restored.prepare("SELECT COUNT(*) AS count FROM uploaded_photos").get() as { count: number };
    restored.close();
    assert.equal(count.count, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
