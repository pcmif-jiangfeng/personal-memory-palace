import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.ts";
import { findStageByIdInDatabase } from "./memory-repository.ts";
import { withTransaction } from "./transaction.ts";
import type { Stage } from "../domain/models.ts";
import { STAGE_DESCRIPTION_MAX_LENGTH, STAGE_TITLE_MAX_LENGTH } from "../domain/rules.ts";
import { DomainError } from "../domain/errors.ts";
import { ApiError } from "../http/errors.ts";

export interface StageInput {
  version?: number;
  title: string;
  description?: string;
  coverPhotoId?: string | null;
}

function resolveCoverKey(database: ReturnType<typeof getDatabase>, photoId?: string | null): string | null {
  if (!photoId) return null;
  const row = database.prepare(
    "SELECT optimized_storage_key AS storageKey FROM uploaded_photos WHERE id = ?"
  ).get(photoId) as { storageKey: string } | undefined;
  if (!row) throw new DomainError("INVALID_COVER_PHOTO");
  return row.storageKey;
}

function saveCover(database: ReturnType<typeof getDatabase>, stageId: string, storageKey: string | null, museumId?: string): void {
  database.prepare("DELETE FROM stage_covers WHERE stage_id = ?").run(stageId);
  if (storageKey) {
    database.prepare("INSERT INTO stage_covers (stage_id, storage_key, museum_id) VALUES (?, ?, ?)").run(stageId, storageKey, museumId ?? null);
  }
}

export function createStage(input: StageInput, database = getDatabase(), museumId?: string): Stage {
  const title = input.title.trim();
  const description = input.description?.trim() ?? "";
  if (!title) throw new DomainError("TITLE_REQUIRED");
  if (title.length > STAGE_TITLE_MAX_LENGTH) throw new DomainError("TITLE_TOO_LONG");
  if (description.length > STAGE_DESCRIPTION_MAX_LENGTH) throw new DomainError("DESCRIPTION_TOO_LONG");
  const id = randomUUID();
  const now = new Date().toISOString();
  withTransaction(database, () => {
    database.prepare(`INSERT INTO stages (id, title, description, created_at, updated_at, museum_id)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, title, description, now, now, museumId ?? null);
    saveCover(database, id, resolveCoverKey(database, input.coverPhotoId), museumId);
  });
  return findStageByIdInDatabase(database, id)!;
}

export function updateStage(id: string, input: StageInput, database = getDatabase(), museumId?: string): Stage {
  const title = input.title.trim();
  const description = input.description?.trim() ?? "";
  if (!title) throw new DomainError("TITLE_REQUIRED");
  if (title.length > STAGE_TITLE_MAX_LENGTH) throw new DomainError("TITLE_TOO_LONG");
  if (description.length > STAGE_DESCRIPTION_MAX_LENGTH) throw new DomainError("DESCRIPTION_TOO_LONG");
  withTransaction(database, () => {
    if (!findStageByIdInDatabase(database, id)) throw new DomainError("STAGE_NOT_FOUND");
    const result = database.prepare(`UPDATE stages SET title = ?, description = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND trashed_at IS NULL AND (? IS NULL OR version = ?)`
    ).run(title, description, new Date().toISOString(), id, input.version ?? null, input.version ?? null);
    if (result.changes === 0) throw new ApiError("STAGE_VERSION_CONFLICT", 409);
    saveCover(database, id, resolveCoverKey(database, input.coverPhotoId), museumId);
  });
  return findStageByIdInDatabase(database, id)!;
}
