import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import type { UploadedPhoto } from "@/domain/models";
import type { SavedImage } from "@/storage/image-storage";
import { withTransaction } from "./transaction";

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
        width: item.saved.width, height: item.saved.height, createdAt, usedAt: null });
    }
  });
  return photos;
}

export function listWorkspacePhotos(): UploadedPhoto[] {
  const rows = getDatabase().prepare(
    "SELECT * FROM uploaded_photos WHERE used_at IS NULL ORDER BY created_at DESC"
  ).all() as unknown as PhotoRow[];
  return rows.map(mapPhoto);
}

export function listAllUploadedPhotos(): UploadedPhoto[] {
  const rows = getDatabase().prepare(
    "SELECT * FROM uploaded_photos ORDER BY created_at DESC"
  ).all() as unknown as PhotoRow[];
  return rows.map(mapPhoto);
}
