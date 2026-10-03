import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { readNumber } from "./row-readers.ts";
import { requireMemoryAccessInDatabase } from "./memory-access.ts";
import { requireMuseumAccessInDatabase } from "./museum-access.ts";
import { withTransaction } from "./transaction.ts";
import { ApiError } from "../http/errors.ts";
import type { parseMemoryAction } from "../http/schemas.ts";
import {
  addLaterNote,
  updateMemoryDetailsInDatabase,
  updateMemoryRelationsInDatabase,
  trashMemoryInDatabase,
  restoreMemoryInDatabase,
  permanentlyDeleteMemoryInDatabase,
} from "./management-repository.ts";
import {
  addMemoryPhotosInDatabase,
  removeMemoryPhotoInDatabase,
  reorderMemoryPhotosInDatabase,
  setMemoryCoverInDatabase,
  updateMemoryExhibitMetadataInDatabase,
} from "./memory-exhibit-repository.ts";
import { setMemoryPublicInDatabase } from "./publication-repository.ts";
import {
  findMemoryDetailsInDatabase,
  listMemorySummariesInMuseumInDatabase,
} from "./memory-repository.ts";

export interface MemoryScope {
  userId: string;
  museumId: string;
}
export type MemoryAction = Awaited<ReturnType<typeof parseMemoryAction>>;

function requireBinding(
  db: DatabaseSync,
  scope: MemoryScope,
  table: "stages" | "memories" | "uploaded_photos",
  id: string,
) {
  const active = " AND trashed_at IS NULL";
  if (
    !db
      .prepare(`SELECT id FROM ${table} WHERE id=? AND museum_id=?${active}`)
      .get(id, scope.museumId)
  )
    throw new ApiError("INVALID_MEMORY_BINDING", 400);
}

export function manageScopedMemory(
  db: DatabaseSync,
  scope: MemoryScope,
  id: string,
  input: MemoryAction,
) {
  return withTransaction(db, () => {
    const operation =
      input.action === "trash" || input.action === "restore" || input.action === "permanent"
        ? input.action
        : "update";
    const access = requireMemoryAccessInDatabase(db, scope.userId, scope.museumId, id, operation);
    if (input.action === "publication" && access.role !== "owner")
      throw new ApiError("MUSEUM_OWNER_REQUIRED", 403);
    const beforeVersion = readNumber(
      db.prepare("SELECT version FROM memories WHERE id=?").get(id)!, "version",
    );
    const exhibitWrite = input.action === "addPhotos" || input.action === "removePhoto" ||
      input.action === "reorderPhotos" || input.action === "setCover" || input.action === "exhibitMetadata";
    if ((input.action === "details" || exhibitWrite) && (!Number.isSafeInteger(input.version) || input.version < 1)) {
      throw new ApiError("INVALID_MEMORY_VERSION", 400);
    }
    if (input.action === "details" && input.stageId)
      requireBinding(db, scope, "stages", input.stageId);
    if (input.action === "relations")
      for (const relatedId of input.relatedMemoryIds)
        requireBinding(db, scope, "memories", relatedId);
    if (input.action === "addPhotos" || input.action === "reorderPhotos")
      for (const photoId of input.photoIds) requireBinding(db, scope, "uploaded_photos", photoId);
    if ("photoId" in input && input.photoId)
      requireBinding(db, scope, "uploaded_photos", input.photoId);
    // Existing corrupt cross-Museum exhibits must not trigger foreign photo updates or deletion.
    const foreign = db
      .prepare(
        `SELECT 1 FROM memory_images i LEFT JOIN uploaded_photos p
      ON p.optimized_storage_key=i.storage_key WHERE i.memory_id=? AND (i.museum_id IS NOT ? OR p.museum_id IS NOT ?)`,
      )
      .get(id, scope.museumId, scope.museumId);
    if (foreign) throw new ApiError("INVALID_MEMORY_BINDING", 400);
    const foreignRelation = db
      .prepare(
        `SELECT 1 FROM memory_relations r JOIN memories m
      ON m.id=CASE WHEN r.memory_id=? THEN r.related_memory_id ELSE r.memory_id END
      WHERE (r.memory_id=? OR r.related_memory_id=?) AND (r.museum_id IS NOT ? OR m.museum_id IS NOT ?)`,
      )
      .get(id, id, id, scope.museumId, scope.museumId);
    if (foreignRelation) throw new ApiError("INVALID_MEMORY_BINDING", 400);
    if (
      db
        .prepare("SELECT 1 FROM later_notes WHERE memory_id=? AND museum_id IS NOT ?")
        .get(id, scope.museumId)
    )
      throw new ApiError("INVALID_MEMORY_BINDING", 400);
    // The compare-and-increment belongs to the same transaction as every relation side effect.
    if (exhibitWrite && !db.prepare("UPDATE memories SET version=version+1 WHERE id=? AND museum_id=? AND version=?")
      .run(id, scope.museumId, input.version).changes) {
      throw new ApiError("MEMORY_VERSION_CONFLICT", 409);
    }
    switch (input.action) {
      case "details":
        updateMemoryDetailsInDatabase(db, id, input);
        break;
      case "note":
        addLaterNote(id, input.content, db, scope.userId);
        break;
      case "relations":
        updateMemoryRelationsInDatabase(db, id, input.relatedMemoryIds);
        break;
      case "trash":
        trashMemoryInDatabase(db, id);
        break;
      case "restore":
        restoreMemoryInDatabase(db, id);
        break;
      case "permanent":
        permanentlyDeleteMemoryInDatabase(db, id);
        break;
      case "addPhotos":
        addMemoryPhotosInDatabase(db, id, input.photoIds);
        break;
      case "removePhoto":
        removeMemoryPhotoInDatabase(db, id, input.photoId);
        break;
      case "reorderPhotos":
        reorderMemoryPhotosInDatabase(db, id, input.photoIds);
        break;
      case "setCover":
        setMemoryCoverInDatabase(db, id, input.photoId);
        break;
      case "exhibitMetadata":
        updateMemoryExhibitMetadataInDatabase(db, id, input.photoId, input);
        break;
      case "publication":
        setMemoryPublicInDatabase(db, id, input.isPublic);
        break;
    }
    db.prepare("UPDATE memories SET last_edited_by_user_id=? WHERE id=?").run(scope.userId, id);
    if (input.action !== "details" && !exhibitWrite) db.prepare("UPDATE memories SET version=version+1 WHERE id=?").run(id);
    for (const table of ["memory_images", "later_notes"])
      db.prepare(`UPDATE ${table} SET museum_id=? WHERE memory_id=? AND museum_id IS NULL`).run(
        scope.museumId,
        id,
      );
    db.prepare(
      "UPDATE memory_relations SET museum_id=? WHERE (memory_id=? OR related_memory_id=?) AND museum_id IS NULL",
    ).run(scope.museumId, id, id);
    const savedVersion = input.action === "permanent"
      ? null
      : readNumber(db.prepare("SELECT version FROM memories WHERE id=?").get(id)!, "version");
    writeAuditLogInDatabase(db, {
      actorUserId: scope.userId,
      museumId: scope.museumId,
      action: `memory.${input.action}`,
      objectType: "memory",
      objectId: id,
      diff: {
        version: { before: beforeVersion, after: savedVersion },
        ...("photoId" in input ? { photoId: input.photoId } : {}),
        ...("photoIds" in input ? { photoIds: input.photoIds } : {}),
        ...(input.action === "publication" ? { isPublic: input.isPublic } : {}),
      },
    });
    if (input.action === "details" || exhibitWrite) return savedVersion!;
  });
}

export function listScopedMemories(
  db: DatabaseSync,
  scope: MemoryScope,
  trashed = false,
  query = "",
) {
  const access = requireMuseumAccessInDatabase(db, scope.userId, scope.museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return listMemorySummariesInMuseumInDatabase(db, scope.museumId, trashed, query);
}

export function readScopedMemory(db: DatabaseSync, scope: MemoryScope, id: string) {
  requireMemoryAccessInDatabase(db, scope.userId, scope.museumId, id, "read");
  const memory = findMemoryDetailsInDatabase(db, id, false, scope.museumId);
  if (!memory) throw new ApiError("MEMORY_NOT_FOUND", 404);
  return memory;
}
