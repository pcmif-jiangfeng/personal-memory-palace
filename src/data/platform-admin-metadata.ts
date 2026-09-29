import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { requirePlatformAdminInDatabase } from "./platform-admin.ts";
import { readString, readNumber, readBooleanFlag } from "./row-readers.ts";

export const adminMetadataPageSize = 25;

export function listPlatformMetadataInDatabase(
  database: DatabaseSync,
  userId: string | null,
  usersPage = 1,
  museumsPage = 1,
) {
  requirePlatformAdminInDatabase(database, userId);
  for (const page of [usersPage, museumsPage]) {
    if (!Number.isInteger(page) || page < 1 || page > 999999)
      throw new ApiError("INVALID_ADMIN_PAGE", 400);
  }
  // Explicit projections prevent new private columns from silently entering the dashboard.
  const users = database
    .prepare(
      `SELECT email,display_name,email_verified,created_at FROM users
    ORDER BY created_at DESC,id ASC LIMIT ? OFFSET ?`,
    )
    .all(adminMetadataPageSize, (usersPage - 1) * adminMetadataPageSize)
    .map((row) => ({
      email: readString(row, "email"),
      displayName: readString(row, "display_name"),
      verified: readBooleanFlag(row, "email_verified"),
      createdAt: readString(row, "created_at"),
    }));
  const museums = database
    .prepare(
      `SELECT m.id,m.name,m.slug,m.owner_id,u.display_name AS owner_name,
    m.created_at,m.storage_used_bytes,m.storage_quota_bytes,m.status
    FROM museums m JOIN users u ON u.id=m.owner_id
    ORDER BY m.created_at DESC,m.id ASC LIMIT ? OFFSET ?`,
    )
    .all(adminMetadataPageSize, (museumsPage - 1) * adminMetadataPageSize)
    .map((row) => ({
      id: readString(row, "id"),
      name: readString(row, "name"),
      slug: readString(row, "slug"),
      owner: { id: readString(row, "owner_id"), displayName: readString(row, "owner_name") },
      createdAt: readString(row, "created_at"),
      storageUsedBytes: readNumber(row, "storage_used_bytes"),
      storageQuotaBytes: readNumber(row, "storage_quota_bytes"),
      status: readString(row, "status"),
    }));
  return {
    users,
    museums,
    usersPage,
    museumsPage,
    usersTotal: readNumber(database.prepare("SELECT COUNT(*) AS total FROM users").get()!, "total"),
    museumsTotal: readNumber(
      database.prepare("SELECT COUNT(*) AS total FROM museums").get()!,
      "total",
    ),
  };
}
