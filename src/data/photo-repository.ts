import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.ts";
import type { UploadedPhoto } from "../domain/models.ts";
import type { SavedImage } from "../storage/image-storage.ts";
import { withTransaction } from "./transaction.ts";
import { DomainError } from "../domain/errors.ts";

interface PhotoRow {
  id: string;
  original_name: string;
  mime_type: string;
  optimized_storage_key: string;
  original_storage_key: string | null;
  width: number;
  height: number;
  created_at: string;
  used_at: string | null;
  library_archived_at: string | null;
}

interface PhotoReferenceRow {
  photo_id: string;
  memory_id: string;
  memory_title: string;
  stage_id: string | null;
}

export interface WorkspacePhoto extends UploadedPhoto {
  libraryMember: boolean;
  activeMemoryCount: number;
  memoryTitles: string[];
  stageIds: string[];
}

export interface PhotoCatalogQuery {
  source: "recent" | "library";
  usage?: "all" | "used" | "unused";
  stageId?: string;
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface PhotoCatalogPage {
  items: WorkspacePhoto[];
  nextCursor: string | null;
}

export function prepareOptimizedUploadInDatabase(
  database: ReturnType<typeof getDatabase>,
  storageKey: string,
): string {
  const id = randomUUID();
  database
    .prepare("INSERT INTO pending_uploads (id, storage_key, created_at) VALUES (?, ?, ?)")
    .run(id, storageKey, new Date().toISOString());
  return id;
}

export function prepareOptimizedUpload(storageKey: string): string {
  return prepareOptimizedUploadInDatabase(getDatabase(), storageKey);
}

export function commitOptimizedUploadInDatabase(
  database: ReturnType<typeof getDatabase>,
  operationId: string,
  item: { originalName: string; mimeType: string; saved: SavedImage },
): UploadedPhoto {
  return withTransaction(database, () => {
    const pending = database
      .prepare("SELECT storage_key AS storageKey FROM pending_uploads WHERE id = ?")
      .get(operationId) as { storageKey: string } | undefined;
    if (!pending || pending.storageKey !== item.saved.optimizedStorageKey) {
      throw new Error("UPLOAD_OPERATION_NOT_FOUND");
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    database.prepare(`INSERT INTO uploaded_photos
      (id, original_name, mime_type, optimized_storage_key, original_storage_key, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, item.originalName, item.mimeType, item.saved.optimizedStorageKey,
        item.saved.originalStorageKey, item.saved.width, item.saved.height, createdAt,
      );
    database.prepare("DELETE FROM pending_uploads WHERE id = ?").run(operationId);
    return {
      id,
      originalName: item.originalName,
      mimeType: item.mimeType,
      optimizedStorageKey: item.saved.optimizedStorageKey,
      originalStorageKey: item.saved.originalStorageKey,
      width: item.saved.width,
      height: item.saved.height,
      createdAt,
      usedAt: null,
      libraryArchivedAt: null,
    };
  });
}

export function commitOptimizedUpload(
  operationId: string,
  item: { originalName: string; mimeType: string; saved: SavedImage },
): UploadedPhoto {
  return commitOptimizedUploadInDatabase(getDatabase(), operationId, item);
}

function mapPhoto(row: PhotoRow): UploadedPhoto {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    optimizedStorageKey: row.optimized_storage_key,
    originalStorageKey: row.original_storage_key,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    usedAt: row.used_at,
    libraryArchivedAt: row.library_archived_at,
  };
}

export function addUploadedPhotos(
  items: Array<{ originalName: string; mimeType: string; saved: SavedImage }>
): UploadedPhoto[] {
  const database = getDatabase();
  const insert = database.prepare(`INSERT INTO uploaded_photos
    (id, original_name, mime_type, optimized_storage_key, original_storage_key, width, height, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const photos: UploadedPhoto[] = [];
  withTransaction(database, () => {
    for (const item of items) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      insert.run(id, item.originalName, item.mimeType, item.saved.optimizedStorageKey,
        item.saved.originalStorageKey, item.saved.width, item.saved.height, createdAt);
      photos.push({ id, originalName: item.originalName, mimeType: item.mimeType,
        optimizedStorageKey: item.saved.optimizedStorageKey, originalStorageKey: item.saved.originalStorageKey,
        width: item.saved.width, height: item.saved.height, createdAt, usedAt: null,
        libraryArchivedAt: null });
    }
  });
  return photos;
}

export function listWorkspacePhotos(): UploadedPhoto[] {
  const rows = getDatabase().prepare(
    `SELECT * FROM uploaded_photos
     WHERE used_at IS NULL AND library_archived_at IS NULL
     ORDER BY created_at DESC`
  ).all() as unknown as PhotoRow[];
  return rows.map(mapPhoto);
}

export function listAllUploadedPhotos(): UploadedPhoto[] {
  const rows = getDatabase().prepare(
    "SELECT * FROM uploaded_photos ORDER BY created_at DESC"
  ).all() as unknown as PhotoRow[];
  return rows.map(mapPhoto);
}

export function listUploadedPhotosByIds(ids: string[]): UploadedPhoto[] {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = getDatabase()
    .prepare(`SELECT * FROM uploaded_photos WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as unknown as PhotoRow[];
  const photosById = new Map(rows.map((row) => [row.id, mapPhoto(row)]));
  return uniqueIds.flatMap((id) => {
    const photo = photosById.get(id);
    return photo ? [photo] : [];
  });
}

export function listWorkspacePhotoCatalog(): WorkspacePhoto[] {
  return listWorkspacePhotoCatalogInDatabase(getDatabase());
}

function encodePhotoCursor(row: PhotoRow): string {
  return Buffer.from(`${row.created_at}\n${row.id}`).toString("base64url");
}

function decodePhotoCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id, ...extra] = Buffer.from(cursor, "base64url").toString().split("\n");
    return createdAt && id && extra.length === 0 ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

export function queryWorkspacePhotoCatalogInDatabase(
  database: ReturnType<typeof getDatabase>,
  query: PhotoCatalogQuery,
): PhotoCatalogPage {
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 60);
  const cursor = decodePhotoCursor(query.cursor);
  if (query.cursor && !cursor) throw new DomainError("INVALID_CURSOR");
  const activeReference = `EXISTS (
    SELECT 1 FROM memory_images
    JOIN memories ON memories.id = memory_images.memory_id AND memories.trashed_at IS NULL
    WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
  )`;
  const libraryMember = `(used_at IS NOT NULL OR library_archived_at IS NOT NULL OR ${activeReference})`;
  const where = [query.source === "library" ? libraryMember : `NOT ${libraryMember}`];
  const parameters: Array<string | number> = [];
  if (query.source === "library" && query.usage === "used") where.push(activeReference);
  if (query.source === "library" && query.usage === "unused") where.push(`NOT ${activeReference}`);
  if (query.stageId) {
    where.push(`EXISTS (
      SELECT 1 FROM memory_images
      JOIN memories ON memories.id = memory_images.memory_id AND memories.trashed_at IS NULL
      WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
        AND memories.stage_id = ?
    )`);
    parameters.push(query.stageId);
  }
  const normalizedQuery = query.query?.trim().toLocaleLowerCase();
  if (normalizedQuery) {
    where.push(`EXISTS (
      SELECT 1 FROM memory_images
      JOIN memories ON memories.id = memory_images.memory_id AND memories.trashed_at IS NULL
      WHERE memory_images.storage_key = uploaded_photos.optimized_storage_key
        AND lower(memories.title) LIKE ?
    )`);
    parameters.push(`%${normalizedQuery}%`);
  }
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = database.prepare(`
    SELECT * FROM uploaded_photos
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...parameters, limit + 1) as unknown as PhotoRow[];
  const pageRows = rows.slice(0, limit);
  const ids = pageRows.map((row) => row.id);
  const references = ids.length
    ? database.prepare(`
        SELECT uploaded_photos.id AS photo_id, memories.id AS memory_id,
               memories.title AS memory_title, memories.stage_id
        FROM uploaded_photos
        JOIN memory_images ON memory_images.storage_key = uploaded_photos.optimized_storage_key
        JOIN memories ON memories.id = memory_images.memory_id AND memories.trashed_at IS NULL
        WHERE uploaded_photos.id IN (${ids.map(() => "?").join(",")})
      `).all(...ids) as unknown as PhotoReferenceRow[]
    : [];
  const referencesByPhoto = new Map<string, { memoryIds: Set<string>; memoryTitles: Set<string>; stageIds: Set<string> }>();
  for (const reference of references) {
    const current = referencesByPhoto.get(reference.photo_id) ?? {
      memoryIds: new Set<string>(), memoryTitles: new Set<string>(), stageIds: new Set<string>(),
    };
    current.memoryIds.add(reference.memory_id);
    current.memoryTitles.add(reference.memory_title);
    if (reference.stage_id) current.stageIds.add(reference.stage_id);
    referencesByPhoto.set(reference.photo_id, current);
  }
  return {
    items: pageRows.map((row) => {
      const photo = mapPhoto(row);
      const reference = referencesByPhoto.get(row.id);
      return {
        ...photo,
        libraryMember: query.source === "library",
        activeMemoryCount: reference?.memoryIds.size ?? 0,
        memoryTitles: [...(reference?.memoryTitles ?? [])],
        stageIds: [...(reference?.stageIds ?? [])],
      };
    }),
    nextCursor: rows.length > limit && pageRows.length
      ? encodePhotoCursor(pageRows[pageRows.length - 1])
      : null,
  };
}

export function queryWorkspacePhotoCatalog(query: PhotoCatalogQuery): PhotoCatalogPage {
  return queryWorkspacePhotoCatalogInDatabase(getDatabase(), query);
}

export function listWorkspacePhotoCatalogInDatabase(
  database: ReturnType<typeof getDatabase>,
): WorkspacePhoto[] {
  const photos = database
    .prepare("SELECT * FROM uploaded_photos ORDER BY created_at DESC")
    .all() as unknown as PhotoRow[];
  const references = database
    .prepare(
      `SELECT uploaded_photos.id AS photo_id,
              memories.id AS memory_id,
              memories.title AS memory_title,
              memories.stage_id
       FROM uploaded_photos
       JOIN memory_images
         ON memory_images.storage_key = uploaded_photos.optimized_storage_key
       JOIN memories
         ON memories.id = memory_images.memory_id
        AND memories.trashed_at IS NULL`,
    )
    .all() as unknown as PhotoReferenceRow[];
  const referencesByPhoto = new Map<
    string,
    { memoryIds: Set<string>; memoryTitles: Set<string>; stageIds: Set<string> }
  >();
  for (const reference of references) {
    const current = referencesByPhoto.get(reference.photo_id) ?? {
      memoryIds: new Set<string>(),
      memoryTitles: new Set<string>(),
      stageIds: new Set<string>(),
    };
    current.memoryIds.add(reference.memory_id);
    current.memoryTitles.add(reference.memory_title);
    if (reference.stage_id) current.stageIds.add(reference.stage_id);
    referencesByPhoto.set(reference.photo_id, current);
  }
  return photos.map((row) => {
    const photo = mapPhoto(row);
    const reference = referencesByPhoto.get(photo.id);
    return {
      ...photo,
      libraryMember: Boolean(
        photo.usedAt || photo.libraryArchivedAt || (reference?.memoryIds.size ?? 0) > 0,
      ),
      activeMemoryCount: reference?.memoryIds.size ?? 0,
      memoryTitles: [...(reference?.memoryTitles ?? [])],
      stageIds: [...(reference?.stageIds ?? [])],
    };
  });
}

export function archiveUploadedPhoto(photoId: string): { archived: true } {
  return archiveUploadedPhotoInDatabase(getDatabase(), photoId);
}

export function archiveUploadedPhotoInDatabase(
  database: ReturnType<typeof getDatabase>,
  photoId: string,
): { archived: true } {
  const result = database
    .prepare(
      `UPDATE uploaded_photos
       SET library_archived_at = COALESCE(library_archived_at, ?)
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), photoId);
  if (result.changes === 0) throw new DomainError("PHOTO_NOT_FOUND");
  return { archived: true };
}
