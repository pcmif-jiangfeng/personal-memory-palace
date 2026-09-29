"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientApiError } from "@/client/http-client";
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
  initialVersion,
  exhibits: incomingExhibits,
  libraryPhotos,
  initialNextCursor,
  stages,
  museumId,
}: {
  memoryId: string;
  initialVersion: number;
  museumId: string;
  exhibits: ExhibitPhotoView[];
  libraryPhotos: WorkspacePhotoView[];
  initialNextCursor: string | null;
  stages: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const { startUpload } = useUploadTasks();
  const inputRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef(initialVersion);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingCount = useRef(0);
  const [savedVersion, setSavedVersion] = useState(initialVersion);
  const [snapshot, setSnapshot] = useState({ version: initialVersion, exhibits: incomingExhibits });
  // Only adopt the snapshot produced by our own acknowledged save, never silently rebase a draft.
  if (snapshot.version !== savedVersion && initialVersion === savedVersion) {
    setSnapshot({ version: initialVersion, exhibits: incomingExhibits });
  }
  const exhibits = snapshot.exhibits;

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
  const [requestBusy, setRequestBusy] = useState(false);
  const busy = requestBusy || snapshot.version !== savedVersion;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const conflict = error === copy.management.conflict || initialVersion > savedVersion;

  const currentPhotoIds = useMemo(
    () => new Set(exhibits.map((photo) => photo.photoId)),
    [exhibits],
  );
  const filteredLibrary = availableLibraryPhotos.filter((photo) => !currentPhotoIds.has(photo.id));

  async function save(request: (version: number) => Promise<number>, successMessage: string) {
    pendingCount.current += 1;
    setRequestBusy(true);
    setMessage("");
    setError("");
    // Uploads can finish in parallel; serialize only their relation writes, not the uploads.
    const pending = mutationQueue.current.then(async () => {
      const version = await request(versionRef.current);
      versionRef.current = version;
      setSavedVersion(version);
      setMessage(successMessage);
      router.refresh();
    });
    mutationQueue.current = pending.catch(() => undefined);
    try {
      await pending;
    } catch (error) {
      setError(
        error instanceof ClientApiError && error.code === "MEMORY_VERSION_CONFLICT"
          ? copy.management.conflict
          : copy.exhibits.failed,
      );
      throw error;
    } finally {
      pendingCount.current -= 1;
      setRequestBusy(pendingCount.current > 0);
    }
  }

  async function perform(
    request: (version: number) => Promise<number>,
    successMessage: string,
  ): Promise<boolean> {
    if (busy || pendingCount.current > 0) return false;
    try {
      await save(request, successMessage);
      return true;
    } catch {
      return false;
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
      perform(
        (version) => reorderMemoryPhotos(memoryId, photoIds, version, museumId),
        copy.exhibits.orderSaved,
      ),
    removePhoto: (photoId) =>
      perform(
        (version) => removeMemoryPhoto(memoryId, photoId, version, museumId),
        copy.exhibits.removed,
      ),
    updateMetadata: (photoId, metadata) =>
      perform(
        (version) =>
          updateMemoryExhibitMetadata(
            memoryId,
            photoId,
            metadata.title,
            metadata.description,
            version,
            museumId,
          ),
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
      perform(
        (version) => addMemoryPhotos(memoryId, photoIds, version, museumId),
        copy.exhibits.photosAdded,
      ),
  });

  function selectExhibit(photo: ExhibitPhotoView) {
    if (!editor.selectPhoto(photo)) return;
    setMessage("");
    setError("");
  }

  function upload(files: FileList | null) {
    if (!files?.length || remainingSlots === 0 || busy || pendingCount.current > 0) return;
    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) setError(copy.exhibits.uploadLimit(remainingSlots));
    startUpload(selectedFiles, {
      museumId,
      onPhotoUploaded: async (photoId) => {
        await save(
          (version) => addMemoryPhotos(memoryId, [photoId], version, museumId),
          copy.exhibits.photosAdded,
        );
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
          void perform(
            (version) => setMemoryCover(memoryId, photoId, version, museumId),
            copy.exhibits.coverSaved,
          )
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
                  disabled={busy}
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
          {snapshot.version !== savedVersion && !requestBusy && !conflict ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (window.confirm(copy.management.reloadConfirm)) window.location.reload();
              }}
            >
              {copy.management.reloadLatest}
            </button>
          ) : null}
        </p>
      ) : null}
      {error || libraryLoadFailed || conflict ? (
        <p className="form-error memory-management-message" role="alert">
          {conflict ? copy.management.conflict : error || copy.exhibits.failed}
          {conflict ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (window.confirm(copy.management.reloadConfirm)) window.location.reload();
              }}
            >
              {copy.management.reloadLatest}
            </button>
          ) : null}
        </p>
      ) : null}
    </details>
  );
}
