import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { isMuseumPhotoAssetKey, photoUuidPattern } from "../storage/photo-storage-key.ts";
import { readNumber, readNullableString, readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export const museumPermanentDeletionSchemaSql = `
CREATE TABLE IF NOT EXISTS museum_permanent_deletion_jobs (
  museum_id TEXT PRIMARY KEY REFERENCES museums(id) ON DELETE RESTRICT,
  backup_directory TEXT NOT NULL CHECK(length(backup_directory)>0),
  backup_fingerprint TEXT NOT NULL CHECK(length(backup_fingerprint)=64 AND backup_fingerprint NOT GLOB '*[^0-9a-f]*'),
  started_at TEXT NOT NULL
);`;

// Children precede parents; Users, their sessions and email tokens are not Museum-owned.
export const museumOwnedDeletionTables = [
  "museum_support_access", "museum_notifications", "invite_links", "museum_memberships",
  "share_configs", "memory_relations", "later_notes", "memory_images", "stage_covers",
  "pending_uploads", "photo_deletion_jobs", "photo_asset_usage", "audit_logs",
  "memories", "stages", "uploaded_photos",
] as const;

export interface MuseumPermanentDeletionPlan {
  museumId: string;
  version: number;
  deletionScheduledAt: string;
  resuming: boolean;
  backupDirectory: string | null;
  backupFingerprint: string | null;
  counts: Record<string, number>;
}

function protectedDataFingerprint(db: DatabaseSync, id: string) {
  const hash = createHash("sha256");
  for (const table of [...museumOwnedDeletionTables, "museum_permanent_deletion_jobs"]) {
    hash.update(table);
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE museum_id IS NOT ? ORDER BY rowid`).iterate(id))
      hash.update(JSON.stringify(row));
  }
  hash.update("museums");
  for (const row of db.prepare("SELECT * FROM museums WHERE id<>? ORDER BY rowid").iterate(id))
    hash.update(JSON.stringify(row));
  for (const table of ["users", "user_sessions", "email_verification_tokens", "password_reset_tokens"]) {
    hash.update(table);
    for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate())
      hash.update(JSON.stringify(row));
  }
  return hash.digest("hex");
}

function rejectCrossMuseumBindings(db: DatabaseSync, id: string) {
  for (const [child, parent, foreignKey] of [
    ["memories", "stages", "stage_id"],
    ["memory_images", "memories", "memory_id"],
    ["stage_covers", "stages", "stage_id"],
    ["later_notes", "memories", "memory_id"],
    ["share_configs", "memories", "memory_id"],
    ["museum_support_access", "memories", "memory_id"],
  ] as const) {
    if (db.prepare(`SELECT 1 FROM ${child} c JOIN ${parent} p ON p.id=c.${foreignKey}
      WHERE (c.museum_id=? OR p.museum_id=?) AND (c.museum_id IS NOT ? OR p.museum_id IS NOT ?) LIMIT 1`)
      .get(id, id, id, id)) throw new Error("Cross-Museum content binding; cleanup refused");
  }
  if (db.prepare(`SELECT 1 FROM memory_relations r
    JOIN memories a ON a.id=r.memory_id JOIN memories b ON b.id=r.related_memory_id
    WHERE (r.museum_id=? OR a.museum_id=? OR b.museum_id=?)
    AND (r.museum_id IS NOT ? OR a.museum_id IS NOT ? OR b.museum_id IS NOT ?) LIMIT 1`)
    .get(id, id, id, id, id, id)) throw new Error("Cross-Museum relation; cleanup refused");
  if (db.prepare(`SELECT 1 FROM museums m JOIN uploaded_photos p ON p.id=m.cover_photo_id
    WHERE (m.id=? OR p.museum_id=?) AND (m.id IS NOT ? OR p.museum_id IS NOT ?) LIMIT 1`)
    .get(id, id, id, id)) throw new Error("Cross-Museum cover; cleanup refused");

  const prefix = `uploads/museums/${id}/`;
  for (const [table, columns, allowStatic] of [
    ["uploaded_photos", ["optimized_storage_key", "original_storage_key"], false],
    ["photo_deletion_jobs", ["optimized_storage_key", "original_storage_key"], false],
    ["pending_uploads", ["storage_key"], false],
    ["photo_asset_usage", ["storage_key"], false],
    ["memory_images", ["storage_key"], true],
    ["stage_covers", ["storage_key"], true],
  ] as const) {
    for (const column of columns) {
      const rows = db.prepare(`SELECT museum_id,${column} AS storage_key FROM ${table}
        WHERE museum_id=? OR ${column} GLOB ?`).iterate(id, `${prefix}*`);
      for (const row of rows) {
        const key = readNullableString(row, "storage_key");
        if (key === null) continue;
        if (row.museum_id !== id) throw new Error("Cross-Museum photo reference; cleanup refused");
        if (allowStatic && !key.startsWith("uploads/")) continue;
        if (!isMuseumPhotoAssetKey(key, id))
          throw new Error("Invalid photo ownership; Migrate legacy photo storage before final deletion");
      }
    }
  }
}

export function planMuseumPermanentDeletion(db: DatabaseSync, id: string, now = new Date()): MuseumPermanentDeletionPlan {
  if (!new RegExp(`^${photoUuidPattern}$`).test(id)) throw new Error("Invalid Museum ID");
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid deletion time");
  const museum = db.prepare("SELECT status,version,deletion_scheduled_at FROM museums WHERE id=?").get(id);
  if (!museum) throw new Error("Museum not found");
  const deadline = readNullableString(museum, "deletion_scheduled_at");
  if (museum.status !== "pending_deletion" || !deadline || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) > now.getTime())
    throw new Error("Museum is not due for permanent deletion");
  if (db.prepare("PRAGMA foreign_key_check").all().length || db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
    throw new Error("Database integrity check failed");
  // Unknown owned tables must be handled explicitly, not silently cascaded or left behind.
  for (const row of db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()) {
    const table = readString(row, "name");
    if (!db.prepare(`SELECT name FROM pragma_table_info(?) WHERE name='museum_id'`).get(table)) continue;
    if (table !== "museum_permanent_deletion_jobs" && !museumOwnedDeletionTables.some((known) => known === table))
      throw new Error("Unknown Museum-owned table; update cleanup policy first");
  }
  rejectCrossMuseumBindings(db, id);
  const hasJournal = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='museum_permanent_deletion_jobs'").get();
  const job = hasJournal ? db.prepare("SELECT backup_directory,backup_fingerprint FROM museum_permanent_deletion_jobs WHERE museum_id=?").get(id) : undefined;
  const counts = Object.fromEntries(museumOwnedDeletionTables.map((table) => [
    table, readNumber(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE museum_id=?`).get(id)!, "n"),
  ]));
  if (job && Object.values(counts).some((count) => count !== 0)) throw new Error("Cleanup journal contains unexpected new data");
  return { museumId: id, version: readNumber(museum, "version"), deletionScheduledAt: deadline,
    resuming: Boolean(job), backupDirectory: job ? readString(job, "backup_directory") : null,
    backupFingerprint: job ? readString(job, "backup_fingerprint") : null, counts };
}

/** Internal DB stage: caller must first stop writers and verify the backup and storage tree. */
export function stageMuseumPermanentDeletion(db: DatabaseSync, id: string, backup: {directory: string; fingerprint: string}, now = new Date()) {
  if (!backup.directory.trim() || !/^[0-9a-f]{64}$/.test(backup.fingerprint)) throw new Error("Verified backup required");
  return withTransaction(db, () => {
    const plan = planMuseumPermanentDeletion(db, id, now);
    if (plan.resuming) return plan;
    const protectedBefore = protectedDataFingerprint(db, id);
    db.prepare("INSERT INTO museum_permanent_deletion_jobs (museum_id,backup_directory,backup_fingerprint,started_at) VALUES (?,?,?,?)")
      .run(id, backup.directory, backup.fingerprint, now.toISOString());
    for (const table of museumOwnedDeletionTables) db.prepare(`DELETE FROM ${table} WHERE museum_id=?`).run(id);
    db.prepare("UPDATE museums SET cover_photo_id=NULL,storage_used_bytes=0 WHERE id=?").run(id);
    if (protectedDataFingerprint(db, id) !== protectedBefore) throw new Error("Unrelated data changed; deletion rolled back");
    return planMuseumPermanentDeletion(db, id, now);
  });
}

/** Called only after namespace absence has been verified by the storage layer. */
export function finishMuseumPermanentDeletion(db: DatabaseSync, id: string, now = new Date()) {
  withTransaction(db, () => {
    const plan = planMuseumPermanentDeletion(db, id, now);
    if (!plan.resuming) throw new Error("Cleanup journal required");
    const protectedBefore = protectedDataFingerprint(db, id);
    db.prepare("DELETE FROM museum_permanent_deletion_jobs WHERE museum_id=?").run(id);
    db.prepare("DELETE FROM museums WHERE id=?").run(id);
    if (protectedDataFingerprint(db, id) !== protectedBefore) throw new Error("Unrelated data changed; deletion rolled back");
  });
}
