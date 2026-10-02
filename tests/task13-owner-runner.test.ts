import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { migrateTask13Owner } from "../scripts/migrate-task13-owner.ts";
import { restoreBackup } from "../scripts/restore-backup.mjs";

test("owner runner dry-run is read-only; apply verifies a restorable backup and preserves files, IDs and shares", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "palace-owner-runner-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  mkdirSync(data);
  mkdirSync(backupRoot);
  const db = initializeDatabase(path.join(data, "palace.sqlite"), false);
  const user = createUserInDatabase(db, {
    email: "original@example.com",
    displayName: "Original",
    passwordHash: "unchanged",
  });
  db.prepare("UPDATE users SET email_verified=1 WHERE id=?").run(user.id);
  const museum = createMuseumInDatabase(db, {
    ownerId: user.id,
    name: "Original",
    slug: "original",
  });
  const key = "uploads/owner/optimized/11111111-1111-4111-8111-111111111111.webp";
  const image = path.join(data, "images", key);
  mkdirSync(path.dirname(image), { recursive: true });
  writeFileSync(image, "unchanged image bytes");
  db.prepare(
    "INSERT INTO memories(id,title,story,created_at,updated_at) VALUES ('history','Past','Story','before','before')",
  ).run();
  db.prepare(
    "INSERT INTO uploaded_photos(id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('photo','image.webp','image/webp',?,10,10,'before')",
  ).run(key);
  db.prepare(
    "INSERT INTO memory_images(id,memory_id,storage_key,created_at) VALUES ('image','history',?,'before')",
  ).run(key);
  db.prepare(
    "INSERT INTO share_configs(id,memory_id,enabled,created_at,updated_at) VALUES ('old-share-token','history',1,'before','before')",
  ).run();
  const configFile = path.join(root, "app.env");
  writeFileSync(configFile, "TEST_ONLY=fixture");
  const before = db.prepare("SELECT * FROM memories").all();
  db.close();
  const dry = await migrateTask13Owner({ dataDirectory: data, ownerEmail: user.email });
  assert.equal(dry.mode, "dry-run");
  assert.deepEqual(dry.before, dry.after);
  const readOnly = new DatabaseSync(path.join(data, "palace.sqlite"), { readOnly: true });
  assert.deepEqual(readOnly.prepare("SELECT * FROM memories").all(), before);
  readOnly.close();
  await assert.rejects(
    migrateTask13Owner({ dataDirectory: data, ownerEmail: user.email, apply: true }),
    /Apply requires/,
  );
  const report = await migrateTask13Owner({
    dataDirectory: data,
    ownerEmail: user.email,
    apply: true,
    quiesced: true,
    confirmEmail: user.email,
    backupRoot,
    configFile,
  });
  assert.equal(report.mode, "applied");
  assert.ok(report.backupDirectory);
  const migrated = new DatabaseSync(path.join(data, "palace.sqlite"), { readOnly: true });
  assert.equal(migrated.prepare("SELECT museum_id FROM memories").get()?.museum_id, museum.id);
  assert.equal(migrated.prepare("SELECT id FROM share_configs").get()?.id, "old-share-token");
  assert.equal(
    migrated.prepare("SELECT optimized_storage_key FROM uploaded_photos").get()
      ?.optimized_storage_key,
    key,
  );
  assert.equal(
    migrated.prepare("SELECT password_hash FROM users").get()?.password_hash,
    "unchanged",
  );
  migrated.close();
  assert.equal(readFileSync(image, "utf8"), "unchanged image bytes");
  const restored = path.join(root, "rollback");
  await restoreBackup({ backupDirectory: report.backupDirectory!, targetDataDirectory: restored });
  const original = new DatabaseSync(path.join(restored, "palace.sqlite"), { readOnly: true });
  assert.deepEqual(original.prepare("SELECT * FROM memories").all(), before);
  original.close();
  assert.equal(readFileSync(path.join(restored, "images", key), "utf8"), "unchanged image bytes");
});
