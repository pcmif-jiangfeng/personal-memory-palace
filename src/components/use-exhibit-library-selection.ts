"use client";

import { useState } from "react";

const MAX_PHOTOS = 20;

export function useExhibitLibrarySelection({
  exhibitCount,
  addPhotos,
}: {
  exhibitCount: number;
  addPhotos: (photoIds: string[]) => Promise<boolean>;
}) {
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const remainingSlots = Math.max(0, MAX_PHOTOS - exhibitCount);

  function togglePhoto(photoId: string) {
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else if (next.size < remainingSlots) {
        next.add(photoId);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedPhotoIds(new Set());
  }

  async function addSelected() {
    if (selectedPhotoIds.size === 0) return;
    if (await addPhotos([...selectedPhotoIds])) {
      clearSelection();
    }
  }

  return {
    addSelected,
    clearSelection,
    remainingSlots,
    selectedPhotoIds,
    togglePhoto,
  };
}
