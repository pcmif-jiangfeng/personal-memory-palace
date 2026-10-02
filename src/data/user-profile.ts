import type { DatabaseSync } from "node:sqlite";
import { normalizeNickname } from "../domain/user-profile.ts";
import { ApiError } from "../http/errors.ts";

export function updateOwnNicknameInDatabase(
  db: DatabaseSync,
  userId: string | null,
  value: unknown,
): { nickname: string } {
  if (!userId) throw new ApiError("USER_REQUIRED", 401);
  const nickname = normalizeNickname(value);
  if (nickname === null) throw new ApiError("INVALID_NICKNAME", 400);
  const result = db.prepare(
    "UPDATE users SET display_name=?,updated_at=? WHERE id=? AND email_verified=1",
  ).run(nickname, new Date().toISOString(), userId);
  if (!result.changes) throw new ApiError("USER_REQUIRED", 401);
  return { nickname };
}
