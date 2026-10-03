import { ApiError } from "./errors.ts";
import { readMuseumSlug } from "./museum-slug.ts";
import { readJsonObject } from "./schemas.ts";
import type { MuseumType } from "../data/museum-repository.ts";

export async function parseCreateMuseum(
  request: Request,
): Promise<{ name: string; slug: string; description: string; museumType: MuseumType }> {
  const input = await readJsonObject(request);
  if (
    Object.keys(input).some((key) => !["name", "slug", "description", "museumType"].includes(key))
  )
    throw new ApiError("INVALID_MUSEUM_INPUT", 400);
  const museumType = input.museumType === undefined ? "private" : input.museumType;
  if (museumType !== "private" && museumType !== "shared")
    throw new ApiError("INVALID_MUSEUM_TYPE", 400);
  for (const field of ["name", "slug", "description"] as const) {
    if (input[field] !== undefined && typeof input[field] !== "string") {
      throw new ApiError(`INVALID_${field.toUpperCase()}`, 400);
    }
  }
  const name = (input.name as string | undefined)?.trim() ?? "";
  const slug = readMuseumSlug(input.slug);
  const description = (input.description as string | undefined)?.trim() ?? "";
  if (!name || name.length > 80) throw new ApiError("INVALID_NAME", 400);
  if (description.length > 500) throw new ApiError("INVALID_DESCRIPTION", 400);
  return { name, slug, description, museumType };
}
