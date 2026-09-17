import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import { findMemoryById } from "./memory-repository";
import { withTransaction } from "./transaction";
import type { MemorySummary } from "@/domain/models";
import {
  MAX_MEMORY_PHOTOS,
  MAX_RELATED_MEMORIES,
  MEMORY_STORY_MAX_LENGTH,
  MEMORY_TITLE_MAX_LENGTH,
} from "@/domain/rules";

export interface CreateMemoryInput {
  title: string;
  story: string;
  photoIds: string[];
  coverPhotoId: string;
  stageId?: string | null;
  relatedMemoryIds?: string[];
}

interface PhotoKeyRow { id: string; storage_key: string }

export function createMemory(input: CreateMemoryInput): MemorySummary {
  const title = input.title.trim();
  const story = input.story.trim();
  const photoIds = [...new Set(input.photoIds)];
  const relatedIds = [...new Set(input.relatedMemoryIds ?? [])];
  if (!title) throw new Error("TITLE_REQUIRED");
  if (title.length > MEMORY_TITLE_MAX_LENGTH) throw new Error("TITLE_TOO_LONG");
  if (!story) throw new Error("STORY_REQUIRED");
  if (story.length > MEMORY_STORY_MAX_LENGTH) throw new Error("STORY_TOO_LONG");
  if (photoIds.length === 0) throw new Error("PHOTOS_REQUIRED");
  if (photoIds.length > MAX_MEMORY_PHOTOS) throw new Error("INVALID_PHOTOS");
  if (relatedIds.length > MAX_RELATED_MEMORIES) throw new Error("INVALID_RELATIONS");
  if (!photoIds.includes(input.coverPhotoId)) throw new Error("INVALID_COVER");

  const database = getDatabase();
  const placeholders = photoIds.map(() => "?").join(",");
  const id = randomUUID();
  const now = new Date().toISOString();
  withTransaction(database, () => {
    const photos = database
      .prepare(
        `SELECT id, optimized_storage_key AS storage_key
         FROM uploaded_photos
         WHERE id IN (${placeholders}) AND used_at IS NULL`,
      )
      .all(...photoIds) as unknown as PhotoKeyRow[];
    if (photos.length !== photoIds.length) throw new Error("INVALID_PHOTOS");
    const photoById = new Map(photos.map((photo) => [photo.id, photo]));

    if (input.stageId) {
      const stage = database
        .prepare("SELECT id FROM stages WHERE id = ? AND trashed_at IS NULL")
        .get(input.stageId);
      if (!stage) throw new Error("INVALID_STAGE");
    }
    if (relatedIds.length > 0) {
      const relatedPlaceholders = relatedIds.map(() => "?").join(",");
      const rows = database
        .prepare(
          `SELECT id FROM memories WHERE id IN (${relatedPlaceholders}) AND trashed_at IS NULL`,
        )
        .all(...relatedIds);
      if (rows.length !== relatedIds.length) throw new Error("INVALID_RELATIONS");
    }

    database.prepare(`INSERT INTO memories
      (id, stage_id, title, story, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'private', ?, ?)`
    ).run(id, input.stageId || null, title, story, now, now);
    const insertImage = database.prepare(`INSERT INTO memory_images
      (id, memory_id, storage_key, alt_text, sort_order, is_cover, created_at)
      VALUES (?, ?, ?, '', ?, ?, ?)`);
    photoIds.forEach((photoId, index) => {
      insertImage.run(randomUUID(), id, photoById.get(photoId)!.storage_key, index,
        photoId === input.coverPhotoId ? 1 : 0, now);
    });
    const insertRelation = database.prepare(`INSERT INTO memory_relations
      (memory_id, related_memory_id, created_at) VALUES (?, ?, ?)`);
    relatedIds.forEach((relatedId) => insertRelation.run(id, relatedId, now));
    database
      .prepare(`UPDATE uploaded_photos SET used_at = ? WHERE id IN (${placeholders})`)
      .run(now, ...photoIds);
  });
  return findMemoryById(id)!;
}
