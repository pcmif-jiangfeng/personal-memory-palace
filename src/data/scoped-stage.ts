import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { readNumber } from "./row-readers.ts";
import { requireMuseumAccessInDatabase } from "./museum-access.ts";
import { withTransaction } from "./transaction.ts";
import { createStage, updateStage, type StageInput } from "./stage-repository.ts";
import { listStagesInMuseumInDatabase } from "./memory-repository.ts";
import {
  trashStageInDatabase,
  restoreStageInDatabase,
  permanentlyDeleteStageInDatabase,
} from "./management-repository.ts";
import { setStagePublicInDatabase } from "./publication-repository.ts";
import type { MemoryScope } from "./scoped-memory.ts";
import { ApiError } from "../http/errors.ts";

type StageAction =
  | { action: "details"; input: StageInput }
  | { action: "publication"; isPublic: boolean }
  | { action: "trash" | "restore" | "permanent" };

function requireActiveMuseum(db: DatabaseSync, scope: MemoryScope) {
  const access = requireMuseumAccessInDatabase(db, scope.userId, scope.museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return access;
}

function requireStage(db: DatabaseSync, scope: MemoryScope, id: string, trashed = false) {
  const access = requireActiveMuseum(db, scope);
  const stage = db
    .prepare("SELECT trashed_at FROM stages WHERE id=? AND museum_id=?")
    .get(id, scope.museumId);
  if (!stage || (stage.trashed_at !== null) !== trashed) throw new ApiError("STAGE_NOT_FOUND", 404);
  return access;
}

function requireCover(db: DatabaseSync, scope: MemoryScope, photoId?: string | null) {
  if (
    photoId &&
    !db
      .prepare("SELECT id FROM uploaded_photos WHERE id=? AND museum_id=?")
      .get(photoId, scope.museumId)
  )
    throw new ApiError("INVALID_COVER_PHOTO", 400);
}

export function createScopedStage(db: DatabaseSync, scope: MemoryScope, input: StageInput) {
  return withTransaction(db, () => {
    requireActiveMuseum(db, scope);
    requireCover(db, scope, input.coverPhotoId);
    const stage = createStage(input, db, scope.museumId);
    db.prepare("UPDATE stages SET created_by_user_id=?, last_edited_by_user_id=? WHERE id=?").run(scope.userId, scope.userId, stage.id);
    writeAuditLogInDatabase(db, {
      actorUserId: scope.userId,
      museumId: scope.museumId,
      action: "stage.create",
      objectType: "stage",
      objectId: stage.id,
      diff: { coverPhotoId: input.coverPhotoId || null },
    });
    return readScopedStage(db, scope, stage.id);
  });
}

export function listScopedStages(db: DatabaseSync, scope: MemoryScope, trashed = false) {
  requireActiveMuseum(db, scope);
  return listStagesInMuseumInDatabase(db, scope.museumId, trashed);
}

export function readScopedStage(db: DatabaseSync, scope: MemoryScope, id: string) {
  requireStage(db, scope, id);
  return listStagesInMuseumInDatabase(db, scope.museumId, false, id)[0];
}

export function manageScopedStage(
  db: DatabaseSync,
  scope: MemoryScope,
  id: string,
  action: StageAction,
) {
  return withTransaction(db, () => {
    const access = requireStage(
      db,
      scope,
      id,
      action.action === "restore" || action.action === "permanent",
    );
    if (action.action === "permanent" && access.role !== "owner")
      throw new ApiError("MUSEUM_OWNER_REQUIRED", 403);
    // Legacy corrupt bindings must not let Stage deletion mutate another Museum's photos or Memories.
    const foreignCover = db
      .prepare(
        `SELECT 1 FROM stage_covers c LEFT JOIN uploaded_photos p ON p.optimized_storage_key=c.storage_key
      WHERE c.stage_id=? AND (c.museum_id IS NOT ? OR p.museum_id IS NOT ?)`,
      )
      .get(id, scope.museumId, scope.museumId);
    const foreignMemory = db
      .prepare("SELECT 1 FROM memories WHERE stage_id=? AND museum_id IS NOT ?")
      .get(id, scope.museumId);
    if (foreignCover || foreignMemory) throw new ApiError("INVALID_STAGE_BINDING", 400);
    const beforeVersion = readNumber(
      db.prepare("SELECT version FROM stages WHERE id=?").get(id)!, "version",
    );
    switch (action.action) {
      case "details":
        if (!Number.isSafeInteger(action.input.version) || (action.input.version as number) < 1) throw new ApiError("INVALID_STAGE_VERSION", 400);
        requireCover(db, scope, action.input.coverPhotoId);
        updateStage(id, action.input, db, scope.museumId);
        break;
      case "publication":
        setStagePublicInDatabase(db, id, action.isPublic);
        break;
      case "trash":
        trashStageInDatabase(db, id);
        break;
      case "restore":
        restoreStageInDatabase(db, id);
        break;
      case "permanent":
        permanentlyDeleteStageInDatabase(db, id);
        break;
    }
    db.prepare("UPDATE stages SET last_edited_by_user_id=? WHERE id=?").run(scope.userId, id);
    if (action.action !== "details") db.prepare("UPDATE stages SET version=version+1 WHERE id=?").run(id);
    const savedVersion = action.action === "permanent"
      ? null
      : readNumber(db.prepare("SELECT version FROM stages WHERE id=?").get(id)!, "version");
    writeAuditLogInDatabase(db, {
      actorUserId: scope.userId,
      museumId: scope.museumId,
      action: `stage.${action.action}`,
      objectType: "stage",
      objectId: id,
      diff: {
        version: { before: beforeVersion, after: savedVersion },
        ...(action.action === "details" ? { coverPhotoId: action.input.coverPhotoId || null } : {}),
        ...(action.action === "publication" ? { isPublic: action.isPublic } : {}),
      },
    });
    if (action.action === "details") return readScopedStage(db, scope, id);
  });
}
