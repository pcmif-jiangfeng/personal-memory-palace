export type IdentifiedPhoto = { id: string };
export type PhotoNavigationDirection = -1 | 0 | 1;

export function hasExhibitMetadata(photo: {
  exhibitTitle?: string | null;
  exhibitDescription?: string | null;
}): boolean {
  return Boolean(photo.exhibitTitle?.trim() || photo.exhibitDescription?.trim());
}

export function resolvePhotoViewerIndex(
  photos: readonly IdentifiedPhoto[],
  requestedPhotoId: string | null | undefined,
  fallbackIndex = 0,
): number {
  if (photos.length === 0) return -1;

  const requestedIndex = requestedPhotoId
    ? photos.findIndex((photo) => photo.id === requestedPhotoId)
    : -1;
  if (requestedIndex >= 0) return requestedIndex;

  return Math.min(Math.max(fallbackIndex, 0), photos.length - 1);
}

export function resolvePhotoSwipeDirection(
  deltaX: number,
  deltaY: number,
  minimumDistance: number,
): PhotoNavigationDirection {
  if (Math.abs(deltaX) < minimumDistance || Math.abs(deltaX) <= Math.abs(deltaY)) return 0;
  return deltaX < 0 ? 1 : -1;
}
