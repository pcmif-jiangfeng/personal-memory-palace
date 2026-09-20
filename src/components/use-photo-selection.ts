"use client";

import { useCallback, useState } from "react";
import { listPhotoIds } from "../client/photo-api.ts";
import type { PhotoCatalogQuery } from "../contracts/photo.ts";
import {
  addPhotoSelection,
  replacePhotoSelection,
  togglePhotoSelection,
} from "./photo-selection.ts";

export function usePhotoSelection(catalogQuery: PhotoCatalogQuery, reportLoadFailure: () => void) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);

  const togglePhoto = useCallback((photoId: string) => {
    setSelected((current) => togglePhotoSelection(current, photoId));
  }, []);

  const selectPhoto = useCallback((photoId: string) => {
    setSelected((current) => addPhotoSelection(current, photoId));
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const removePhotoFromSelection = useCallback((photoId: string) => {
    setSelected((current) => {
      if (!current.has(photoId)) return current;
      const next = new Set(current);
      next.delete(photoId);
      return next;
    });
  }, []);

  const selectAllFilteredPhotos = useCallback(async () => {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      setSelected(replacePhotoSelection(await listPhotoIds(catalogQuery)));
    } catch {
      reportLoadFailure();
    } finally {
      setSelectingAll(false);
    }
  }, [catalogQuery, reportLoadFailure, selectingAll]);

  return {
    clearSelection,
    removePhotoFromSelection,
    selectAllFilteredPhotos,
    selected,
    selectingAll,
    selectPhoto,
    togglePhoto,
  };
}
