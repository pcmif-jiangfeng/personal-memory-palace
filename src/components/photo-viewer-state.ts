export type IdentifiedPhoto = { id: string };
export type PhotoNavigationDirection = -1 | 0 | 1;
export type PhotoViewerKeyboardAction = { type: "close" } | { type: "show-photo"; index: number };

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
export function resolvePhotoViewerKeyboardAction(
  key: string,
  activeIndex: number,
  photoCount: number,
): PhotoViewerKeyboardAction | null {
  if (key === "Escape") return { type: "close" };
  if (key === "ArrowLeft" && activeIndex > 0) return { type: "show-photo", index: activeIndex - 1 };
  if (key === "ArrowRight" && activeIndex < photoCount - 1) {
    return { type: "show-photo", index: activeIndex + 1 };
  }
  return null;
}
