import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./database.ts";
import { withTransaction } from "./transaction.ts";
import {
  LATER_NOTE_MAX_LENGTH,
  MAX_RELATED_MEMORIES,
  MEMORY_STORY_MAX_LENGTH,
  MEMORY_TITLE_MAX_LENGTH,
} from "../domain/rules.ts";
import { DomainError, type DomainErrorCode } from "../domain/errors.ts";

export interface UpdateMemoryDetailsInput {
  title: string;
  story: string;
  stageId?: string | null;
}

export function updateMemoryDetailsInDatabase(
  database: DatabaseSync,
  memoryId: string,
  input: UpdateMemoryDetailsInput,
): void {
  const title = input.title.trim();
  const story = input.story.trim();
  const stageId = input.stageId?.trim() || null;
  if (!title) throw new DomainError("TITLE_REQUIRED");
  if (title.length > MEMORY_TITLE_MAX_LENGTH) throw new DomainError("TITLE_TOO_LONG");
  if (!story) throw new DomainError("STORY_REQUIRED");
  if (story.length > MEMORY_STORY_MAX_LENGTH) throw new DomainError("STORY_TOO_LONG");

  withTransaction(database, () => {
    if (!database.prepare(
      "SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL"
    ).get(memoryId)) throw new DomainError("MEMORY_NOT_FOUND");
    if (stageId && !database.prepare(
      "SELECT id FROM stages WHERE id = ? AND trashed_at IS NULL"
    ).get(stageId)) throw new DomainError("INVALID_STAGE");

    database.prepare(
      "UPDATE memories SET title = ?, story = ?, stage_id = ?, updated_at = ? WHERE id = ?"
    ).run(title, story, stageId, new Date().toISOString(), memoryId);
  });
}

export function updateMemoryDetails(memoryId: string, input: UpdateMemoryDetailsInput): void {
  updateMemoryDetailsInDatabase(getDatabase(), memoryId, input);
}

export function addLaterNote(memoryId: string, content: string) {
  const value = content.trim();
  if (!value) throw new DomainError("NOTE_REQUIRED");
  if (value.length > LATER_NOTE_MAX_LENGTH) throw new DomainError("NOTE_TOO_LONG");
  const database = getDatabase();
  if (!database.prepare("SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL").get(memoryId)) throw new DomainError("MEMORY_NOT_FOUND");
  const id = randomUUID();
  database.prepare("INSERT INTO later_notes (id, memory_id, content, created_at) VALUES (?, ?, ?, ?)").run(id, memoryId, value, new Date().toISOString());
  return id;
}

export function updateMemoryRelations(memoryId: string, relatedMemoryIds: string[]) {
  updateMemoryRelationsInDatabase(getDatabase(), memoryId, relatedMemoryIds);
}

export function updateMemoryRelationsInDatabase(
  database: DatabaseSync,
  memoryId: string,
  relatedMemoryIds: string[],
): void {
  if (!database.prepare("SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL").get(memoryId)) throw new DomainError("MEMORY_NOT_FOUND");
  const ids = [...new Set(relatedMemoryIds)].filter((id) => id !== memoryId);
  if (ids.length > MAX_RELATED_MEMORIES) throw new DomainError("INVALID_RELATIONS");
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const valid = database.prepare(`SELECT id FROM memories WHERE id IN (${placeholders}) AND trashed_at IS NULL`).all(...ids);
    if (valid.length !== ids.length) throw new DomainError("INVALID_RELATIONS");
  }
  withTransaction(database, () => {
    database.prepare("DELETE FROM memory_relations WHERE memory_id = ? OR related_memory_id = ?").run(memoryId, memoryId);
    const insert = database.prepare("INSERT INTO memory_relations (memory_id, related_memory_id, created_at) VALUES (?, ?, ?)");
    const now = new Date().toISOString();
    ids.forEach((id) => insert.run(...[memoryId, id].sort(), now));
    database.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(now, memoryId);
  });
}

function mark(sql: string, id: string, error: DomainErrorCode) {
  const result = getDatabase().prepare(sql).run(new Date().toISOString(), id);
  if (!result.changes) throw new DomainError(error);
}
export function trashMemory(id: string) { mark("UPDATE memories SET trashed_at = ? WHERE id = ? AND trashed_at IS NULL", id, "MEMORY_NOT_FOUND"); }
export function restoreMemory(id: string) {
  const result = getDatabase().prepare("UPDATE memories SET trashed_at = NULL WHERE id = ? AND trashed_at IS NOT NULL").run(id);
  if (!result.changes) throw new DomainError("MEMORY_NOT_FOUND");
}
export function trashStageInDatabase(database: DatabaseSync, id: string): void {
  const now = new Date().toISOString();
  withTransaction(database, () => {
    const result = database
      .prepare(
        "UPDATE stages SET trashed_at = ?, updated_at = ? WHERE id = ? AND trashed_at IS NULL",
      )
      .run(now, now, id);
    if (!result.changes) throw new DomainError("STAGE_NOT_FOUND");

    database
      .prepare("UPDATE memories SET stage_id = NULL, updated_at = ? WHERE stage_id = ?")
      .run(now, id);
  });
}
export function trashStage(id: string) {
  trashStageInDatabase(getDatabase(), id);
}
export function restoreStage(id: string) {
  const result = getDatabase().prepare("UPDATE stages SET trashed_at = NULL WHERE id = ? AND trashed_at IS NOT NULL").run(id);
  if (!result.changes) throw new DomainError("STAGE_NOT_FOUND");
}

function queueUnreferencedPhotos(database: DatabaseSync, photoIds: string[]): void {
  const select = database.prepare(`
    SELECT id, optimized_storage_key AS optimizedStorageKey,
           original_storage_key AS originalStorageKey
    FROM uploaded_photos
    WHERE id = ?
      AND NOT EXISTS (
        SELECT 1 FROM memory_images
        WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
      )
      AND NOT EXISTS (
        SELECT 1 FROM stage_covers
        WHERE stage_covers.storage_key = uploaded_photos.optimized_storage_key
      )
  `);
  const insert = database.prepare(`
    INSERT OR IGNORE INTO photo_deletion_jobs
      (photo_id, optimized_storage_key, original_storage_key, created_at, last_error)
    VALUES (?, ?, ?, ?, NULL)
  `);
  for (const photoId of new Set(photoIds)) {
    const photo = select.get(photoId) as
      | { id: string; optimizedStorageKey: string; originalStorageKey: string | null }
      | undefined;
    if (!photo) continue;
    insert.run(
      photo.id,
      photo.optimizedStorageKey,
      photo.originalStorageKey,
      new Date().toISOString(),
    );
    database.prepare("DELETE FROM uploaded_photos WHERE id = ?").run(photo.id);
  }
}

export function permanentlyDeleteMemoryInDatabase(database: DatabaseSync, id: string): void {
  withTransaction(database, () => {
    const photos = database.prepare(`
      SELECT uploaded_photos.id
      FROM memory_images
      JOIN uploaded_photos
        ON uploaded_photos.optimized_storage_key = memory_images.storage_key
      WHERE memory_images.memory_id = ?
    `).all(id) as unknown as Array<{ id: string }>;
    const result = database
      .prepare("DELETE FROM memories WHERE id = ? AND trashed_at IS NOT NULL")
      .run(id);
    if (!result.changes) throw new DomainError("MEMORY_NOT_FOUND");
    queueUnreferencedPhotos(database, photos.map((photo) => photo.id));
  });
}

export function permanentlyDeleteMemory(id: string) {
  permanentlyDeleteMemoryInDatabase(getDatabase(), id);
}

export function permanentlyDeleteStageInDatabase(database: DatabaseSync, id: string): void {
  withTransaction(database, () => {
    const photos = database.prepare(`
      SELECT uploaded_photos.id
      FROM stage_covers
      JOIN uploaded_photos
        ON uploaded_photos.optimized_storage_key = stage_covers.storage_key
      WHERE stage_covers.stage_id = ?
    `).all(id) as unknown as Array<{ id: string }>;
    const result = database
      .prepare("DELETE FROM stages WHERE id = ? AND trashed_at IS NOT NULL")
      .run(id);
    if (!result.changes) throw new DomainError("STAGE_NOT_FOUND");
    queueUnreferencedPhotos(database, photos.map((photo) => photo.id));
  });
}

export function permanentlyDeleteStage(id: string) {
  permanentlyDeleteStageInDatabase(getDatabase(), id);
}
