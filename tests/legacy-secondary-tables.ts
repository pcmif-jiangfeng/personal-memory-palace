import type { DatabaseSync } from "node:sqlite";

export const secondaryMuseumTables = [
  "stage_covers",
  "memory_images",
  "memory_relations",
  "later_notes",
  "share_configs",
  "photo_deletion_jobs",
  "pending_uploads",
] as const;

export function createLegacySecondaryTables(database: DatabaseSync): void {
  for (const table of secondaryMuseumTables) {
    database.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  }
}
