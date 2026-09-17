import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import { findStageById } from "./memory-repository";
import { withTransaction } from "./transaction";
import type { Stage } from "@/domain/models";
import { STAGE_DESCRIPTION_MAX_LENGTH, STAGE_TITLE_MAX_LENGTH } from "@/domain/rules";

export interface StageInput {
  title: string;
  description?: string;
  coverPhotoId?: string | null;
}

function resolveCoverKey(database: ReturnType<typeof getDatabase>, photoId?: string | null): string | null {
  if (!photoId) return null;
  const row = database.prepare(
    "SELECT optimized_storage_key AS storageKey FROM uploaded_photos WHERE id = ?"
  ).get(photoId) as { storageKey: string } | undefined;
  if (!row) throw new Error("INVALID_COVER_PHOTO");
  return row.storageKey;
}

function saveCover(database: ReturnType<typeof getDatabase>, stageId: string, storageKey: string | null): void {
  database.prepare("DELETE FROM stage_covers WHERE stage_id = ?").run(stageId);
  if (storageKey) {
    database.prepare("INSERT INTO stage_covers (stage_id, storage_key) VALUES (?, ?)").run(stageId, storageKey);
  }
}

export function createStage(input: StageInput): Stage {
  const title = input.title.trim();
  const description = input.description?.trim() ?? "";
  if (!title) throw new Error("TITLE_REQUIRED");
  if (title.length > STAGE_TITLE_MAX_LENGTH) throw new Error("TITLE_TOO_LONG");
  if (description.length > STAGE_DESCRIPTION_MAX_LENGTH) throw new Error("DESCRIPTION_TOO_LONG");
  const id = randomUUID();
  const now = new Date().toISOString();
  const database = getDatabase();
  withTransaction(database, () => {
    database.prepare(`INSERT INTO stages (id, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run(id, title, description, now, now);
    saveCover(database, id, resolveCoverKey(database, input.coverPhotoId));
  });
  return findStageById(id)!;
}

export function updateStage(id: string, input: StageInput): Stage {
  const title = input.title.trim();
  const description = input.description?.trim() ?? "";
  if (!title) throw new Error("TITLE_REQUIRED");
  if (title.length > STAGE_TITLE_MAX_LENGTH) throw new Error("TITLE_TOO_LONG");
  if (description.length > STAGE_DESCRIPTION_MAX_LENGTH) throw new Error("DESCRIPTION_TOO_LONG");
  const database = getDatabase();
  withTransaction(database, () => {
    const result = database.prepare(`UPDATE stages SET title = ?, description = ?, updated_at = ?
      WHERE id = ? AND trashed_at IS NULL`
    ).run(title, description, new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("STAGE_NOT_FOUND");
    saveCover(database, id, resolveCoverKey(database, input.coverPhotoId));
  });
  return findStageById(id)!;
}
