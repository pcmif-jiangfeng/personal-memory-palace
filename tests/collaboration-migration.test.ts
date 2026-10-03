import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import test from "node:test";
import { initializeDatabase } from "../src/data/database.ts";
import { createUserInDatabase } from "../src/data/user-repository.ts";
import { createMuseumInDatabase } from "../src/data/museum-repository.ts";
import { auditCollaborationMigration } from "../scripts/audit-collaboration-migration.ts";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { acceptInviteInDatabase } from "../src/data/invite-acceptance.ts";
import { migrateCollaboration } from "../scripts/migrate-collaboration.ts";
import { restoreBackup } from "../scripts/restore-backup.mjs";

const oldInviteToken = "x".repeat(43);
const oldInviteHash = createHash("sha256").update(oldInviteToken).digest("hex");

test("collaboration runner dry-run preserves bytes; apply verifies backup and restore preserves old grants without reviving them", async (t) => {
  const f = fixture(t);
  f.db.exec("DELETE FROM pending_uploads");
  downgradeToVersion28(f.db);
  f.db.close();
  const mappingFile = path.join(f.root, "mapping.json"),
    backups = mkdtempSync(path.join(tmpdir(), "palace-collaboration-backups-"));
  t.after(() => rmSync(backups, { recursive: true, force: true }));
  writeFileSync(
    mappingFile,
    JSON.stringify({
      palaceTypes: { [f.museum.id]: "shared" },
      ownerQuotaBytes: { [f.owner.id]: 4096 },
    }),
  );
  const before = readFileSync(f.databasePath);
  const options = { dataDirectory: f.root, mappingFile };
  assert.equal((await migrateCollaboration(options)).mode, "dry-run");
  assert.deepEqual(readFileSync(f.databasePath), before);
  await assert.rejects(migrateCollaboration({ ...options, apply: true }), /stopped writers/);
  const result = await migrateCollaboration({
    ...options,
    apply: true,
    quiesced: true,
    backupRoot: backups,
  });
  assert.equal(result.schemaVersion, 36);
  const updated = new DatabaseSync(f.databasePath);
  try {
    assert.equal(updated.prepare("SELECT status FROM museum_memberships").get()!.status, "revoked");
    assert.ok(updated.prepare("SELECT revoked_at FROM invite_links").get()!.revoked_at);
    assert.equal(
      updated.prepare("SELECT content,author_user_id FROM later_notes").get()!.content,
      "Private note",
    );
    assert.equal(
      updated.prepare("SELECT author_user_id FROM later_notes").get()!.author_user_id,
      null,
    );
  } finally {
    updated.close();
  }
  const restored = path.join(f.root, "restored");
  assert.ok(result.backupDirectory);
  await restoreBackup({ backupDirectory: result.backupDirectory, targetDataDirectory: restored });
  const original = new DatabaseSync(path.join(restored, "palace.sqlite"));
  try {
    assert.equal(original.prepare("SELECT status FROM museum_memberships").get()!.status, "active");
    assert.equal(original.prepare("SELECT revoked_at FROM invite_links").get()!.revoked_at, null);
  } finally {
    original.close();
  }
});

test("runner requires complete explicit type mapping and never combines multi-palace quota", async (t) => {
  const f = fixture(t);
  f.db.exec("DELETE FROM pending_uploads");
  downgradeToVersion28(f.db);
  f.db.exec("DROP INDEX museums_owner_unique");
  f.db
    .prepare(
      "INSERT INTO museums(id,owner_id,name,slug,created_at,updated_at) VALUES ('second',?,'Second','second','before','before')",
    )
    .run(f.owner.id);
  f.db.close();
  const mappingFile = path.join(f.root, "mapping.json"),
    options = { dataDirectory: f.root, mappingFile },
    before = readFileSync(f.databasePath);
  for (const mapping of [
    { palaceTypes: { [f.museum.id]: "private" }, ownerQuotaBytes: { [f.owner.id]: 8192 } },
    { palaceTypes: { [f.museum.id]: "private", second: "shared" }, ownerQuotaBytes: {} },
  ]) {
    writeFileSync(mappingFile, JSON.stringify(mapping));
    await assert.rejects(migrateCollaboration(options));
    assert.deepEqual(readFileSync(f.databasePath), before);
  }
  writeFileSync(
    mappingFile,
    JSON.stringify({
      palaceTypes: { [f.museum.id]: "private", second: "shared" },
      ownerQuotaBytes: { [f.owner.id]: 8192 },
    }),
  );
  assert.equal((await migrateCollaboration(options)).schemaVersion, 36);
  assert.deepEqual(readFileSync(f.databasePath), before);
});

test("collaboration runner rejects established type/quota changes, pending files and unknown mappings without writes", async (t) => {
  const f = fixture(t),
    mappingFile = path.join(f.root, "mapping.json");
  writeFileSync(mappingFile, JSON.stringify({ palaceTypes: {}, ownerQuotaBytes: {} }));
  f.db.close();
  const options = { dataDirectory: f.root, mappingFile },
    before = readFileSync(f.databasePath);
  await assert.rejects(migrateCollaboration(options), /pending file operations/);
  assert.deepEqual(readFileSync(f.databasePath), before);
  const db = new DatabaseSync(f.databasePath);
  db.exec("DELETE FROM pending_uploads");
  db.close();
  const clean = readFileSync(f.databasePath);
  for (const mapping of [
    { palaceTypes: { [f.museum.id]: "shared" }, ownerQuotaBytes: {} },
    { palaceTypes: {}, ownerQuotaBytes: { [f.owner.id]: 1 } },
    { palaceTypes: { nonexistent: "private" }, ownerQuotaBytes: {} },
  ]) {
    writeFileSync(mappingFile, JSON.stringify(mapping));
    await assert.rejects(migrateCollaboration(options));
    assert.deepEqual(readFileSync(f.databasePath), clean);
  }
});

function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "palace-collaboration-audit-"));
  const databasePath = path.join(root, "palace.sqlite");
  const db = initializeDatabase(databasePath, false);
  t.after(() => {
    if (db.isOpen) db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const owner = createUserInDatabase(db, {
    email: "owner@example.com",
    displayName: "Owner",
    passwordHash: "private-password-hash",
  });
  const guest = createUserInDatabase(db, {
    email: "guest@example.com",
    displayName: "Guest",
    passwordHash: "other-secret",
  });
  const museum = createMuseumInDatabase(db, {
    ownerId: owner.id,
    name: "History",
    slug: "history",
    storageQuotaBytes: 4096,
  });
  db.prepare(
    "INSERT INTO museum_memberships VALUES (?,?,'collaborator','active','before','before')",
  ).run(museum.id, guest.id);
  db.prepare(
    "INSERT INTO invite_links(id,museum_id,token_hash,created_at) VALUES ('old-invite',?,?,'before')",
  ).run(museum.id, oldInviteHash);
  db.prepare(
    "INSERT INTO memories(id,museum_id,title,story,created_at,updated_at) VALUES ('memory',?,'Private title','Private story','before','before')",
  ).run(museum.id);
  db.prepare(
    "INSERT INTO later_notes(id,museum_id,memory_id,content,created_at) VALUES ('note',?,'memory','Private note','before')",
  ).run(museum.id);
  db.prepare(
    "INSERT INTO pending_uploads(id,museum_id,storage_key,created_at) VALUES ('upload',?,'uploads/owner/optimized/pending.webp','before')",
  ).run(museum.id);
  return { root, databasePath, db, owner, guest, museum };
}

function downgradeToVersion28(db: DatabaseSync) {
  if (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='storage_quota_bytes'").get())
    db.exec("ALTER TABLE users DROP COLUMN storage_quota_bytes");
  db.exec(
    "DROP INDEX IF EXISTS museums_owner_unique; DELETE FROM schema_migrations WHERE version>=29",
  );
  if (db.prepare("SELECT 1 FROM pragma_table_info('museums') WHERE name='museum_type'").get()) {
    db.exec("ALTER TABLE museums DROP COLUMN museum_type");
  }
  db.exec("CREATE UNIQUE INDEX museums_owner_unique ON museums(owner_id)");
}

test("migration 30 preserves the single legacy allowance exactly, without resetting an assigned account", (t) => {
  const { db, owner, museum } = fixture(t);
  db.exec(
    "DELETE FROM schema_migrations WHERE version=30; ALTER TABLE users DROP COLUMN storage_quota_bytes",
  );
  const contents = db.prepare("SELECT * FROM memories").all();
  const legacy = db.prepare("SELECT * FROM museums WHERE id=?").get(museum.id);
  runDatabaseMigrations(db);
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(owner.id)!
      .storage_quota_bytes,
    4096,
  );
  assert.deepEqual(db.prepare("SELECT * FROM museums WHERE id=?").get(museum.id), legacy);
  db.prepare("UPDATE users SET storage_quota_bytes=8192 WHERE id=?").run(owner.id);
  runDatabaseMigrations(db);
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(owner.id)!
      .storage_quota_bytes,
    8192,
  );
  assert.deepEqual(db.prepare("SELECT * FROM memories").all(), contents);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("migration 30 refuses to combine multi-palace allowances and preserves an explicit operator mapping", (t) => {
  const { db, owner, museum } = fixture(t);
  db.exec(
    "DELETE FROM schema_migrations WHERE version=30; ALTER TABLE users DROP COLUMN storage_quota_bytes",
  );
  db.prepare(
    `INSERT INTO museums(id,owner_id,museum_type,name,slug,storage_quota_bytes,created_at,updated_at)
    VALUES ('shared',?,'shared','Shared','shared',32768,'now','now')`,
  ).run(owner.id);
  const before = db.prepare("SELECT * FROM museums ORDER BY id").all();
  assert.throws(() => runDatabaseMigrations(db), /explicit multi-palace quota mapping/);
  assert.equal(db.prepare("SELECT 1 FROM schema_migrations WHERE version=30").get(), undefined);
  assert.equal(
    db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='storage_quota_bytes'").get(),
    undefined,
  );
  assert.deepEqual(db.prepare("SELECT * FROM museums ORDER BY id").all(), before);
  db.exec("ALTER TABLE users ADD COLUMN storage_quota_bytes INTEGER CHECK(storage_quota_bytes>=0)");
  db.prepare("UPDATE users SET storage_quota_bytes=16384 WHERE id=?").run(owner.id);
  runDatabaseMigrations(db);
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM users WHERE id=?").get(owner.id)!
      .storage_quota_bytes,
    16384,
  );
  assert.equal(
    db.prepare("SELECT storage_quota_bytes FROM museums WHERE id=?").get(museum.id)!
      .storage_quota_bytes,
    4096,
  );
  assert.deepEqual(db.prepare("SELECT * FROM museums ORDER BY id").all(), before);
});

test("migration 29 preserves content, isolates old grants once and allows multiple shared but one private palace", (t) => {
  const { db, museum, owner, guest } = fixture(t);
  db.prepare("UPDATE users SET email_verified=1").run();
  createMuseumInDatabase(db, { ownerId: guest.id, name: "Guest", slug: "guest" });
  assert.equal(acceptInviteInDatabase(db, guest.id, oldInviteToken).alreadyMember, true);
  downgradeToVersion28(db);
  const contents = db.prepare("SELECT * FROM memories").all();
  const notes = db.prepare("SELECT * FROM later_notes").all();
  runDatabaseMigrations(db);
  assert.equal(
    db.prepare("SELECT museum_type FROM museums WHERE id=?").get(museum.id)?.museum_type,
    "private",
  );
  assert.equal(db.prepare("SELECT status FROM museum_memberships").get()?.status, "revoked");
  assert.equal(
    db.prepare("SELECT created_at,updated_at FROM museum_memberships").get()?.created_at,
    "before",
  );
  assert.ok(db.prepare("SELECT revoked_at FROM invite_links").get()?.revoked_at);
  assert.throws(() => acceptInviteInDatabase(db, guest.id, oldInviteToken), /INVITE_UNAVAILABLE/);
  assert.deepEqual(db.prepare("SELECT * FROM memories").all(), contents);
  assert.deepEqual(db.prepare("SELECT * FROM later_notes").all(), notes);
  const insert = db.prepare(
    "INSERT INTO museums(id,owner_id,name,slug,museum_type,created_at,updated_at) VALUES (?,?,?, ?,?,'now','now')",
  );
  insert.run("shared-1", owner.id, "Shared1", "shared-1", "shared");
  insert.run("shared-2", owner.id, "Shared2", "shared-2", "shared");
  assert.throws(
    () => insert.run("private-2", owner.id, "Private2", "private-2", "private"),
    /UNIQUE/,
  );
  assert.throws(() => insert.run("invalid", owner.id, "Invalid", "invalid", "other"), /CHECK/);
  db.prepare("UPDATE museum_memberships SET status='active'").run();
  runDatabaseMigrations(db);
  assert.equal(db.prepare("SELECT status FROM museum_memberships").get()?.status, "active");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=29").get()?.n,
    1,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("ambiguous legacy type migration rolls back without deleting data or revoking existing records", (t) => {
  const { db, owner } = fixture(t);
  downgradeToVersion28(db);
  db.exec("DROP INDEX museums_owner_unique");
  db.prepare(
    "INSERT INTO museums(id,owner_id,name,slug,created_at,updated_at) VALUES ('ambiguous',?,'Ambiguous','ambiguous','before','before')",
  ).run(owner.id);
  const before = db.prepare("SELECT * FROM museums").all();
  assert.throws(() => runDatabaseMigrations(db), /explicit.*mapping/i);
  assert.deepEqual(db.prepare("SELECT * FROM museums").all(), before);
  assert.equal(db.prepare("SELECT status FROM museum_memberships").get()?.status, "active");
  assert.equal(db.prepare("SELECT revoked_at FROM invite_links").get()?.revoked_at, null);
  assert.equal(db.prepare("SELECT 1 FROM schema_migrations WHERE version=29").get(), undefined);
});

test("a pre-migration SQLite backup restores original types, grants and content without reverse mutations", async (t) => {
  const { db, root } = fixture(t);
  downgradeToVersion28(db);
  const before = db.prepare("SELECT * FROM memories").all();
  const backupPath = path.join(root, "before-migration.sqlite");
  await backup(db, backupPath);
  runDatabaseMigrations(db);
  assert.equal(db.prepare("SELECT status FROM museum_memberships").get()?.status, "revoked");
  const restored = new DatabaseSync(backupPath, { readOnly: true });
  try {
    assert.deepEqual(restored.prepare("SELECT * FROM memories").all(), before);
    assert.equal(restored.prepare("SELECT status FROM museum_memberships").get()?.status, "active");
    assert.equal(restored.prepare("SELECT revoked_at FROM invite_links").get()?.revoked_at, null);
    assert.equal(
      restored.prepare("SELECT 1 FROM schema_migrations WHERE version=29").get(),
      undefined,
    );
    assert.equal(
      restored.prepare("SELECT 1 FROM pragma_table_info('museums') WHERE name='museum_type'").get(),
      undefined,
    );
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    restored.close();
  }
});

test("collaboration audit inventories ownership and old grants without modifying any database bytes", (t) => {
  const { db, databasePath, museum, owner } = fixture(t);
  db.close();
  const before = readFileSync(databasePath);
  const report = auditCollaborationMigration(databasePath);
  assert.equal(report.mode, "read-only");
  assert.equal(report.schemaVersion, 36);
  assert.equal(report.museums[0].id, museum.id);
  assert.equal(report.museums[0].ownerId, owner.id);
  assert.equal(report.museums[0].currentType, "private");
  assert.equal(report.museums[0].suggestedType, "private");
  assert.equal(report.museums[0].activeMemberships, 1);
  assert.equal(report.museums[0].unrevokedInvites, 1);
  assert.equal(report.owners[0].suggestedQuotaBytes, 4096);
  assert.equal(report.unknownAuthors.memories, 1);
  assert.equal(report.unknownAuthors.laterNotes, 1);
  assert.equal(report.pendingOperations.pending_uploads, 1);
  assert.ok(report.issues.includes("PENDING_FILE_OPERATIONS"));
  assert.deepEqual(readFileSync(databasePath), before);
  const serialized = JSON.stringify(report);
  for (const secret of [
    "private-password-hash",
    "other-secret",
    "Private story",
    "Private note",
    "Private title",
    oldInviteHash,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("audit recognizes canonical Note authors without changing database bytes", (t) => {
  const { db, databasePath, owner } = fixture(t);
  db.prepare("UPDATE later_notes SET author_user_id=? WHERE id='note'").run(owner.id);
  const before = readFileSync(databasePath);
  assert.equal(auditCollaborationMigration(databasePath).unknownAuthors.laterNotes, 0);
  assert.deepEqual(readFileSync(databasePath), before);
});

test("audit reports the assigned account allowance rather than stale per-palace values", (t) => {
  const { db, databasePath, owner } = fixture(t);
  db.prepare("UPDATE users SET storage_quota_bytes=16384 WHERE id=?").run(owner.id);
  db.prepare(
    "INSERT INTO museums(id,owner_id,museum_type,name,slug,created_at,updated_at) VALUES ('shared',?,'shared','Shared','shared','now','now')",
  ).run(owner.id);
  db.close();
  const report = auditCollaborationMigration(databasePath);
  assert.equal(report.owners[0].currentAccountQuotaBytes, 16384);
  assert.equal(report.owners[0].suggestedQuotaBytes, 16384);
  assert.equal(report.issues.includes("AMBIGUOUS_ACCOUNT_QUOTA"), false);
});

test("audit reports multi-owned palaces without guessing their types or adding their quotas", (t) => {
  const { db, databasePath, owner } = fixture(t);
  downgradeToVersion28(db);
  db.exec("DROP INDEX museums_owner_unique");
  db.prepare(
    "INSERT INTO museums(id,owner_id,name,slug,storage_quota_bytes,created_at,updated_at) VALUES ('other',?,'Other','other',8192,'before','before')",
  ).run(owner.id);
  db.close();
  const report = auditCollaborationMigration(databasePath);
  assert.ok(report.museums.every((museum) => museum.suggestedType === null));
  assert.equal(report.owners[0].suggestedQuotaBytes, null);
  assert.ok(report.issues.includes("AMBIGUOUS_MUSEUM_TYPES"));
  assert.ok(report.issues.includes("AMBIGUOUS_ACCOUNT_QUOTA"));
});

test("audit refuses missing or incompatible databases rather than initializing or migrating them", (t) => {
  const { db, root } = fixture(t);
  db.close();
  const missing = path.join(root, "missing.sqlite");
  assert.throws(() => auditCollaborationMigration(missing));
  assert.equal(existsSync(missing), false);
  const incompatible = path.join(root, "incompatible.sqlite");
  const old = new DatabaseSync(incompatible);
  old.exec("CREATE TABLE unrelated(id TEXT)");
  old.close();
  const before = readFileSync(incompatible);
  assert.throws(() => auditCollaborationMigration(incompatible), /Unsupported audit schema/);
  assert.deepEqual(readFileSync(incompatible), before);
});

test("audit includes unassigned photos and stages, and surfaces orphan owners without guessing", (t) => {
  const { db, databasePath, museum } = fixture(t);
  db.prepare(
    "INSERT INTO stages(id,title,created_at,updated_at) VALUES ('unassigned-stage','Private chapter','before','before')",
  ).run();
  db.prepare(
    "INSERT INTO uploaded_photos(id,original_name,mime_type,optimized_storage_key,width,height,created_at) VALUES ('unassigned-photo','secret-name.jpg','image/webp','uploads/owner/optimized/unassigned.webp',1,1,'before')",
  ).run();
  db.exec("PRAGMA foreign_keys=OFF");
  db.prepare("UPDATE museums SET owner_id='missing-owner' WHERE id=?").run(museum.id);
  db.close();
  const report = auditCollaborationMigration(databasePath);
  assert.equal(report.unassigned.uploaded_photos, 1);
  assert.equal(report.unassigned.stages, 1);
  assert.equal(report.museums[0].suggestedType, null);
  assert.equal(report.owners[0].suggestedQuotaBytes, null);
  assert.ok(report.integrity.foreignKeyViolations > 0);
  assert.ok(report.issues.includes("MISSING_OWNER"));
  assert.ok(report.issues.includes("UNASSIGNED_RECORDS"));
  assert.equal(JSON.stringify(report).includes("secret-name.jpg"), false);
});

test("audit CLI requires an explicit database and rejects mutation flags", (t) => {
  const { db, databasePath } = fixture(t);
  db.close();
  const before = readFileSync(databasePath);
  const script = path.resolve("scripts/audit-collaboration-migration.ts");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], {
      encoding: "utf8",
    });
  const result = run("--database", databasePath);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, "read-only");
  for (const args of [
    [],
    ["--database", databasePath, "--apply"],
    ["--database", databasePath, "--database", databasePath],
  ]) {
    assert.notEqual(run(...args).status, 0);
  }
  assert.deepEqual(readFileSync(databasePath), before);
});
