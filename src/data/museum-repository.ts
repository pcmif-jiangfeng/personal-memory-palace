import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readNullableString, readNumber, readString } from "./row-readers.ts";

export function findMuseumByOwnerIdInDatabase(
  database: DatabaseSync,
  ownerId: string,
): Museum | null {
  const row = database
    .prepare("SELECT id FROM museums WHERE owner_id = ? ORDER BY created_at, id LIMIT 1")
    .get(ownerId) as { id: string } | undefined;
  return row ? findMuseumByIdInDatabase(database, row.id) : null;
}

export interface Museum {
  lastEditedByUserId: string | null;
  lastEditedByDisplayName: string | null;
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string;
  coverPhotoId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: string;
  deletionScheduledAt: string | null;
  storageQuotaBytes: number;
  storageUsedBytes: number;
}

export interface CreateMuseumInput {
  ownerId: string;
  name: string;
  slug: string;
  description?: string;
  coverPhotoId?: string | null;
  storageQuotaBytes?: number;
}

export function createMuseumInDatabase(database: DatabaseSync, input: CreateMuseumInput): Museum {
  const id = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `
    INSERT INTO museums
      (id, owner_id, name, slug, description, cover_photo_id, storage_quota_bytes, created_at, updated_at, storage_usage_ready)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `,
    )
    .run(
      id,
      input.ownerId,
      input.name,
      input.slug,
      input.description ?? "",
      input.coverPhotoId ?? null,
      input.storageQuotaBytes ?? 0,
      now,
      now,
    );
  return findMuseumByIdInDatabase(database, id)!;
}

export function findMuseumByIdInDatabase(database: DatabaseSync, id: string): Museum | null {
  const row = database
    .prepare(
      `SELECT museums.*, editor.display_name AS editor_name FROM museums
    LEFT JOIN users AS editor ON editor.id=museums.last_edited_by_user_id WHERE museums.id = ?`,
    )
    .get(id);
  if (!row) return null;
  return {
    lastEditedByUserId: readNullableString(row, "last_edited_by_user_id"),
    lastEditedByDisplayName: readNullableString(row, "editor_name"),
    id: readString(row, "id"),
    ownerId: readString(row, "owner_id"),
    name: readString(row, "name"),
    slug: readString(row, "slug"),
    description: readString(row, "description"),
    coverPhotoId: readNullableString(row, "cover_photo_id"),
    version: readNumber(row, "version"),
    createdAt: readString(row, "created_at"),
    updatedAt: readString(row, "updated_at"),
    status: readString(row, "status"),
    deletionScheduledAt: readNullableString(row, "deletion_scheduled_at"),
    storageQuotaBytes: readNumber(row, "storage_quota_bytes"),
    storageUsedBytes: readNumber(row, "storage_used_bytes"),
  };
}
