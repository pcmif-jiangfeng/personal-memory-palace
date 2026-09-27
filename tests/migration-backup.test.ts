import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";

test("pre-migration backup restores SQLite, photos and private config into isolation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "memory-palace-migration-backup-"));
  const data = path.join(root, "data");
  const backups = path.join(root, "backups");
  const restored = path.join(root, "restored");
  const config = path.join(root, "config", "app.env");
  const configContents = "MEMORY_PALACE_SESSION_SECRET=test-only-secret\n";
  try {
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, configContents);
    const photo = path.join(data, "images", "uploads", "owner", "optimized", "photo.webp");
    mkdirSync(path.dirname(photo), { recursive: true });
    writeFileSync(photo, "photo-bytes");
    const database = initializeDatabase(path.join(data, "palace.sqlite"), false);
    database.close();

    const backup = spawnSync(
      process.execPath,
      ["scripts/backup.mjs", data, backups, "--quiesced", "--config-file", config],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(backup.status, 0, backup.stderr);
    const backupDirectory = path.join(backups, readdirSync(backups)[0]);
    assert.equal(
      readFileSync(path.join(backupDirectory, "config", "app.env"), "utf8"),
      configContents,
    );
    assert.equal(
      readFileSync(
        path.join(backupDirectory, "uploads", "owner", "optimized", "photo.webp"),
        "utf8",
      ),
      "photo-bytes",
    );

    const restore = spawnSync(
      process.execPath,
      ["scripts/restore-backup.mjs", backupDirectory, restored],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(restore.status, 0, restore.stderr);
    assert.equal(
      readFileSync(path.join(restored, ".migration-config", "app.env"), "utf8"),
      configContents,
    );
    assert.equal(
      readFileSync(
        path.join(restored, "images", "uploads", "owner", "optimized", "photo.webp"),
        "utf8",
      ),
      "photo-bytes",
    );
    const restoredDatabase = new DatabaseSync(path.join(restored, "palace.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(restoredDatabase.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    } finally {
      restoredDatabase.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-migration backup does not publish a backup when the config file is missing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "memory-palace-migration-backup-"));
  const data = path.join(root, "data");
  const backups = path.join(root, "backups");
  try {
    mkdirSync(data, { recursive: true });
    initializeDatabase(path.join(data, "palace.sqlite"), false).close();
    const backup = spawnSync(
      process.execPath,
      [
        "scripts/backup.mjs",
        data,
        backups,
        "--quiesced",
        "--config-file",
        path.join(root, "missing.env"),
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(backup.status, 0);
    assert.equal(existsSync(backups) ? readdirSync(backups).length : 0, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
