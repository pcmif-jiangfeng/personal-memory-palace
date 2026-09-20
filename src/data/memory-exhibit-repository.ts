import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./database.ts";
import { readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";
import { DomainError } from "../domain/errors.ts";
import {
  EXHIBIT_DESCRIPTION_MAX_LENGTH,
  EXHIBIT_TITLE_MAX_LENGTH,
  MAX_MEMORY_PHOTOS,
} from "../domain/rules.ts";

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

function readId(row: Record<string, unknown>): string {
  return readString(row, "id");
}

function readStorageKey(row: Record<string, unknown>): string {
  return readString(row, "storage_key");
}

function requireActiveMemory(database: DatabaseSync, memoryId: string): void {
  if (
    !database
      .prepare("SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL")
      .get(memoryId)
  ) {
    throw new DomainError("MEMORY_NOT_FOUND");
  }
}

function touchMemory(database: DatabaseSync, memoryId: string, now: string): void {
  database.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(now, memoryId);
}

function findMemoryPhoto(
  database: DatabaseSync,
  memoryId: string,
  photoId: string,
): PhotoKeyRow {
  const photo = database
    .prepare(
      `SELECT uploaded_photos.id, uploaded_photos.optimized_storage_key AS storage_key
       FROM memory_images
       JOIN uploaded_photos
         ON uploaded_photos.optimized_storage_key = memory_images.storage_key
       WHERE memory_images.memory_id = ? AND uploaded_photos.id = ?`,
    )
    .get(memoryId, photoId) as PhotoKeyRow | undefined;
  if (!photo) throw new DomainError("MEMORY_PHOTO_NOT_FOUND");
  return photo;
}

export function addMemoryPhotosInDatabase(
  database: DatabaseSync,
  memoryId: string,
  photoIds: string[],
): void {
  const ids = [...new Set(photoIds)];
  if (ids.length === 0 || ids.length > MAX_MEMORY_PHOTOS) {
    throw new DomainError("INVALID_PHOTOS");
  }

  withTransaction(database, () => {
    requireActiveMemory(database, memoryId);
    const placeholders = ids.map(() => "?").join(",");
    const photos = database
      .prepare(
        `SELECT id, optimized_storage_key AS storage_key
         FROM uploaded_photos WHERE id IN (${placeholders})`,
      )
      .all(...ids)
      .map(readPhotoKeyRow);
    if (photos.length !== ids.length) throw new DomainError("INVALID_PHOTOS");
    const photosById = new Map(photos.map((photo) => [photo.id, photo]));
    const orderedPhotos = ids.map((id) => photosById.get(id)!);

    const current = database
      .prepare("SELECT storage_key FROM memory_images WHERE memory_id = ?")
      .all(memoryId)
      .map(readStorageKey);
    const currentKeys = new Set(current);
    if (orderedPhotos.some((photo) => currentKeys.has(photo.storage_key))) {
      throw new DomainError("PHOTO_ALREADY_IN_MEMORY");
    }
    if (current.length + orderedPhotos.length > MAX_MEMORY_PHOTOS) {
      throw new DomainError("TOO_MANY_MEMORY_PHOTOS");
    }

    const lastOrder = database
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM memory_images WHERE memory_id = ?")
      .get(memoryId) as { value: number };
    const now = new Date().toISOString();
    const insert = database.prepare(
      `INSERT INTO memory_images
       (id, memory_id, storage_key, alt_text, exhibit_title, exhibit_description,
        sort_order, is_cover, created_at)
       VALUES (?, ?, ?, '', '', '', ?, ?, ?)`,
    );
    orderedPhotos.forEach((photo, index) => {
      insert.run(
        randomUUID(),
        memoryId,
        photo.storage_key,
        lastOrder.value + index + 1,
        current.length === 0 && index === 0 ? 1 : 0,
        now,
      );
    });
    database
      .prepare(
        `UPDATE uploaded_photos SET used_at = COALESCE(used_at, ?)
         WHERE id IN (${placeholders})`,
      )
      .run(now, ...ids);
    touchMemory(database, memoryId, now);
  });
}

export function removeMemoryPhotoInDatabase(
  database: DatabaseSync,
  memoryId: string,
  photoId: string,
): void {
  withTransaction(database, () => {
    requireActiveMemory(database, memoryId);
    const photo = findMemoryPhoto(database, memoryId, photoId);
    const relation = database
      .prepare("SELECT is_cover FROM memory_images WHERE memory_id = ? AND storage_key = ?")
      .get(memoryId, photo.storage_key) as { is_cover: number };
    database
      .prepare("DELETE FROM memory_images WHERE memory_id = ? AND storage_key = ?")
      .run(memoryId, photo.storage_key);

    if (relation.is_cover === 1) {
      const fallback = database
        .prepare(
          `SELECT id FROM memory_images
           WHERE memory_id = ? ORDER BY sort_order, created_at LIMIT 1`,
        )
        .get(memoryId) as { id: string } | undefined;
      if (fallback) {
        database.prepare("UPDATE memory_images SET is_cover = 1 WHERE id = ?").run(fallback.id);
      }
    }

    database
      .prepare(
        `UPDATE uploaded_photos SET used_at = NULL
         WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM memory_images WHERE storage_key = ?
           )`,
      )
      .run(photoId, photo.storage_key);
    touchMemory(database, memoryId, new Date().toISOString());
  });
}

export function reorderMemoryPhotosInDatabase(
  database: DatabaseSync,
  memoryId: string,
  photoIds: string[],
): void {
  const ids = [...new Set(photoIds)];
  withTransaction(database, () => {
    requireActiveMemory(database, memoryId);
    const current = database
      .prepare(
        `SELECT uploaded_photos.id
         FROM memory_images
         JOIN uploaded_photos
           ON uploaded_photos.optimized_storage_key = memory_images.storage_key
         WHERE memory_images.memory_id = ?`,
      )
      .all(memoryId)
      .map(readId);
    const currentIds = new Set(current);
    if (ids.length !== current.length || ids.some((id) => !currentIds.has(id))) {
      throw new DomainError("INVALID_PHOTO_ORDER");
    }
    const update = database.prepare(
      `UPDATE memory_images SET sort_order = ?
       WHERE memory_id = ?
         AND storage_key = (
           SELECT optimized_storage_key FROM uploaded_photos WHERE id = ?
         )`,
    );
    ids.forEach((photoId, index) => update.run(index, memoryId, photoId));
    touchMemory(database, memoryId, new Date().toISOString());
  });
}

export function setMemoryCoverInDatabase(
  database: DatabaseSync,
  memoryId: string,
  photoId: string,
): void {
  withTransaction(database, () => {
    requireActiveMemory(database, memoryId);
    const photo = findMemoryPhoto(database, memoryId, photoId);
    database.prepare("UPDATE memory_images SET is_cover = 0 WHERE memory_id = ?").run(memoryId);
    database
      .prepare(
        "UPDATE memory_images SET is_cover = 1 WHERE memory_id = ? AND storage_key = ?",
      )
      .run(memoryId, photo.storage_key);
    touchMemory(database, memoryId, new Date().toISOString());
  });
}

export function updateMemoryExhibitMetadataInDatabase(
  database: DatabaseSync,
  memoryId: string,
  photoId: string,
  input: { title: string; description: string },
): void {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length > EXHIBIT_TITLE_MAX_LENGTH) {
    throw new DomainError("EXHIBIT_TITLE_TOO_LONG");
  }
  if (description.length > EXHIBIT_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError("EXHIBIT_DESCRIPTION_TOO_LONG");
  }
  withTransaction(database, () => {
    requireActiveMemory(database, memoryId);
    const photo = findMemoryPhoto(database, memoryId, photoId);
    database
      .prepare(
        `UPDATE memory_images SET exhibit_title = ?, exhibit_description = ?
         WHERE memory_id = ? AND storage_key = ?`,
      )
      .run(title, description, memoryId, photo.storage_key);
    touchMemory(database, memoryId, new Date().toISOString());
  });
}

export function addMemoryPhotos(memoryId: string, photoIds: string[]): void {
  addMemoryPhotosInDatabase(getDatabase(), memoryId, photoIds);
}

export function removeMemoryPhoto(memoryId: string, photoId: string): void {
  removeMemoryPhotoInDatabase(getDatabase(), memoryId, photoId);
}

export function reorderMemoryPhotos(memoryId: string, photoIds: string[]): void {
  reorderMemoryPhotosInDatabase(getDatabase(), memoryId, photoIds);
}

export function setMemoryCover(memoryId: string, photoId: string): void {
  setMemoryCoverInDatabase(getDatabase(), memoryId, photoId);
}

export function updateMemoryExhibitMetadata(
  memoryId: string,
  photoId: string,
  input: { title: string; description: string },
): void {
  updateMemoryExhibitMetadataInDatabase(getDatabase(), memoryId, photoId, input);
}
