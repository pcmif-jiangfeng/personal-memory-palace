import { getDatabase } from "./database.ts";
import { publicMemoryPredicate, publicStagePredicate } from "./publication-repository.ts";
import { readBooleanFlag, readNullableString, readNumber, readString } from "./row-readers.ts";
import type {
  LaterNote,
  MemoryDetails,
  MemoryImage,
  MemorySummary,
  Stage,
  StageShelfItem,
} from "../domain/models.ts";

interface StageRow {
  version: number;
  created_by_user_id: string | null;
  last_edited_by_user_id: string | null;
  creator_name: string | null;
  editor_name: string | null;
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
  author_user_id: string | null;
  author_name: string | null;
  trashed_at: string | null;
  version: number;
}

interface MemorySummaryRow {
  version: number;
  id: string;
  created_by_user_id: string | null;
  last_edited_by_user_id: string | null;
  creator_name: string | null;
  editor_name: string | null;
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
    version: readNumber(row, "version"),
    created_by_user_id: readNullableString(row, "created_by_user_id"),
    last_edited_by_user_id: readNullableString(row, "last_edited_by_user_id"),
    creator_name: readNullableString(row, "creator_name"),
    editor_name: readNullableString(row, "editor_name"),
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
    version: readNumber(row, "version"),
    id: readString(row, "id"),
    created_by_user_id: readNullableString(row, "created_by_user_id"),
    last_edited_by_user_id: readNullableString(row, "last_edited_by_user_id"),
    creator_name: readNullableString(row, "creator_name"),
    editor_name: readNullableString(row, "editor_name"),
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
    author_user_id: readNullableString(row, "author_user_id"),
    author_name: readNullableString(row, "author_name"),
    trashed_at: readNullableString(row, "trashed_at"),
    version: readNumber(row, "version"),
  };
}
function mapStage(row: StageRow): Stage {
  return {
    version: row.version,
    createdByUserId: row.created_by_user_id,
    lastEditedByUserId: row.last_edited_by_user_id,
    createdByDisplayName: row.creator_name,
    lastEditedByDisplayName: row.editor_name,
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
    version: row.version,
    id: row.id,
    createdByUserId: row.created_by_user_id,
    lastEditedByUserId: row.last_edited_by_user_id,
    createdByDisplayName: row.creator_name,
    lastEditedByDisplayName: row.editor_name,
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
  SELECT memories.*, stages.title AS stage_title, creator.display_name AS creator_name, editor.display_name AS editor_name,
    cover.storage_key AS cover_key,
    COUNT(images.id) AS image_count
  FROM memories
  LEFT JOIN users AS creator ON creator.id=memories.created_by_user_id
  LEFT JOIN users AS editor ON editor.id=memories.last_edited_by_user_id
  LEFT JOIN stages ON stages.id = memories.stage_id AND stages.museum_id IS memories.museum_id
  LEFT JOIN memory_images AS cover ON cover.memory_id = memories.id AND cover.is_cover = 1 AND cover.museum_id IS memories.museum_id
    AND (memories.museum_id IS NULL OR EXISTS (
      SELECT 1 FROM uploaded_photos p WHERE p.optimized_storage_key=cover.storage_key AND p.museum_id=memories.museum_id AND p.trashed_at IS NULL
    ))
  LEFT JOIN memory_images AS images ON images.memory_id = memories.id AND images.museum_id IS memories.museum_id
    AND (memories.museum_id IS NULL OR EXISTS (
      SELECT 1 FROM uploaded_photos p WHERE p.optimized_storage_key=images.storage_key AND p.museum_id=memories.museum_id AND p.trashed_at IS NULL
    ))
`;

// All Stage readers apply the same cover ownership rule; null-scoped demo data stays readable.
const stageSql = `SELECT stages.*, stage_covers.storage_key AS cover_key,
 creator.display_name AS creator_name, editor.display_name AS editor_name FROM stages
 LEFT JOIN users AS creator ON creator.id=stages.created_by_user_id
 LEFT JOIN users AS editor ON editor.id=stages.last_edited_by_user_id
  LEFT JOIN stage_covers ON stage_covers.stage_id=stages.id AND stage_covers.museum_id IS stages.museum_id
    AND (stages.museum_id IS NULL OR EXISTS (
      SELECT 1 FROM uploaded_photos p WHERE p.optimized_storage_key=stage_covers.storage_key AND p.museum_id=stages.museum_id AND p.trashed_at IS NULL
    ))`;

export function listActiveStages(publicOnly = false, museumId?: string): Stage[] {
  if (museumId && !publicOnly)
    return listStagesInMuseumInDatabase(getDatabase(), museumId);
  const rows = getDatabase()
    .prepare(
      `${stageSql}
     WHERE stages.trashed_at IS NULL ${publicOnly ? `AND ${publicStagePredicate}` : ""}
       AND (? IS NULL OR stages.museum_id = ?)
     ORDER BY stages.created_at`,
    )
    .all(museumId ?? null, museumId ?? null)
    .map(readStageRow);
  return rows.map(mapStage);
}

export function listStageShelfItems(publicOnly = false): StageShelfItem[] {
  const database = getDatabase();
  const stages = listActiveStages(publicOnly);
  const counts = database
    .prepare(
      `
    SELECT stage_id, COUNT(*) AS count
    FROM memories
    WHERE trashed_at IS NULL AND stage_id IS NOT NULL
      ${publicOnly ? "AND is_public = 1" : ""}
    GROUP BY stage_id
  `,
    )
    .all()
    .map(readStageCountRow);
  const previews = database
    .prepare(
      `
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
  `,
    )
    .all()
    .map(readStagePreviewRow);
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
  const rows = database
    .prepare(
      `${summarySql} WHERE memories.trashed_at IS NULL
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id ORDER BY memories.created_at DESC`,
    )
    .all()
    .map(readMemorySummaryRow);
  return rows.map(mapMemory);
}

export function searchActiveMemories(query: string, publicOnly = false): MemorySummary[] {
  const term = query.trim();
  if (!term) return listActiveMemories(publicOnly);
  const rows = getDatabase()
    .prepare(
      `${summarySql} WHERE memories.trashed_at IS NULL AND (memories.title LIKE ? OR memories.story LIKE ?)
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id ORDER BY memories.created_at DESC`,
    )
    .all(`%${term}%`, `%${term}%`)
    .map(readMemorySummaryRow);
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
  const rows = getDatabase()
    .prepare(
      `${summarySql} WHERE memories.trashed_at IS NOT NULL GROUP BY memories.id ORDER BY memories.trashed_at DESC`,
    )
    .all()
    .map(readMemorySummaryRow);
  return rows.map(mapMemory);
}

export function listTrashedStages(): Stage[] {
  const rows = getDatabase()
    .prepare(`${stageSql} WHERE stages.trashed_at IS NOT NULL ORDER BY stages.trashed_at DESC`)
    .all()
    .map(readStageRow);
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
  const row = database
    .prepare(
      `${summarySql} WHERE memories.id = ?
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id`,
    )
    .get(id);
  return row ? mapMemory(readMemorySummaryRow(row)) : null;
}

export function findStageById(id: string, publicOnly = false): Stage | null {
  return findStageByIdInDatabase(getDatabase(), id, publicOnly);
}

export function findStageByIdInDatabase(
  database: ReturnType<typeof getDatabase>,
  id: string,
  publicOnly = false,
): Stage | null {
  const row = database
    .prepare(
      `${stageSql}
     WHERE stages.id = ? AND stages.trashed_at IS NULL
       ${publicOnly ? `AND ${publicStagePredicate}` : ""}`,
    )
    .get(id);
  return row ? mapStage(readStageRow(row)) : null;
}

export function listStagesInMuseumInDatabase(
  database: ReturnType<typeof getDatabase>,
  museumId: string,
  trashed = false,
  id?: string,
): Stage[] {
  return database
    .prepare(
      `${stageSql}
    WHERE stages.museum_id=? AND stages.trashed_at IS ${trashed ? "NOT " : ""}NULL
      AND (? IS NULL OR stages.id=?) ORDER BY ${trashed ? "stages.trashed_at DESC" : "stages.created_at"}`,
    )
    .all(museumId, id ?? null, id ?? null)
    .map(readStageRow)
    .map(mapStage);
}

export function findMemoryDetails(
  id: string,
  publicOnly = false,
  museumId?: string,
): MemoryDetails | null {
  return findMemoryDetailsInDatabase(getDatabase(), id, publicOnly, museumId);
}

export function findMemoryDetailsInDatabase(
  database: ReturnType<typeof getDatabase>,
  id: string,
  publicOnly = false,
  museumId?: string,
): MemoryDetails | null {
  const ownership = database.prepare("SELECT museum_id FROM memories WHERE id=?").get(id);
  if (!ownership) return null;
  const contentMuseumId = ownership.museum_id;
  if (
    museumId &&
    !database.prepare("SELECT id FROM memories WHERE id=? AND museum_id=?").get(id, museumId)
  )
    return null;
  const memory = findMemoryByIdInDatabase(database, id, publicOnly);
  if (!memory) return null;
  const imageRows = database
    .prepare(
      `SELECT memory_images.*, uploaded_photos.id AS photo_id
     FROM memory_images
     JOIN uploaded_photos ON uploaded_photos.optimized_storage_key = memory_images.storage_key
     WHERE memory_images.memory_id = ?
       AND memory_images.museum_id IS ?
       AND uploaded_photos.museum_id IS ?
       AND uploaded_photos.trashed_at IS NULL
     ORDER BY memory_images.sort_order`,
    )
    .all(id, contentMuseumId, contentMuseumId)
    .map(readMemoryImageRow);
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
  const relationRows = database
    .prepare(
      `
    SELECT CASE WHEN memory_id = ? THEN related_memory_id ELSE memory_id END AS id
    FROM memory_relations WHERE (memory_id = ? OR related_memory_id = ?)
      AND museum_id IS ?
  `,
    )
    .all(id, id, id, contentMuseumId)
    .map(readIdRow);
  let relatedMemories: MemorySummary[] = [];
  if (relationRows.length > 0) {
    const relatedIds = relationRows.map((row) => row.id);
    const placeholders = relatedIds.map(() => "?").join(",");
    const relatedRows = database
      .prepare(
        `${summarySql} WHERE memories.id IN (${placeholders}) AND memories.trashed_at IS NULL
       AND memories.museum_id IS ?
       ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
       GROUP BY memories.id ORDER BY memories.created_at DESC`,
      )
      .all(...relatedIds, contentMuseumId)
      .map(readMemorySummaryRow);
    relatedMemories = relatedRows.map(mapMemory);
  }
  const laterNotes = listLaterNotesInDatabase(database, id, contentMuseumId as string | null);
  return { ...memory, images, relatedMemories, laterNotes };
}

export function listLaterNotesInDatabase(database: ReturnType<typeof getDatabase>, memoryId: string, museumId: string | null, trashed = false): LaterNote[] {
  return database.prepare(`SELECT n.id,n.memory_id,n.content,n.created_at,n.author_user_id,n.trashed_at,n.version,u.display_name AS author_name
    FROM later_notes n LEFT JOIN users u ON u.id=n.author_user_id
    WHERE n.memory_id=? AND n.museum_id IS ? AND n.trashed_at IS ${trashed ? "NOT " : ""}NULL ORDER BY n.created_at,n.id`)
    .all(memoryId, museumId).map(readLaterNoteRow).map((row) => ({
      id: row.id, memoryId: row.memory_id, content: row.content, createdAt: row.created_at,
      authorUserId: row.author_user_id, authorDisplayName: row.author_name, trashedAt: row.trashed_at, version: row.version,
    }));
}

export function listMemorySummariesInMuseumInDatabase(
  database: ReturnType<typeof getDatabase>,
  museumId: string,
  trashed = false,
  query = "",
): MemorySummary[] {
  return database
    .prepare(
      `${summarySql}
    WHERE memories.museum_id=? AND memories.trashed_at IS ${trashed ? "NOT " : ""}NULL
      AND (memories.title LIKE ? OR memories.story LIKE ?)
    GROUP BY memories.id ORDER BY memories.created_at DESC`,
    )
    .all(museumId, `%${query}%`, `%${query}%`)
    .map(readMemorySummaryRow)
    .map(mapMemory);
}

export function listMemoriesByStage(stageId: string, publicOnly = false): MemorySummary[] {
  const rows = getDatabase()
    .prepare(
      `${summarySql} WHERE memories.stage_id = ? AND memories.trashed_at IS NULL
     ${publicOnly ? `AND ${publicMemoryPredicate}` : ""}
     GROUP BY memories.id ORDER BY memories.created_at DESC`,
    )
    .all(stageId)
    .map(readMemorySummaryRow);
  return rows.map(mapMemory);
}
