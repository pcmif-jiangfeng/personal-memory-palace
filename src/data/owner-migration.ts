import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./transaction.ts";
import { isMuseumPhotoAssetKey, optimizedPhotoKeyPattern, originalPhotoKeyPattern } from "../storage/photo-storage-key.ts";

// This allowlist is the ownership audit, not a table name supplied by an operator.
export const legacyOwnedTables = ["stages", "memories", "uploaded_photos", "stage_covers", "memory_images", "memory_relations", "later_notes", "share_configs", "photo_deletion_jobs", "pending_uploads"] as const;
type OwnedTable = (typeof legacyOwnedTables)[number];

export function planOwnerMigration(db: DatabaseSync, originalOwnerEmail: string) {
  for (const table of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    const column = db.prepare("SELECT name,\"notnull\" AS required FROM pragma_table_info(?) WHERE name='museum_id'").get(String(table.name));
    // SQLite reports TEXT PRIMARY KEY as nullable; this is an operation journal, not adoptable content.
    if (column?.required === 0 && table.name !== "museum_permanent_deletion_jobs" && !legacyOwnedTables.some(known => known === table.name))
      throw new Error("Unaudited nullable ownership table; review schema before migration");
  }
  const user = db.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND email_verified=1").get(originalOwnerEmail.trim());
  if (!user) throw new Error("Migration requires an existing verified original owner; never infer a demo owner");
  if (db.prepare("SELECT owner_id FROM museums GROUP BY owner_id HAVING COUNT(*)>1 LIMIT 1").get())
    throw new Error("Multiple owned palaces require an explicit migration decision; no automatic merge");
  const museum = db.prepare("SELECT id FROM museums WHERE owner_id=? AND status='active'").get(user.id);
  if (!museum) throw new Error("The verified original owner needs exactly one active palace");
  if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Database integrity check failed");
  if (db.prepare("SELECT 1 FROM pending_uploads LIMIT 1").get() || db.prepare("SELECT 1 FROM photo_deletion_jobs LIMIT 1").get())
    throw new Error("Recover unfinished file operations before owner migration");
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='museum_permanent_deletion_jobs'").get() && db.prepare("SELECT 1 FROM museum_permanent_deletion_jobs LIMIT 1").get())
    throw new Error("Recover unfinished palace deletion operations before owner migration");
  const museumId = String(museum.id);
  const ownerOf = (value: unknown) => value === null ? museumId : String(value);
  for (const table of ["stages", "memories"] as const) {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE museum_id IS NULL AND ((created_by_user_id IS NOT NULL AND created_by_user_id IS NOT ?) OR (last_edited_by_user_id IS NOT NULL AND last_edited_by_user_id IS NOT ?)) LIMIT 1`).get(user.id, user.id))
      throw new Error("Unassigned content has a cross-owner author; explicit historical review required");
  }
  const stages = new Map(db.prepare("SELECT id,museum_id FROM stages").all().map(row => [String(row.id), ownerOf(row.museum_id)]));
  const memories = new Map(db.prepare("SELECT id,museum_id,stage_id FROM memories").all().map(row => {
    const owner = ownerOf(row.museum_id);
    if (row.stage_id !== null && stages.get(String(row.stage_id)) !== owner) throw new Error("Invalid cross-owner Memory/Stage binding");
    return [String(row.id), owner];
  }));
  for (const table of ["memory_images", "later_notes", "share_configs", "memory_relations"] as const) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      const owner = ownerOf(row.museum_id);
      if (memories.get(String(row.memory_id)) !== owner || (table === "memory_relations" && memories.get(String(row.related_memory_id)) !== owner))
        throw new Error(`Invalid cross-owner ${table} binding`);
    }
  }
  const photos = new Map<string, string>();
  for (const row of db.prepare("SELECT * FROM uploaded_photos").all()) {
    const owner = ownerOf(row.museum_id);
    for (const [column, pattern] of [["optimized_storage_key", optimizedPhotoKeyPattern], ["original_storage_key", originalPhotoKeyPattern]] as const) {
      if (row[column] === null) continue;
      const key = String(row[column]);
      // Demo files must never be silently adopted as someone's production history.
      if (!pattern.test(key) || key.startsWith("uploads/demo/") || (!key.startsWith("uploads/owner/") && !isMuseumPhotoAssetKey(key, owner)))
        throw new Error("Unsafe, demo or cross-owner photo storage binding");
    }
    photos.set(String(row.optimized_storage_key), owner);
  }
  for (const row of db.prepare("SELECT m.id,m.cover_photo_id,p.museum_id FROM museums m JOIN uploaded_photos p ON p.id=m.cover_photo_id").all()) {
    if (ownerOf(row.museum_id) !== row.id) throw new Error("Invalid cross-owner palace cover binding");
  }
  for (const table of ["memory_images", "stage_covers"] as const) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      const owner = ownerOf(row.museum_id);
      if ((table === "stage_covers" && stages.get(String(row.stage_id)) !== owner) || photos.get(String(row.storage_key)) !== owner)
        throw new Error(`Missing photo record or cross-owner ${table} binding`);
    }
  }
  const counts = Object.fromEntries(["users", "museums", ...legacyOwnedTables].map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n)]));
  const unassigned = Object.fromEntries(legacyOwnedTables.map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE museum_id IS NULL`).get()?.n)])) as Record<OwnedTable, number>;
  // Detect concurrent content changes between preflight/backup and the write transaction without logging private rows.
  const hash = createHash("sha256");
  for (const table of ["users", "museums", ...legacyOwnedTables]) hash.update(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
  return { userId: String(user.id), museumId, counts, unassigned, fingerprint: hash.digest("hex") };
}

export function applyOwnerMigration(db: DatabaseSync, originalOwnerEmail: string) {
  return withTransaction(db, () => {
    const plan = planOwnerMigration(db, originalOwnerEmail);
    for (const table of legacyOwnedTables) db.prepare(`UPDATE ${table} SET museum_id=? WHERE museum_id IS NULL`).run(plan.museumId);
    if (plan.unassigned.uploaded_photos) db.prepare("UPDATE museums SET storage_usage_ready=0 WHERE id=?").run(plan.museumId);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Migration produced orphan foreign keys");
    return plan;
  });
}
