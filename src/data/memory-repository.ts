import { getDatabase } from "./database.ts";
import type { LaterNote, MemoryDetails, MemoryImage, MemorySummary, Stage, StageShelfItem } from "../domain/models.ts";

interface StageRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  cover_key: string | null;
}

interface MemoryImageRow {
  id: string;
  memory_id: string;
  storage_key: string;
  alt_text: string;
  sort_order: number;
  is_cover: number;
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
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  cover_key: string | null;
  image_count: number;
}

function mapStage(row: StageRow): Stage {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
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

export function listActiveStages(): Stage[] {
  const rows = getDatabase().prepare(
    `SELECT stages.*, stage_covers.storage_key AS cover_key FROM stages
     LEFT JOIN stage_covers ON stage_covers.stage_id = stages.id
     WHERE stages.trashed_at IS NULL ORDER BY stages.created_at`
  ).all() as unknown as StageRow[];
  return rows.map(mapStage);
}

export function listStageShelfItems(): StageShelfItem[] {
  const database = getDatabase();
  const stages = listActiveStages();
  const counts = database.prepare(`
    SELECT stage_id, COUNT(*) AS count
    FROM memories
    WHERE trashed_at IS NULL AND stage_id IS NOT NULL
    GROUP BY stage_id
  `).all() as unknown as Array<{ stage_id: string; count: number }>;
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
    )
    SELECT stage_id, storage_key FROM ranked WHERE position <= 3 ORDER BY stage_id, position
  `).all() as unknown as Array<{ stage_id: string; storage_key: string }>;
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

export function listActiveMemories(): MemorySummary[] {
  const rows = getDatabase().prepare(
    `${summarySql} WHERE memories.trashed_at IS NULL GROUP BY memories.id ORDER BY memories.created_at DESC`
  ).all() as unknown as MemorySummaryRow[];
  return rows.map(mapMemory);
}

export function searchActiveMemories(query: string): MemorySummary[] {
  const term = query.trim();
  if (!term) return listActiveMemories();
  const rows = getDatabase().prepare(
    `${summarySql} WHERE memories.trashed_at IS NULL AND (memories.title LIKE ? OR memories.story LIKE ?) GROUP BY memories.id ORDER BY memories.created_at DESC`
  ).all(`%${term}%`, `%${term}%`) as unknown as MemorySummaryRow[];
  return rows.map(mapMemory);
}

export function findRandomActiveMemory(): MemorySummary | null {
  const row = getDatabase().prepare(`${summarySql} WHERE memories.trashed_at IS NULL GROUP BY memories.id ORDER BY RANDOM() LIMIT 1`).get() as unknown as MemorySummaryRow | undefined;
  return row ? mapMemory(row) : null;
}

export function listTrashedMemories(): MemorySummary[] {
  const rows = getDatabase().prepare(`${summarySql} WHERE memories.trashed_at IS NOT NULL GROUP BY memories.id ORDER BY memories.trashed_at DESC`).all() as unknown as MemorySummaryRow[];
  return rows.map(mapMemory);
}

export function listTrashedStages(): Stage[] {
  const rows = getDatabase().prepare(`SELECT stages.*, stage_covers.storage_key AS cover_key FROM stages LEFT JOIN stage_covers ON stage_covers.stage_id = stages.id WHERE stages.trashed_at IS NOT NULL ORDER BY stages.trashed_at DESC`).all() as unknown as StageRow[];
  return rows.map(mapStage);
}

export function findMemoryById(id: string): MemorySummary | null {
  const row = getDatabase().prepare(
    `${summarySql} WHERE memories.id = ? GROUP BY memories.id`
  ).get(id) as unknown as MemorySummaryRow | undefined;
  return row ? mapMemory(row) : null;
}

export function findStageById(id: string): Stage | null {
  const row = getDatabase().prepare(
    `SELECT stages.*, stage_covers.storage_key AS cover_key FROM stages
     LEFT JOIN stage_covers ON stage_covers.stage_id = stages.id
     WHERE stages.id = ? AND stages.trashed_at IS NULL`
  ).get(id) as unknown as StageRow | undefined;
  return row ? mapStage(row) : null;
}

export function findMemoryDetails(id: string): MemoryDetails | null {
  const memory = findMemoryById(id);
  if (!memory) return null;
  const database = getDatabase();
  const imageRows = database.prepare(
    "SELECT * FROM memory_images WHERE memory_id = ? ORDER BY sort_order"
  ).all(id) as unknown as MemoryImageRow[];
  const images: MemoryImage[] = imageRows.map((row) => ({
    id: row.id,
    memoryId: row.memory_id,
    storageKey: row.storage_key,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    isCover: row.is_cover === 1,
    createdAt: row.created_at,
  }));
  const relationRows = database.prepare(`
    SELECT CASE WHEN memory_id = ? THEN related_memory_id ELSE memory_id END AS id
    FROM memory_relations WHERE memory_id = ? OR related_memory_id = ?
  `).all(id, id, id) as unknown as Array<{ id: string }>;
  let relatedMemories: MemorySummary[] = [];
  if (relationRows.length > 0) {
    const relatedIds = relationRows.map((row) => row.id);
    const placeholders = relatedIds.map(() => "?").join(",");
    const relatedRows = database.prepare(
      `${summarySql} WHERE memories.id IN (${placeholders}) AND memories.trashed_at IS NULL
       GROUP BY memories.id ORDER BY memories.created_at DESC`,
    ).all(...relatedIds) as unknown as MemorySummaryRow[];
    relatedMemories = relatedRows.map(mapMemory);
  }
  const noteRows = database.prepare(
    "SELECT * FROM later_notes WHERE memory_id = ? ORDER BY created_at"
  ).all(id) as unknown as LaterNoteRow[];
  const laterNotes: LaterNote[] = noteRows.map((row) => ({
    id: row.id,
    memoryId: row.memory_id,
    content: row.content,
    createdAt: row.created_at,
  }));
  return { ...memory, images, relatedMemories, laterNotes };
}

export function listMemoriesByStage(stageId: string): MemorySummary[] {
  const rows = getDatabase().prepare(
    `${summarySql} WHERE memories.stage_id = ? AND memories.trashed_at IS NULL GROUP BY memories.id ORDER BY memories.created_at DESC`
  ).all(stageId) as unknown as MemorySummaryRow[];
  return rows.map(mapMemory);
}
