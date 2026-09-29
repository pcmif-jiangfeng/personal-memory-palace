import { ApiError } from "./errors.ts";

export function readMuseumSelection(value: string | string[] | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new ApiError("INVALID_MUSEUM_SELECTION", 400);
  return value;
}

export function requestMuseumSelection(request: Request): string | null {
  const values = new URL(request.url).searchParams.getAll("museumId");
  return readMuseumSelection(values.length > 1 ? values : values[0]);
}
