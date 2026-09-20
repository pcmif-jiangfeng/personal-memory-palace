"use client";

import { useCallback, useState } from "react";
import {
  resolvePhotoViewerIndex,
  type IdentifiedPhoto,
  type PhotoNavigationDirection,
} from "./photo-viewer-state.ts";

export function usePhotoNavigation<Photo extends IdentifiedPhoto>(
  photos: readonly Photo[],
  initialPhotoId: string,
) {
  const [activePhotoId, setActivePhotoId] = useState(initialPhotoId);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [navigationDirection, setNavigationDirection] = useState<PhotoNavigationDirection>(0);
  const initialIndex = resolvePhotoViewerIndex(photos, initialPhotoId);
  const activeIndex = resolvePhotoViewerIndex(photos, activePhotoId, fallbackIndex);
  const triggerPhoto = initialIndex >= 0 ? photos[initialIndex] : null;
  const activePhoto = activeIndex >= 0 ? photos[activeIndex] : null;

  const resetToInitialPhoto = useCallback((): boolean => {
    if (!triggerPhoto) return false;
    setFallbackIndex(initialIndex);
    setActivePhotoId(triggerPhoto.id);
    setNavigationDirection(0);
    return true;
  }, [initialIndex, triggerPhoto]);

  const showPhotoAt = useCallback(
    (index: number): boolean => {
      const nextPhoto = photos[index];
      if (!nextPhoto) return false;
      setNavigationDirection(index > activeIndex ? 1 : index < activeIndex ? -1 : 0);
      setFallbackIndex(index);
      setActivePhotoId(nextPhoto.id);
      return true;
    },
    [activeIndex, photos],
  );

  return {
    activeIndex,
    activePhoto,
    navigationDirection,
    resetToInitialPhoto,
    showPhotoAt,
    triggerPhoto,
  };
}
