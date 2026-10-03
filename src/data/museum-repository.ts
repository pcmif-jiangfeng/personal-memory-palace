import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readNullableString, readNumber, readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export type MuseumType = "private" | "shared";

export function findMuseumByOwnerIdInDatabase(
  database: DatabaseSync,
  ownerId: string,
): Museum | null {
  const row = database
    .prepare("SELECT id FROM museums WHERE owner_id = ? AND museum_type='private'")
    .get(ownerId) as { id: string } | undefined;
  return row ? findMuseumByIdInDatabase(database, row.id) : null;
}

export interface Museum {
  museumType: MuseumType;
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
  museumType?: MuseumType;
  ownerId: string;
  name: string;
  slug: string;
  description?: string;
  coverPhotoId?: string | null;
  storageQuotaBytes?: number;
}

export function createMuseumInDatabase(database: DatabaseSync, input: CreateMuseumInput): Museum {
  return withTransaction(database, () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    database
      .prepare(
        `
      INSERT INTO museums
      (id, owner_id, museum_type, name, slug, description, cover_photo_id, storage_quota_bytes, created_at, updated_at, storage_usage_ready)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `,
      )
      .run(
        id,
        input.ownerId,
        input.museumType ?? "private",
        input.name,
        input.slug,
        input.description ?? "",
        input.coverPhotoId ?? null,
        input.storageQuotaBytes ?? 0,
        now,
        now,
      );
    // Assign the account allowance once, not once per palace. The insert and assignment roll back together.
    database.prepare("UPDATE users SET storage_quota_bytes=? WHERE id=? AND storage_quota_bytes IS NULL")
      .run(input.storageQuotaBytes ?? 0, input.ownerId);
    return findMuseumByIdInDatabase(database, id)!;
  });
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
    museumType: readString(row, "museum_type") as MuseumType,
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
