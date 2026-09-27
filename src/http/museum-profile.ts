import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseUpdateMuseumProfile(request: Request) {
  const input = await readJsonObject(request);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) {
    throw new ApiError("INVALID_NAME", 400);
  }
  if (typeof input.description !== "string" || input.description.trim().length > 500) {
    throw new ApiError("INVALID_DESCRIPTION", 400);
  }
  if (
    input.coverPhotoId !== null &&
    (typeof input.coverPhotoId !== "string" ||
      !input.coverPhotoId ||
      input.coverPhotoId.length > 128)
  ) {
    throw new ApiError("INVALID_COVER_PHOTO", 400);
  }
  return {
    version: readVersion(input.version),
    name: input.name.trim(),
    description: input.description.trim(),
    coverPhotoId: input.coverPhotoId as string | null,
  };
}

function readVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new ApiError("INVALID_MUSEUM_VERSION", 400);
  return value as number;
}
