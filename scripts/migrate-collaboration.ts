import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { runDatabaseMigrations } from "../src/data/migrations.ts";
import { withTransaction } from "../src/data/transaction.ts";
import { auditCollaborationMigration } from "./audit-collaboration-migration.ts";
import { createBackup } from "./backup.mjs";
import { restoreBackup } from "./restore-backup.mjs";
import { uploadFingerprint } from "./finalize-museum-deletion.ts";

type Mapping = {
  palaceTypes: Record<string, "private" | "shared">;
  ownerQuotaBytes: Record<string, number>;
};
function parseMapping(value: unknown): Mapping {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid mapping");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !["palaceTypes", "ownerQuotaBytes"].includes(key)))
    throw new Error("Unknown mapping field");
  for (const key of ["palaceTypes", "ownerQuotaBytes"])
    if (!object[key] || typeof object[key] !== "object" || Array.isArray(object[key]))
      throw new Error("Explicit mapping objects required");
  const mapping = object as Mapping;
  if (
    Object.values(mapping.palaceTypes).some((type) => type !== "private" && type !== "shared") ||
    Object.values(mapping.ownerQuotaBytes).some(
      (bytes) => !Number.isSafeInteger(bytes) || bytes < 0,
    )
  )
    throw new Error("Invalid type or quota mapping");
  return mapping;
}
function fingerprint(db: DatabaseSync) {
  const hash = createHash("sha256");
  for (const row of db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all()) {
    const name = String(row.name),
      quoted = `"${name.replaceAll('"', '""')}"`;
    hash.update(name);
    for (const record of db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).iterate())
      hash.update(JSON.stringify(record));
  }
  return hash.digest("hex");
}
function migrate(db: DatabaseSync, mapping: Mapping) {
  withTransaction(db, () => {
    const applied = Number(
      db.prepare("SELECT COALESCE(MAX(version),0) n FROM schema_migrations").get()!.n,
    );
    const has = (table: string, column: string) =>
      Boolean(db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name=?").get(table, column));
    const typeEntries = Object.entries(mapping.palaceTypes);
    if (typeEntries.length && !has("museums", "museum_type")) {
      if (typeEntries.length !== Number(db.prepare("SELECT COUNT(*) n FROM museums").get()!.n))
        throw new Error("Type mapping must cover every palace before introducing types");
      db.exec(
        "ALTER TABLE museums ADD COLUMN museum_type TEXT NOT NULL DEFAULT 'private' CHECK(museum_type IN ('private','shared'))",
      );
    }
    for (const [id, type] of typeEntries) {
      const row = db.prepare("SELECT museum_type FROM museums WHERE id=?").get(id);
      if (!row) throw new Error("Unknown palace mapping ID");
      if (applied >= 29 && row.museum_type !== type)
        throw new Error("Changing an established palace type is disabled");
      if (applied < 29) db.prepare("UPDATE museums SET museum_type=? WHERE id=?").run(type, id);
    }
    const quotaEntries = Object.entries(mapping.ownerQuotaBytes);
    if (quotaEntries.length && !has("users", "storage_quota_bytes"))
      db.exec(
        "ALTER TABLE users ADD COLUMN storage_quota_bytes INTEGER CHECK(storage_quota_bytes>=0)",
      );
    for (const [id, bytes] of quotaEntries) {
      const row = db
        .prepare(
          "SELECT storage_quota_bytes FROM users WHERE id=? AND EXISTS(SELECT 1 FROM museums WHERE owner_id=users.id)",
        )
        .get(id);
      if (!row) throw new Error("Unknown quota owner mapping ID");
      if (row.storage_quota_bytes !== null && row.storage_quota_bytes !== bytes)
        throw new Error("Mapping cannot reset an assigned account quota");
      db.prepare(
        "UPDATE users SET storage_quota_bytes=? WHERE id=? AND storage_quota_bytes IS NULL",
      ).run(bytes, id);
    }
    runDatabaseMigrations(db);
  });
}

export async function migrateCollaboration(options: {
  dataDirectory: string;
  mappingFile: string;
  apply?: boolean;
  quiesced?: boolean;
  backupRoot?: string;
}) {
  if (options.apply && (!options.quiesced || !options.backupRoot))
    throw new Error("Apply requires stopped writers, --quiesced and --backup-root");
  const data = await realpath(options.dataDirectory),
    file = path.join(data, "palace.sqlite"),
    info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Existing regular database required");
  const mapping = parseMapping(JSON.parse(await readFile(options.mappingFile, "utf8")));
  const before = auditCollaborationMigration(file);
  if (
    !before.integrity.integrityOk ||
    before.integrity.foreignKeyViolations ||
    Object.values(before.pendingOperations).some((n) => n > 0) ||
    Object.values(before.unassigned).some((n) => n > 0)
  )
    throw new Error(
      "Resolve integrity, unassigned data and pending file operations before migration",
    );
  const backupRoot = options.backupRoot ? await realpath(options.backupRoot) : undefined;
  if (backupRoot) {
    const relative = path.relative(data, backupRoot);
    if (
      !relative ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    )
      throw new Error("Backup root must be outside data");
  }
  const lockPath = path.join(data, ".collaboration-migration.lock"),
    lock = options.apply ? await open(lockPath, "wx", 0o600) : null;
  let temporary: string | undefined;
  let db: DatabaseSync | undefined, backupDirectory: string | undefined;
  try {
    temporary = await mkdtemp(path.join(tmpdir(), "palace-collaboration-migration-"));
    db = new DatabaseSync(file, { readOnly: !options.apply });
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    const original = fingerprint(db),
      copyPath = path.join(temporary, "palace.sqlite");
    const photos = await uploadFingerprint(path.join(data, "images", "uploads"));
    await backup(db, copyPath);
    const copy = new DatabaseSync(copyPath);
    try {
      copy.exec("PRAGMA foreign_keys=ON");
      migrate(copy, mapping);
    } finally {
      copy.close();
    }
    const after = auditCollaborationMigration(copyPath);
    if (!after.integrity.integrityOk || after.integrity.foreignKeyViolations)
      throw new Error("Migrated copy integrity failed");
    if (options.apply) {
      backupDirectory = await createBackup({
        dataDirectory: data,
        backupRoot: path.join(backupRoot!, `collaboration-${randomUUID()}`),
        quiesced: true,
      });
      const restored = path.join(temporary, "restore");
      await restoreBackup({ backupDirectory, targetDataDirectory: restored });
      if (
        (await uploadFingerprint(path.join(restored, "images", "uploads"))) !== photos ||
        (await uploadFingerprint(path.join(data, "images", "uploads"))) !== photos
      )
        throw new Error("Photo files changed during backup or restore");
      const restoredDb = new DatabaseSync(path.join(restored, "palace.sqlite"), { readOnly: true });
      try {
        if (fingerprint(restoredDb) !== original)
          throw new Error("Restored backup differs from migration source");
      } finally {
        restoredDb.close();
      }
      withTransaction(db, () => {
        if (fingerprint(db!) !== original) throw new Error("Data changed; stop all writers");
        migrate(db!, mapping);
      });
    }
    return {
      mode: options.apply ? "applied" : "dry-run",
      schemaVersion: after.schemaVersion,
      backupDirectory,
      issues: after.issues,
    };
  } finally {
    db?.close();
    try {
      if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
    } finally {
      if (lock) {
        await lock.close();
        await unlink(lockPath);
      }
    }
  }
}
if (
  import.meta.url === (process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "")
) {
  const [dataDirectory, mappingFile, ...flags] = process.argv.slice(2);
  try {
    if (!dataDirectory || !mappingFile)
      throw new Error(
        "Usage: migrate-collaboration.ts <data-directory> <mapping.json> [--apply --quiesced --backup-root=<existing-directory>]",
      );
    if (
      new Set(flags).size !== flags.length ||
      flags.some(
        (flag) => !["--apply", "--quiesced"].includes(flag) && !flag.startsWith("--backup-root="),
      ) ||
      flags.filter((flag) => flag.startsWith("--backup-root=")).length > 1
    )
      throw new Error("Invalid migration arguments");
    await migrateCollaboration({
      dataDirectory,
      mappingFile,
      apply: flags.includes("--apply"),
      quiesced: flags.includes("--quiesced"),
      backupRoot: flags.find((flag) => flag.startsWith("--backup-root="))?.slice(14),
    }).then((result) => console.log(JSON.stringify(result, null, 2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  }
}
