import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./database.ts";
import { DomainError } from "../domain/errors.ts";

export const publicMemoryPredicate = `memories.is_public = 1 AND memories.trashed_at IS NULL
  AND (memories.stage_id IS NULL OR (stages.is_public = 1 AND stages.trashed_at IS NULL))`;

export function setMemoryPublicInDatabase(database: DatabaseSync, id: string, isPublic: boolean): void {
  const result = database.prepare(
    "UPDATE memories SET is_public = ?, updated_at = ? WHERE id = ? AND trashed_at IS NULL",
  ).run(isPublic ? 1 : 0, new Date().toISOString(), id);
  if (!result.changes) throw new DomainError("MEMORY_NOT_FOUND");
}

export function setMemoryPublic(id: string, isPublic: boolean): void {
  setMemoryPublicInDatabase(getDatabase(), id, isPublic);
}

export function setStagePublicInDatabase(database: DatabaseSync, id: string, isPublic: boolean): void {
  const result = database.prepare(
    "UPDATE stages SET is_public = ?, updated_at = ? WHERE id = ? AND trashed_at IS NULL",
  ).run(isPublic ? 1 : 0, new Date().toISOString(), id);
  if (!result.changes) throw new DomainError("STAGE_NOT_FOUND");
}

export function setStagePublic(id: string, isPublic: boolean): void {
  setStagePublicInDatabase(getDatabase(), id, isPublic);
}

export function isMemoryPublicInDatabase(database: DatabaseSync, id: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM memories
    LEFT JOIN stages ON stages.id = memories.stage_id
    WHERE memories.id = ? AND ${publicMemoryPredicate}
  `).get(id));
}

export function isPublicImageAccessibleInDatabase(database: DatabaseSync, key: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM memory_images
    JOIN memories ON memories.id = memory_images.memory_id
    LEFT JOIN stages ON stages.id = memories.stage_id
    WHERE memory_images.storage_key = ?
      AND ${publicMemoryPredicate}
    UNION ALL
    SELECT 1 FROM stage_covers
    JOIN stages ON stages.id = stage_covers.stage_id
    WHERE stage_covers.storage_key = ? AND stages.is_public = 1 AND stages.trashed_at IS NULL
    LIMIT 1
  `).get(key, key));
}

export function isPublicImageAccessible(key: string): boolean {
  return isPublicImageAccessibleInDatabase(getDatabase(), key);
}
