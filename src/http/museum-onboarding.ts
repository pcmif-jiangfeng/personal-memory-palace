import { ApiError } from "./errors.ts";
import { readMuseumSlug } from "./museum-slug.ts";
import { readJsonObject } from "./schemas.ts";

export async function parseCreateMuseum(request: Request) {
  const input = await readJsonObject(request);
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
  return { name, slug, description };
}
