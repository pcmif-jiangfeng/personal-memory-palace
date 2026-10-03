import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export type OwnerTransferAction =
  | { action: "request"; targetUserId: string; version: number; confirm: true }
  | { action: "accept" | "reject" | "cancel"; requestId: string; confirm: true };

export async function parseOwnerTransferAction(request: Request): Promise<OwnerTransferAction> {
  const input = await readJsonObject(request);
  if (input.confirm !== true) throw new ApiError("TRANSFER_CONFIRMATION_REQUIRED", 400);
  if (input.action === "request") {
    if (
      Object.keys(input).some(
        (key) => !["action", "targetUserId", "version", "confirm"].includes(key),
      )
    )
      throw new ApiError("INVALID_TRANSFER_INPUT", 400);
    if (
      typeof input.targetUserId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.targetUserId)
    )
      throw new ApiError("INVALID_TRANSFER_TARGET", 400);
    if (
      typeof input.version !== "number" ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1
    )
      throw new ApiError("INVALID_MUSEUM_VERSION", 400);
    return {
      action: "request",
      targetUserId: input.targetUserId,
      version: input.version,
      confirm: true,
    };
  }
  if (input.action !== "accept" && input.action !== "reject" && input.action !== "cancel")
    throw new ApiError("INVALID_TRANSFER_ACTION", 400);
  if (Object.keys(input).some((key) => !["action", "requestId", "confirm"].includes(key)))
    throw new ApiError("INVALID_TRANSFER_INPUT", 400);
  if (typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId))
    throw new ApiError("INVALID_TRANSFER_REQUEST", 400);
  return {
    action: input.action,
    requestId: input.requestId,
    confirm: true,
  };
}
