"use client";

import { useState } from "react";

export interface ExhibitPhotoView {
  photoId: string;
  name: string;
  src: string;
  isCover: boolean;
  exhibitTitle: string;
  exhibitDescription: string;
}

export interface ExhibitDraft {
  title: string;
  description: string;
}

export function createExhibitDraft(photo: ExhibitPhotoView | undefined): ExhibitDraft {
  return {
    title: photo?.exhibitTitle ?? "",
    description: photo?.exhibitDescription ?? "",
  };
}

export function updateExhibitDraft(
  draft: ExhibitDraft,
  patch: Partial<ExhibitDraft>,
): ExhibitDraft {
  return { ...draft, ...patch };
}

export function selectExhibitEditorPhoto({
  currentPhotoId,
  targetPhoto,
  metadataDirty,
  discardConfirmed,
}: {
  currentPhotoId: string | undefined;
  targetPhoto: ExhibitPhotoView;
  metadataDirty: boolean;
  discardConfirmed: boolean;
}): { selectedPhotoId: string; draft: ExhibitDraft } | null {
  if (targetPhoto.photoId === currentPhotoId || (metadataDirty && !discardConfirmed)) return null;
  return { selectedPhotoId: targetPhoto.photoId, draft: createExhibitDraft(targetPhoto) };
}

export function saveExhibitEditorMetadata(
  selectedPhoto: ExhibitPhotoView | undefined,
  draft: ExhibitDraft,
  updateMetadata: (photoId: string, draft: ExhibitDraft) => Promise<boolean>,
): Promise<boolean> {
  return selectedPhoto ? updateMetadata(selectedPhoto.photoId, draft) : Promise.resolve(false);
}

interface UseExhibitEditorOptions {
  exhibits: ExhibitPhotoView[];
  confirmDiscard: () => boolean;
  confirmRemove: (photo: ExhibitPhotoView) => boolean;
  reorderPhotos: (photoIds: string[]) => Promise<boolean>;
  removePhoto: (photoId: string) => Promise<boolean>;
  updateMetadata: (photoId: string, draft: ExhibitDraft) => Promise<boolean>;
}

export function useExhibitEditor({
  exhibits,
  confirmDiscard,
  confirmRemove,
  reorderPhotos,
  removePhoto,
  updateMetadata,
}: UseExhibitEditorOptions) {
  const initialSelected = exhibits.find((photo) => photo.isCover) ?? exhibits[0];
  const [selectedPhotoId, setSelectedPhotoId] = useState(initialSelected?.photoId ?? "");
  const [draft, setDraft] = useState<ExhibitDraft>(() => createExhibitDraft(initialSelected));
  const [metadataDirty, setMetadataDirty] = useState(false);

  const selectedPhoto = exhibits.find((photo) => photo.photoId === selectedPhotoId) ?? exhibits[0];

  function loadDraft(photo: ExhibitPhotoView | undefined) {
    setDraft(createExhibitDraft(photo));
    setMetadataDirty(false);
  }

  function selectPhoto(photo: ExhibitPhotoView) {
    if (photo.photoId === selectedPhoto?.photoId) return false;
    const selection = selectExhibitEditorPhoto({
      currentPhotoId: selectedPhoto?.photoId,
      targetPhoto: photo,
      metadataDirty,
      discardConfirmed: !metadataDirty || confirmDiscard(),
    });
    if (!selection) return false;
    setSelectedPhotoId(selection.selectedPhotoId);
    setDraft(selection.draft);
    setMetadataDirty(false);
    return true;
  }

  function updateDraft(patch: Partial<ExhibitDraft>) {
    setDraft((current) => updateExhibitDraft(current, patch));
    setMetadataDirty(true);
  }

  async function saveMetadata() {
    if (await saveExhibitEditorMetadata(selectedPhoto, draft, updateMetadata)) {
      setMetadataDirty(false);
    }
  }

  async function moveSelected(direction: -1 | 1) {
    if (!selectedPhoto) return;
    const index = exhibits.findIndex((photo) => photo.photoId === selectedPhoto.photoId);
    const target = index + direction;
    if (target < 0 || target >= exhibits.length) return;
    const ordered = exhibits.map((photo) => photo.photoId);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await reorderPhotos(ordered);
  }

  async function removeSelected() {
    if (!selectedPhoto || !confirmRemove(selectedPhoto)) return;
    const index = exhibits.findIndex((photo) => photo.photoId === selectedPhoto.photoId);
    const fallback = exhibits[index + 1] ?? exhibits[index - 1];
    if (await removePhoto(selectedPhoto.photoId)) {
      setSelectedPhotoId(fallback?.photoId ?? "");
      loadDraft(fallback);
    }
  }

  return {
    draft,
    metadataDirty,
    moveSelected,
    removeSelected,
    saveMetadata,
    selectedPhoto,
    selectedPhotoId,
    selectPhoto,
    updateDraft,
  };
}

export type ExhibitEditorController = ReturnType<typeof useExhibitEditor>;
