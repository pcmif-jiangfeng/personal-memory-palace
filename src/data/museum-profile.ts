import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { findMuseumByOwnerIdInDatabase } from "./museum-repository.ts";
import { withTransaction } from "./transaction.ts";

interface MuseumProfileInput { name: string; description: string; coverPhotoId: string | null; version: number }

export function museumCoverChoicesInDatabase(database: DatabaseSync, museumId: string, currentCoverId: string | null) {
  const rows = database.prepare(`SELECT id, original_name AS name FROM uploaded_photos
    WHERE museum_id = ? AND NOT EXISTS (SELECT 1 FROM photo_deletion_jobs WHERE photo_id = uploaded_photos.id)
    ORDER BY (id = ?) DESC, created_at DESC, id LIMIT 60`).all(museumId, currentCoverId) as { id: string; name: string }[];
  return rows.map(({ id, name }) => ({ id, name }));
}

export function updateOwnMuseumProfileInDatabase(database: DatabaseSync, ownerId: string, input: MuseumProfileInput) {
  return withTransaction(database, () => {
    const museum = findMuseumByOwnerIdInDatabase(database, ownerId);
    if (!museum) throw new ApiError("MUSEUM_NOT_FOUND", 404);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new ApiError("INVALID_MUSEUM_VERSION", 400);
    if (input.version !== museum.version) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
    if (input.coverPhotoId !== null && !database.prepare(`SELECT id FROM uploaded_photos
      WHERE id = ? AND museum_id = ? AND NOT EXISTS (SELECT 1 FROM photo_deletion_jobs WHERE photo_id = uploaded_photos.id)`).get(input.coverPhotoId, museum.id)) {
      throw new ApiError("INVALID_COVER_PHOTO", 400);
    }
    if (museum.name === input.name && museum.description === input.description && museum.coverPhotoId === input.coverPhotoId) return museum;
    const result = database.prepare("UPDATE museums SET name = ?, description = ?, cover_photo_id = ?, version = version + 1, updated_at = ?, last_edited_by_user_id = ? WHERE id = ? AND owner_id = ? AND version = ?")
      .run(input.name, input.description, input.coverPhotoId, new Date().toISOString(), ownerId, museum.id, ownerId, input.version);
    if (!result.changes) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
    return findMuseumByOwnerIdInDatabase(database, ownerId)!;
  });
}
