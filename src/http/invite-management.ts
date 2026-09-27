import type { CreateInviteInput } from "../domain/invites.ts";
import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseCreateInvite(request: Request): Promise<CreateInviteInput> {
  const input = await readJsonObject(request);
  if (input.useMode !== "single-use" && input.useMode !== "multi-use")
    throw new ApiError("INVALID_INVITE_MODE", 400);
  if (
    input.maxUses !== null &&
    (typeof input.maxUses !== "number" || !Number.isSafeInteger(input.maxUses) || input.maxUses < 1)
  )
    throw new ApiError("INVALID_INVITE_LIMIT", 400);
  if (input.useMode === "single-use" && input.maxUses !== 1)
    throw new ApiError("INVALID_INVITE_LIMIT", 400);
  if (input.expiresAt !== null) {
    if (typeof input.expiresAt !== "string" || input.expiresAt.length !== 24)
      throw new ApiError("INVALID_INVITE_EXPIRY", 400);
    const date = new Date(input.expiresAt);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getTime() <= Date.now() ||
      date.toISOString() !== input.expiresAt
    )
      throw new ApiError("INVALID_INVITE_EXPIRY", 400);
  }
  return {
    useMode: input.useMode,
    maxUses: input.maxUses as number | null,
    expiresAt: input.expiresAt as string | null,
  };
}

export function readInvitePage(value: string | null): number {
  if (value === null) return 1;
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new ApiError("INVALID_PAGE", 400);
  return Number(value);
}
