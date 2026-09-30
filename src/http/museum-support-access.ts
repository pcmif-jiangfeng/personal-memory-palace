import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export function validateSupportId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new ApiError("INVALID_SUPPORT_ACCESS", 400);
  return value;
}

export async function parseOwnerSupportAccess(request: Request, revoke: boolean) {
  const input = await readJsonObject(request);
  const field = revoke ? "grantId" : "memoryId";
  if (
    input.confirm !== true ||
    Object.keys(input).some((key) => key !== "confirm" && key !== field)
  )
    throw new ApiError("SUPPORT_CONFIRMATION_REQUIRED", 400);
  return { id: validateSupportId(input[field]), confirm: true };
}

export async function parseSupportRead(request: Request) {
  const input = await readJsonObject(request);
  if (Object.keys(input).some((key) => key !== "grantId" && key !== "memoryId"))
    throw new ApiError("INVALID_SUPPORT_ACCESS", 400);
  return { grantId: validateSupportId(input.grantId), memoryId: validateSupportId(input.memoryId) };
}
