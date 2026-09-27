import { ApiError } from "./errors.ts";
import { readJsonObject } from "./schemas.ts";

export function readMuseumSlug(value: unknown): string {
  if (typeof value !== "string") throw new ApiError("INVALID_SLUG", 400);
  const slug = value.trim();
  if (slug.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ApiError("INVALID_SLUG", 400);
  }
  return slug;
}

export async function parseUpdateMuseumSlug(request: Request) {
  const input = await readJsonObject(request);
  return { slug: readMuseumSlug(input.slug) };
}
