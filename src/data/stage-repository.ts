import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import { findStageById } from "./memory-repository";
import type { Stage } from "@/domain/models";

export interface StageInput {
  title: string;
  description?: string;
  coverPhotoId?: string | null;
}

function resolveCoverKey(photoId?: string | null): string | null {
  if (!photoId) return null;
  const row = getDatabase().prepare(
    "SELECT optimized_storage_key AS storageKey FROM uploaded_photos WHERE id = ?"
  ).get(photoId) as { storageKey: string } | undefined;
  if (!row) throw new Error("INVALID_COVER_PHOTO");
  return row.storageKey;
}

function saveCover(stageId: string, storageKey: string | null): void {
  const database = getDatabase();
  database.prepare("DELETE FROM stage_covers WHERE stage_id = ?").run(stageId);
  if (storageKey) {
    database.prepare("INSERT INTO stage_covers (stage_id, storage_key) VALUES (?, ?)").run(stageId, storageKey);
  }
}

export function createStage(input: StageInput): Stage {
  const title = input.title.trim();
  if (!title) throw new Error("TITLE_REQUIRED");
  const id = randomUUID();
  const now = new Date().toISOString();
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`INSERT INTO stages (id, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run(id, title, input.description?.trim() ?? "", now, now);
    saveCover(id, resolveCoverKey(input.coverPhotoId));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return findStageById(id)!;
}

export function updateStage(id: string, input: StageInput): Stage {
  const title = input.title.trim();
  if (!title) throw new Error("TITLE_REQUIRED");
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database.prepare(`UPDATE stages SET title = ?, description = ?, updated_at = ?
      WHERE id = ? AND trashed_at IS NULL`
    ).run(title, input.description?.trim() ?? "", new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("STAGE_NOT_FOUND");
    saveCover(id, resolveCoverKey(input.coverPhotoId));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return findStageById(id)!;
}
