"use client";

import { useCallback, useState } from "react";
import { listPhotoIds } from "../client/photo-api.ts";
import type { PhotoCatalogQuery } from "../contracts/photo.ts";
import {
  addPhotoSelection,
  removePhotoSelections,
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
    setSelected((current) => removePhotoSelections(current, [photoId]));
  }, []);

  const removePhotosFromSelection = useCallback((photoIds: Iterable<string>) => {
    setSelected((current) => removePhotoSelections(current, photoIds));
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
    removePhotosFromSelection,
    selectAllFilteredPhotos,
    selected,
    selectingAll,
    selectPhoto,
    togglePhoto,
  };
}
