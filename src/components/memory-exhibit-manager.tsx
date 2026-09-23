"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addMemoryPhotos,
  removeMemoryPhoto,
  reorderMemoryPhotos,
  setMemoryCover,
  updateMemoryExhibitMetadata,
} from "@/client/memory-api";
import { MemoryExhibitEditorPanel } from "@/components/memory-exhibit-editor-panel";
import { useUploadTasks } from "@/components/upload-task-provider";
import { useExhibitEditor, type ExhibitPhotoView } from "@/components/use-exhibit-editor";
import { useExhibitLibrarySelection } from "@/components/use-exhibit-library-selection";
import { usePhotoCatalog } from "@/components/use-photo-catalog";
import type { PhotoUsageFilter, WorkspacePhotoView } from "@/contracts/photo";
import { copy } from "@/i18n/zh-CN";
import { imageVariantUrl } from "@/components/image-variant-url";

const PAGE_SIZE = 24;

export type { ExhibitPhotoView } from "@/components/use-exhibit-editor";

export function MemoryExhibitManager({
  memoryId,
  exhibits,
  libraryPhotos,
  initialNextCursor,
  stages,
}: {
  memoryId: string;
  exhibits: ExhibitPhotoView[];
  libraryPhotos: WorkspacePhotoView[];
  initialNextCursor: string | null;
  stages: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const { startUpload } = useUploadTasks();
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    loadFailed: libraryLoadFailed,
    loading: loadingLibrary,
    loadMore: loadMoreLibraryPhotos,
    memoryQuery,
    nextCursor,
    photos: availableLibraryPhotos,
    setMemoryQuery,
    setStageId,
    setUsageFilter,
    stageId,
    usageFilter,
  } = usePhotoCatalog({
    initialPhotos: libraryPhotos,
    initialSource: "library",
    initialNextCursor,
    pageSize: PAGE_SIZE,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const currentPhotoIds = useMemo(
    () => new Set(exhibits.map((photo) => photo.photoId)),
    [exhibits],
  );
  const filteredLibrary = availableLibraryPhotos.filter((photo) => !currentPhotoIds.has(photo.id));

  async function perform(request: () => Promise<void>, successMessage: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await request();
      setMessage(successMessage);
      router.refresh();
      return true;
    } catch {
      setError(copy.exhibits.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const editor = useExhibitEditor({
    exhibits,
    confirmDiscard: () => window.confirm(copy.exhibits.discardUnsaved),
    confirmRemove: (photo) =>
      window.confirm(
        photo.isCover
          ? copy.exhibits.removeCoverConfirm(photo.name)
          : copy.exhibits.removeConfirm(photo.name),
      ),
    reorderPhotos: (photoIds) =>
      perform(() => reorderMemoryPhotos(memoryId, photoIds), copy.exhibits.orderSaved),
    removePhoto: (photoId) =>
      perform(() => removeMemoryPhoto(memoryId, photoId), copy.exhibits.removed),
    updateMetadata: (photoId, metadata) =>
      perform(
        () => updateMemoryExhibitMetadata(memoryId, photoId, metadata.title, metadata.description),
        copy.exhibits.metadataSaved,
      ),
  });

  const {
    addSelected: addSelectedLibraryPhotos,
    remainingSlots,
    selectedPhotoIds: librarySelection,
    togglePhoto: toggleLibraryPhoto,
  } = useExhibitLibrarySelection({
    exhibitCount: exhibits.length,
    addPhotos: (photoIds) =>
      perform(() => addMemoryPhotos(memoryId, photoIds), copy.exhibits.photosAdded),
  });

  function selectExhibit(photo: ExhibitPhotoView) {
    if (!editor.selectPhoto(photo)) return;
    setMessage("");
    setError("");
  }

  function upload(files: FileList | null) {
    if (!files?.length || remainingSlots === 0) return;
    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) setError(copy.exhibits.uploadLimit(remainingSlots));
    startUpload(selectedFiles, {
      onPhotoUploaded: async (photoId) => {
        await addMemoryPhotos(memoryId, [photoId]);
        router.refresh();
      },
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <details className="relation-editor memory-exhibit-manager" open>
      <summary>{copy.exhibits.title}</summary>
      <p className="field-help">{copy.exhibits.description}</p>

      <MemoryExhibitEditorPanel
        exhibits={exhibits}
        editor={editor}
        busy={busy}
        onSelect={selectExhibit}
        onSetCover={(photoId) =>
          void perform(() => setMemoryCover(memoryId, photoId), copy.exhibits.coverSaved)
        }
      />

      <details className="memory-exhibit-add-panel">
        <summary>{copy.exhibits.addPhotos}</summary>
        {remainingSlots === 0 ? (
          <p className="quiet-empty">{copy.exhibits.full}</p>
        ) : (
          <>
            <div className="memory-exhibit-upload-block">
              <label className="button-secondary memory-exhibit-upload">
                {copy.exhibits.upload}
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={(event) => upload(event.target.files)}
                />
              </label>
              <p className="field-help">{copy.exhibits.uploadHint(remainingSlots)}</p>
            </div>

            <div className="workspace-filters memory-exhibit-filters">
              <label>
                <span>{copy.workspace.usageFilter}</span>
                <select
                  value={usageFilter}
                  onChange={(event) => setUsageFilter(event.target.value as PhotoUsageFilter)}
                >
                  <option value="all">{copy.workspace.usageAll}</option>
                  <option value="used">{copy.workspace.usageUsed}</option>
                  <option value="unused">{copy.workspace.usageUnused}</option>
                </select>
              </label>
              <label>
                <span>{copy.workspace.memorySearch}</span>
                <input
                  value={memoryQuery}
                  onChange={(event) => setMemoryQuery(event.target.value)}
                  placeholder={copy.workspace.memorySearchPlaceholder}
                />
              </label>
              <label>
                <span>{copy.workspace.stageFilter}</span>
                <select value={stageId} onChange={(event) => setStageId(event.target.value)}>
                  <option value="">{copy.workspace.stageAll}</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {filteredLibrary.length === 0 && !loadingLibrary ? (
              <p className="quiet-empty">{copy.exhibits.libraryEmpty}</p>
            ) : (
              <>
                <div className="memory-exhibit-library">
                  {filteredLibrary.map((photo) => (
                    <button
                      type="button"
                      key={photo.id}
                      className={librarySelection.has(photo.id) ? "is-selected" : ""}
                      aria-pressed={librarySelection.has(photo.id)}
                      onClick={() => toggleLibraryPhoto(photo.id)}
                    >
                      <img src={imageVariantUrl(photo.src)} alt={photo.name} loading="lazy" />
                      <span>{photo.name}</span>
                    </button>
                  ))}
                </div>
                {nextCursor ? (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={loadingLibrary}
                    onClick={loadMoreLibraryPhotos}
                  >
                    {loadingLibrary ? copy.common.loading : copy.workspace.loadMore}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy || librarySelection.size === 0}
                  onClick={() => void addSelectedLibraryPhotos()}
                >
                  {copy.exhibits.addSelected(librarySelection.size)}
                </button>
              </>
            )}
          </>
        )}
      </details>

      {message ? (
        <p className="memory-management-message" role="status">
          {message}
        </p>
      ) : null}
      {error || libraryLoadFailed ? (
        <p className="form-error memory-management-message" role="alert">
          {error || copy.exhibits.failed}
        </p>
      ) : null}
    </details>
  );
}
