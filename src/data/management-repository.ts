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
  if (!title) throw new Error("TITLE_REQUIRED");
  if (title.length > MEMORY_TITLE_MAX_LENGTH) throw new Error("TITLE_TOO_LONG");
  if (!story) throw new Error("STORY_REQUIRED");
  if (story.length > MEMORY_STORY_MAX_LENGTH) throw new Error("STORY_TOO_LONG");

  withTransaction(database, () => {
    if (!database.prepare(
      "SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL"
    ).get(memoryId)) throw new Error("MEMORY_NOT_FOUND");
    if (stageId && !database.prepare(
      "SELECT id FROM stages WHERE id = ? AND trashed_at IS NULL"
    ).get(stageId)) throw new Error("INVALID_STAGE");

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
  if (!value) throw new Error("NOTE_REQUIRED");
  if (value.length > LATER_NOTE_MAX_LENGTH) throw new Error("NOTE_TOO_LONG");
  const database = getDatabase();
  if (!database.prepare("SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL").get(memoryId)) throw new Error("MEMORY_NOT_FOUND");
  const id = randomUUID();
  database.prepare("INSERT INTO later_notes (id, memory_id, content, created_at) VALUES (?, ?, ?, ?)").run(id, memoryId, value, new Date().toISOString());
  return id;
}

export function updateMemoryRelations(memoryId: string, relatedMemoryIds: string[]) {
  const database = getDatabase();
  if (!database.prepare("SELECT id FROM memories WHERE id = ? AND trashed_at IS NULL").get(memoryId)) throw new Error("MEMORY_NOT_FOUND");
  const ids = [...new Set(relatedMemoryIds)].filter((id) => id !== memoryId);
  if (ids.length > MAX_RELATED_MEMORIES) throw new Error("INVALID_RELATIONS");
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const valid = database.prepare(`SELECT id FROM memories WHERE id IN (${placeholders}) AND trashed_at IS NULL`).all(...ids);
    if (valid.length !== ids.length) throw new Error("INVALID_RELATIONS");
  }
  withTransaction(database, () => {
    database.prepare("DELETE FROM memory_relations WHERE memory_id = ? OR related_memory_id = ?").run(memoryId, memoryId);
    const insert = database.prepare("INSERT INTO memory_relations (memory_id, related_memory_id, created_at) VALUES (?, ?, ?)");
    const now = new Date().toISOString();
    ids.forEach((id) => insert.run(memoryId, id, now));
    database.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(now, memoryId);
  });
}

function mark(sql: string, id: string, error: string) {
  const result = getDatabase().prepare(sql).run(new Date().toISOString(), id);
  if (!result.changes) throw new Error(error);
}
export function trashMemory(id: string) { mark("UPDATE memories SET trashed_at = ? WHERE id = ? AND trashed_at IS NULL", id, "MEMORY_NOT_FOUND"); }
export function restoreMemory(id: string) {
  const result = getDatabase().prepare("UPDATE memories SET trashed_at = NULL WHERE id = ? AND trashed_at IS NOT NULL").run(id);
  if (!result.changes) throw new Error("MEMORY_NOT_FOUND");
}
export function trashStage(id: string) { mark("UPDATE stages SET trashed_at = ? WHERE id = ? AND trashed_at IS NULL", id, "STAGE_NOT_FOUND"); }
export function restoreStage(id: string) {
  const result = getDatabase().prepare("UPDATE stages SET trashed_at = NULL WHERE id = ? AND trashed_at IS NOT NULL").run(id);
  if (!result.changes) throw new Error("STAGE_NOT_FOUND");
}
export function permanentlyDeleteMemory(id: string) {
  const result = getDatabase().prepare("DELETE FROM memories WHERE id = ? AND trashed_at IS NOT NULL").run(id);
  if (!result.changes) throw new Error("MEMORY_NOT_FOUND");
}
export function permanentlyDeleteStage(id: string) {
  const result = getDatabase().prepare("DELETE FROM stages WHERE id = ? AND trashed_at IS NOT NULL").run(id);
  if (!result.changes) throw new Error("STAGE_NOT_FOUND");
}
