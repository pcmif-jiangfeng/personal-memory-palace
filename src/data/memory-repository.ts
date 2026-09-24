import { getDatabase } from "./database.ts";
import { publicMemoryPredicate } from "./publication-repository.ts";
import {
  readBooleanFlag,
  readNullableString,
  readNumber,
  readString,
} from "./row-readers.ts";
import type { LaterNote, MemoryDetails, MemoryImage, MemorySummary, Stage, StageShelfItem } from "../domain/models.ts";

interface StageRow {
  id: string;
  title: string;
  description: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  cover_key: string | null;
}

interface MemoryImageRow {
  id: string;
  memory_id: string;
  photo_id: string;
  storage_key: string;
  alt_text: string;
  exhibit_title: string;
  exhibit_description: string;
  sort_order: number;
  is_cover: boolean;
  created_at: string;
}

interface LaterNoteRow {
  id: string;
  memory_id: string;
  content: string;
  created_at: string;
}

interface MemorySummaryRow {
  id: string;
  stage_id: string | null;
  stage_title: string | null;
  title: string;
  story: string;
  visibility: "private" | "shared";
  is_public: boolean;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  cover_key: string | null;
  image_count: number;
}

interface StageCountRow {
  stage_id: string;
  count: number;
}

interface StagePreviewRow {
  stage_id: string;
  storage_key: string;
}

function readVisibility(row: Record<string, unknown>): MemorySummaryRow["visibility"] {
  const visibility = readString(row, "visibility");
  if (visibility !== "private" && visibility !== "shared") {
    throw new TypeError("Invalid database column visibility; expected private or shared");
  }
  return visibility;
}

function readStageRow(row: Record<string, unknown>): StageRow {
  return {
    id: readString(row, "id"),
    title: readString(row, "title"),
    description: readString(row, "description"),
    is_public: readBooleanFlag(row, "is_public"),
    created_at: readString(row, "created_at"),
    updated_at: readString(row, "updated_at"),
    trashed_at: readNullableString(row, "trashed_at"),
    cover_key: readNullableString(row, "cover_key"),
  };
}

function readStageCountRow(row: Record<string, unknown>): StageCountRow {
  return {
    stage_id: readString(row, "stage_id"),
    count: readNumber(row, "count"),
  };
}

function readStagePreviewRow(row: Record<string, unknown>): StagePreviewRow {
  return {
    stage_id: readString(row, "stage_id"),
    storage_key: readString(row, "storage_key"),
  };
}

function readMemorySummaryRow(row: Record<string, unknown>): MemorySummaryRow {
  return {
    id: readString(row, "id"),
    stage_id: readNullableString(row, "stage_id"),
    stage_title: readNullableString(row, "stage_title"),
    title: readString(row, "title"),
    story: readString(row, "story"),
    visibility: readVisibility(row),
    is_public: readBooleanFlag(row, "is_public"),
    created_at: readString(row, "created_at"),
    updated_at: readString(row, "updated_at"),
    trashed_at: readNullableString(row, "trashed_at"),
    cover_key: readNullableString(row, "cover_key"),
    image_count: readNumber(row, "image_count"),
  };
}

function readMemoryImageRow(row: Record<string, unknown>): MemoryImageRow {
  return {
    id: readString(row, "id"),
    memory_id: readString(row, "memory_id"),
    photo_id: readString(row, "photo_id"),
    storage_key: readString(row, "storage_key"),
    alt_text: readString(row, "alt_text"),
    exhibit_title: readString(row, "exhibit_title"),
    exhibit_description: readString(row, "exhibit_description"),
    sort_order: readNumber(row, "sort_order"),
    is_cover: readBooleanFlag(row, "is_cover"),
    created_at: readString(row, "created_at"),
  };
}

function readIdRow(row: Record<string, unknown>): { id: string } {
  return { id: readString(row, "id") };
}

function readLaterNoteRow(row: Record<string, unknown>): LaterNoteRow {
  return {
    id: readString(row, "id"),
    memory_id: readString(row, "memory_id"),
    content: readString(row, "content"),
    created_at: readString(row, "created_at"),
  };
}
function mapStage(row: StageRow): Stage {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    coverKey: row.cover_key,
  };
}

function mapMemory(row: MemorySummaryRow): MemorySummary {
  return {
    id: row.id,
    stageId: row.stage_id,
    stageTitle: row.stage_title,
    title: row.title,
    story: row.story,
    visibility: row.visibility,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    coverKey: row.cover_key,
    imageCount: row.image_count,
  };
}

const summarySql = `
  SELECT memories.*, stages.title AS stage_title,
    cover.storage_key AS cover_key,
    COUNT(images.id) AS image_count
  FROM memories
  LEFT JOIN stages ON stages.id = memories.stage_id
  LEFT JOIN memory_images AS cover ON cover.memory_id = memories.id AND cover.is_cover = 1
  LEFT JOIN memory_images AS images ON images.memory_id = memories.id
`;

export function listActiveStages(publicOnly = false): Stage[] {
  const rows = getDatabase().prepare(
    `SELECT stages.*, stage_covers.storage_key AS cover_key FROM stages
     LEFT JOIN stage_covers ON stage_covers.stage_id = stages.id
     WHERE stages.trashed_at IS NULL ${publicOnly ? "AND stages.is_public = 1" : ""}
     ORDER BY stages.created_at`
  ).all().map(readStageRow);
  return rows.map(mapStage);
}

export function listStageShelfItems(publicOnly = false): StageShelfItem[] {
  const database = getDatabase();
  const stages = listActiveStages(publicOnly);
  const counts = database.prepare(`
    SELECT stage_id, COUNT(*) AS count
    FROM memories
    WHERE trashed_at IS NULL AND stage_id IS NOT NULL
      ${publicOnly ? "AND is_public = 1" : ""}
    GROUP BY stage_id
  `).all().map(readStageCountRow);
  const previews = database.prepare(`
    WITH ranked AS (
      SELECT memories.stage_id, memory_images.storage_key,
        ROW_NUMBER() OVER (
          PARTITION BY memories.stage_id
          ORDER BY memory_images.is_cover DESC, memories.created_at DESC, memory_images.sort_order
        ) AS position
      FROM memories
      JOIN memory_images ON memory_images.memory_id = memories.id
      WHERE memories.trashed_at IS NULL AND memories.stage_id IS NOT NULL
        ${publicOnly ? "AND memories.is_public = 1" : ""}
    )
    SELECT stage_id, storage_key FROM ranked WHERE position <= 3 ORDER BY stage_id, position
  `).all().map(readStagePreviewRow);
  const countByStage = new Map(counts.map((row) => [row.stage_id, row.count]));
  const previewsByStage = new Map<string, string[]>();
  for (const preview of previews) {
    const stagePreviews = previewsByStage.get(preview.stage_id) ?? [];
    stagePreviews.push(preview.storage_key);
    previewsByStage.set(preview.stage_id, stagePreviews);
  }
  return stages.map((stage) => ({
    ...stage,
    previewImageKeys: previewsByStage.get(stage.id) ?? [],
    memoryCount: countByStage.get(stage.id) ?? 0,
  }));
}

export function listActiveMemories(publicOnly = false): MemorySummary[] {
  return listActiveMemoriesInDatabase(getDatabase(), publicOnly);
}

export function listActiveMemoriesInDatabase(
  database: ReturnType<typeof getDatabase>,
  publicOnly = false,
): MemorySummary[] {
  const rows = database.prepare(
    `${summarySql} WHERE memories.trashed_at IS NULL
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id ORDER BY memories.created_at DESC`
  ).all().map(readMemorySummaryRow);
  return rows.map(mapMemory);
}

export function searchActiveMemories(query: string, publicOnly = false): MemorySummary[] {
  const term = query.trim();
  if (!term) return listActiveMemories(publicOnly);
  const rows = getDatabase().prepare(
    `${summarySql} WHERE memories.trashed_at IS NULL AND (memories.title LIKE ? OR memories.story LIKE ?)
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id ORDER BY memories.created_at DESC`
  ).all(`%${term}%`, `%${term}%`).map(readMemorySummaryRow);
  return rows.map(mapMemory);
}

export function findRandomActiveMemory(publicOnly = false): MemorySummary | null {
  return findRandomActiveMemoryInDatabase(getDatabase(), publicOnly);
}

export function findRandomActiveMemoryInDatabase(
  database: ReturnType<typeof getDatabase>,
  publicOnly = false,
): MemorySummary | null {
  const row = database
    .prepare(
      `${summarySql} WHERE memories.trashed_at IS NULL
       ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
       GROUP BY memories.id ORDER BY RANDOM() LIMIT 1`,
    )
    .get();
  return row ? mapMemory(readMemorySummaryRow(row)) : null;
}

export function listTrashedMemories(): MemorySummary[] {
  const rows = getDatabase().prepare(`${summarySql} WHERE memories.trashed_at IS NOT NULL GROUP BY memories.id ORDER BY memories.trashed_at DESC`).all().map(readMemorySummaryRow);
  return rows.map(mapMemory);
}

export function listTrashedStages(): Stage[] {
  const rows = getDatabase().prepare(`SELECT stages.*, stage_covers.storage_key AS cover_key FROM stages LEFT JOIN stage_covers ON stage_covers.stage_id = stages.id WHERE stages.trashed_at IS NOT NULL ORDER BY stages.trashed_at DESC`).all().map(readStageRow);
  return rows.map(mapStage);
}

export function findMemoryById(id: string, publicOnly = false): MemorySummary | null {
  return findMemoryByIdInDatabase(getDatabase(), id, publicOnly);
}

export function findMemoryByIdInDatabase(
  database: ReturnType<typeof getDatabase>,
  id: string,
  publicOnly = false,
): MemorySummary | null {
  const row = database.prepare(
    `${summarySql} WHERE memories.id = ?
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id`
  ).get(id);
  return row ? mapMemory(readMemorySummaryRow(row)) : null;
}

export function findStageById(id: string, publicOnly = false): Stage | null {
  const row = getDatabase().prepare(
    `SELECT stages.*, stage_covers.storage_key AS cover_key FROM stages
     LEFT JOIN stage_covers ON stage_covers.stage_id = stages.id
     WHERE stages.id = ? AND stages.trashed_at IS NULL
       ${publicOnly ? "AND stages.is_public = 1" : ""}`
  ).get(id);
  return row ? mapStage(readStageRow(row)) : null;
}

export function findMemoryDetails(id: string, publicOnly = false): MemoryDetails | null {
  const memory = findMemoryById(id, publicOnly);
  if (!memory) return null;
  const database = getDatabase();
  const imageRows = database.prepare(
    `SELECT memory_images.*, uploaded_photos.id AS photo_id
     FROM memory_images
     JOIN uploaded_photos ON uploaded_photos.optimized_storage_key = memory_images.storage_key
     WHERE memory_images.memory_id = ?
     ORDER BY memory_images.sort_order`,
  ).all(id).map(readMemoryImageRow);
  const images: MemoryImage[] = imageRows.map((row) => ({
    id: row.id,
    memoryId: row.memory_id,
    photoId: row.photo_id,
    storageKey: row.storage_key,
    altText: row.alt_text,
    exhibitTitle: row.exhibit_title,
    exhibitDescription: row.exhibit_description,
    sortOrder: row.sort_order,
    isCover: row.is_cover,
    createdAt: row.created_at,
  }));
  const relationRows = database.prepare(`
    SELECT CASE WHEN memory_id = ? THEN related_memory_id ELSE memory_id END AS id
    FROM memory_relations WHERE memory_id = ? OR related_memory_id = ?
  `).all(id, id, id).map(readIdRow);
  let relatedMemories: MemorySummary[] = [];
  if (relationRows.length > 0) {
    const relatedIds = relationRows.map((row) => row.id);
    const placeholders = relatedIds.map(() => "?").join(",");
    const relatedRows = database.prepare(
      `${summarySql} WHERE memories.id IN (${placeholders}) AND memories.trashed_at IS NULL
       ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
       GROUP BY memories.id ORDER BY memories.created_at DESC`,
    ).all(...relatedIds).map(readMemorySummaryRow);
    relatedMemories = relatedRows.map(mapMemory);
  }
  const noteRows = database.prepare(
    "SELECT * FROM later_notes WHERE memory_id = ? ORDER BY created_at"
  ).all(id).map(readLaterNoteRow);
  const laterNotes: LaterNote[] = noteRows.map((row) => ({
    id: row.id,
    memoryId: row.memory_id,
    content: row.content,
    createdAt: row.created_at,
  }));
  return { ...memory, images, relatedMemories, laterNotes };
}

export function listMemoriesByStage(stageId: string, publicOnly = false): MemorySummary[] {
  const rows = getDatabase().prepare(
    `${summarySql} WHERE memories.stage_id = ? AND memories.trashed_at IS NULL
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id ORDER BY memories.created_at DESC`
  ).all(stageId).map(readMemorySummaryRow);
  return rows.map(mapMemory);
}
