import type { MuseumDeletionConfirmation } from "../data/museum-deletion.ts";
import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseMuseumDeletionConfirmation(
  request: Request,
): Promise<MuseumDeletionConfirmation> {
  const input = await readJsonObject(request);
  if (Object.keys(input).some((key) => !["confirm", "version"].includes(key)))
    throw new ApiError("INVALID_DELETION_INPUT", 400);
  if (input.confirm !== true) throw new ApiError("DELETION_CONFIRMATION_REQUIRED", 400);
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 1)
    throw new ApiError("INVALID_MUSEUM_VERSION", 400);
  return { confirm: true, version: input.version as number };
}
