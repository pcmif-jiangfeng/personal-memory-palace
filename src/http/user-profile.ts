import { normalizeNickname } from "../domain/user-profile.ts";
import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseNicknameUpdate(request: Request): Promise<{ nickname: string }> {
  const input = await readJsonObject(request);
  if (Object.keys(input).some((key) => key !== "nickname"))
    throw new ApiError("INVALID_PROFILE_INPUT", 400);
  const nickname = normalizeNickname(input.nickname);
  if (nickname === null) throw new ApiError("INVALID_NICKNAME", 400);
  return { nickname };
}
