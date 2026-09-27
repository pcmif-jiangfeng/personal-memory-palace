import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.ts";
import { findMemoryByIdInDatabase } from "./memory-repository.ts";
import { readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";
import { DomainError } from "../domain/errors.ts";
import { requireMuseumAccessInDatabase } from "./museum-access.ts";
import { ApiError } from "../http/errors.ts";
import type { MemorySummary } from "../domain/models.ts";
import {
  MAX_MEMORY_PHOTOS,
  MAX_RELATED_MEMORIES,
  MEMORY_STORY_MAX_LENGTH,
  MEMORY_TITLE_MAX_LENGTH,
} from "../domain/rules.ts";

export interface CreateMemoryInput {
  title: string;
  story: string;
  photoIds: string[];
  coverPhotoId: string;
  stageId?: string | null;
  relatedMemoryIds?: string[];
}

interface PhotoKeyRow {
  id: string;
  storage_key: string;
}

function readPhotoKeyRow(row: Record<string, unknown>): PhotoKeyRow {
  return {
    id: readString(row, "id"),
    storage_key: readString(row, "storage_key"),
  };
}

export function createMemory(input: CreateMemoryInput): MemorySummary {
  return createMemoryInDatabase(getDatabase(), input);
}

export function createMemoryInDatabase(
  database: ReturnType<typeof getDatabase>,
  input: CreateMemoryInput,
  scope?: { userId: string; museumId: string },
): MemorySummary {
  const title = input.title.trim();
  const story = input.story.trim();
  const photoIds = [...new Set(input.photoIds)];
  const relatedIds = [...new Set(input.relatedMemoryIds ?? [])];
  if (!title) throw new DomainError("TITLE_REQUIRED");
  if (title.length > MEMORY_TITLE_MAX_LENGTH) throw new DomainError("TITLE_TOO_LONG");
  if (!story) throw new DomainError("STORY_REQUIRED");
  if (story.length > MEMORY_STORY_MAX_LENGTH) throw new DomainError("STORY_TOO_LONG");
  if (photoIds.length === 0) throw new DomainError("PHOTOS_REQUIRED");
  if (photoIds.length > MAX_MEMORY_PHOTOS) throw new DomainError("INVALID_PHOTOS");
  if (relatedIds.length > MAX_RELATED_MEMORIES) throw new DomainError("INVALID_RELATIONS");
  if (!photoIds.includes(input.coverPhotoId)) throw new DomainError("INVALID_COVER");

  const placeholders = photoIds.map(() => "?").join(",");
  const id = randomUUID();
  const now = new Date().toISOString();
  withTransaction(database, () => {
    if (scope) {
      const access = requireMuseumAccessInDatabase(database, scope.userId, scope.museumId);
      if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
      for (const photoId of photoIds) {
        if (
          !database
            .prepare("SELECT id FROM uploaded_photos WHERE id=? AND museum_id=?")
            .get(photoId, scope.museumId)
        )
          throw new DomainError("INVALID_PHOTOS");
      }
      if (
        input.stageId &&
        !database
          .prepare("SELECT id FROM stages WHERE id=? AND museum_id=? AND trashed_at IS NULL")
          .get(input.stageId, scope.museumId)
      )
        throw new DomainError("INVALID_STAGE");
      for (const relatedId of relatedIds) {
        if (
          !database
            .prepare("SELECT id FROM memories WHERE id=? AND museum_id=? AND trashed_at IS NULL")
            .get(relatedId, scope.museumId)
        )
          throw new DomainError("INVALID_RELATIONS");
      }
    }
    const photos = database
      .prepare(
        `SELECT id, optimized_storage_key AS storage_key
         FROM uploaded_photos
         WHERE id IN (${placeholders})`,
      )
      .all(...photoIds)
      .map(readPhotoKeyRow);
    if (photos.length !== photoIds.length) throw new DomainError("INVALID_PHOTOS");
    const photoById = new Map(photos.map((photo) => [photo.id, photo]));

    if (input.stageId) {
      const stage = database
        .prepare("SELECT id FROM stages WHERE id = ? AND trashed_at IS NULL")
        .get(input.stageId);
      if (!stage) throw new DomainError("INVALID_STAGE");
    }
    if (relatedIds.length > 0) {
      const relatedPlaceholders = relatedIds.map(() => "?").join(",");
      const rows = database
        .prepare(
          `SELECT id FROM memories WHERE id IN (${relatedPlaceholders}) AND trashed_at IS NULL`,
        )
        .all(...relatedIds);
      if (rows.length !== relatedIds.length) throw new DomainError("INVALID_RELATIONS");
    }

    database
      .prepare(
        `INSERT INTO memories
      (id, museum_id, stage_id, title, story, visibility, created_at, updated_at, created_by_user_id, last_edited_by_user_id)
      VALUES (?, ?, ?, ?, ?, 'private', ?, ?, ?, ?)`,
      )
      .run(
        id,
        scope?.museumId ?? null,
        input.stageId || null,
        title,
        story,
        now,
        now,
        scope?.userId ?? null,
        scope?.userId ?? null,
      );
    const insertImage = database.prepare(`INSERT INTO memory_images
      (id, museum_id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
      VALUES (?, ?, ?, ?, '', ?, ?, ?)`);
    photoIds.forEach((photoId, index) => {
      insertImage.run(
        randomUUID(),
        scope?.museumId ?? null,
        id,
        photoById.get(photoId)!.storage_key,
        index,
        photoId === input.coverPhotoId ? 1 : 0,
        now,
      );
    });
    const insertRelation = database.prepare(`INSERT INTO memory_relations
      (memory_id, related_memory_id, museum_id, created_at) VALUES (?, ?, ?, ?)`);
    relatedIds.forEach((relatedId) =>
      insertRelation.run(...[id, relatedId].sort(), scope?.museumId ?? null, now),
    );
    database
      .prepare(
        `UPDATE uploaded_photos
         SET used_at = COALESCE(used_at, ?)
         WHERE id IN (${placeholders})`,
      )
      .run(now, ...photoIds);
  });
  return findMemoryByIdInDatabase(database, id)!;
}
