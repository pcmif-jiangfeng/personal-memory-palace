import type { MuseumOwnerTransferInput } from "../domain/museum-owner-transfer.ts";
import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseMuseumOwnerTransfer(
  request: Request,
): Promise<MuseumOwnerTransferInput> {
  const input = await readJsonObject(request);
  if (input.confirm !== true) throw new ApiError("TRANSFER_CONFIRMATION_REQUIRED", 400);
  if (typeof input.targetUserId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.targetUserId))
    throw new ApiError("INVALID_TRANSFER_TARGET", 400);
  if (input.oldOwnerDisposition !== "stay" && input.oldOwnerDisposition !== "leave")
    throw new ApiError("INVALID_OWNER_DISPOSITION", 400);
  if (
    typeof input.version !== "number" ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1
  )
    throw new ApiError("INVALID_MUSEUM_VERSION", 400);
  if (
    Object.keys(input).some(
      (key) => !["confirm", "targetUserId", "oldOwnerDisposition", "version"].includes(key),
    )
  )
    throw new ApiError("INVALID_TRANSFER_INPUT", 400);
  return {
    confirm: input.confirm,
    targetUserId: input.targetUserId,
    oldOwnerDisposition: input.oldOwnerDisposition,
    version: input.version,
  };
}
