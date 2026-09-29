import type { DatabaseSync } from "node:sqlite";
import { getPlatformAdminUserId } from "../config.ts";
import { ApiError } from "../http/errors.ts";

export function isPlatformAdminInDatabase(database: DatabaseSync, userId: string | null): boolean {
  if (!userId || userId !== getPlatformAdminUserId()) return false;
  const user = database.prepare("SELECT email_verified FROM users WHERE id=?").get(userId);
  return user?.email_verified === 1;
}

// This permission never grants Museum membership or access to private content.
export function requirePlatformAdminInDatabase(
  database: DatabaseSync,
  userId: string | null,
): string {
  if (!userId) throw new ApiError("USER_REQUIRED", 401);
  if (!isPlatformAdminInDatabase(database, userId))
    throw new ApiError("PLATFORM_ADMIN_REQUIRED", 403);
  return userId;
}
