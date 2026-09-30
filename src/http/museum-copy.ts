import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseMuseumCopyTarget(request: Request) {
  const input = await readJsonObject(request);
  if (
    Object.keys(input).some((key) => key !== "targetMuseumId") ||
    typeof input.targetMuseumId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.targetMuseumId)
  )
    throw new ApiError("INVALID_COPY_TARGET", 400);
  return input.targetMuseumId;
}
