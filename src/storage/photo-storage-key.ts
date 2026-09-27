import { randomUUID } from "node:crypto";

export const photoUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const optimizedPhotoKeyPattern = new RegExp(
  `^uploads/(?:(?:demo|owner)|museums/${photoUuidPattern})/optimized/${photoUuidPattern}\\.webp$`,
);

export function museumPhotoStorageKey(museumId: string) {
  if (!new RegExp(`^${photoUuidPattern}$`).test(museumId))
    throw new Error("Invalid Museum storage ID");
  return `uploads/museums/${museumId}/optimized/${randomUUID()}.webp`;
}

export function isMuseumPhotoKey(key: string, museumId: string) {
  return (
    optimizedPhotoKeyPattern.test(key) && key.startsWith(`uploads/museums/${museumId}/optimized/`)
  );
}
