"use client";

import { useRef, useState } from "react";
import { copy } from "@/i18n/zh-CN";
import { useUploadTasks } from "@/components/upload-task-provider";
import { usePhotoCatalog } from "@/components/use-photo-catalog";
import { useLongPressSelection } from "@/components/use-long-press-selection";
import { usePhotoSelection } from "@/components/use-photo-selection";
import {
  archivePhoto as requestPhotoArchive,
  deletePhoto as requestPhotoDeletion,
  deletePhotos,
  referencesFromPhotoError,
} from "@/client/photo-api";
import type {
  PhotoBatchDeleteResult,
  PhotoDeleteIssue,
  PhotoSource,
  PhotoUsageFilter,
  WorkspacePhotoView,
} from "@/contracts/photo";

export type { WorkspacePhotoView } from "@/contracts/photo";

const PAGE_SIZE = 24;

export function PhotoWorkspace({
  initialPhotos,
  initialSource,
  initialNextCursor,
  stages,
}: {
  initialPhotos: WorkspacePhotoView[];
  initialSource: PhotoSource;
  initialNextCursor: string | null;
  stages: Array<{ id: string; title: string }>;
}) {
  const { startUpload } = useUploadTasks();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    catalogQuery,
    loadFailed,
    loading,
    loadMore,
    memoryQuery,
    nextCursor,
    photos,
    queryKey,
    reportLoadFailure,
    setMemoryQuery,
    setPhotos,
    setSource,
    setStageId,
    setUsageFilter,
    source,
    stageId,
    usageFilter,
  } = usePhotoCatalog({ initialPhotos, initialSource, initialNextCursor, pageSize: PAGE_SIZE });
  const {
    clearSelection,
    removePhotoFromSelection,
    selectAllFilteredPhotos,
    selected,
    selectingAll,
    selectPhoto,
    togglePhoto,
  } = usePhotoSelection(catalogQuery, reportLoadFailure);
  const {
    exitMobileSelectionMode,
    finishPhotoPointer,
    handlePhotoClick,
    handlePhotoPointerDown,
    handlePhotoPointerMove,
    isLastPointerTouch,
    mobileSelectionMode,
  } = useLongPressSelection({ clearSelection, queryKey, selectPhoto, togglePhoto });
  const [archivingPhotoId, setArchivingPhotoId] = useState<string | null>(null);
  const [archiveFailedPhotoId, setArchiveFailedPhotoId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<PhotoDeleteIssue | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDeleteResult, setBatchDeleteResult] = useState<PhotoBatchDeleteResult | null>(null);

  function changeCatalogFilter(update: () => void) {
    setBatchDeleteResult(null);
    update();
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    startUpload(Array.from(files));
    if (inputRef.current) inputRef.current.value = "";
  }

  async function batchDeleteSelectedPhotos() {
    if (batchDeleting || selected.size === 0) return;
    if (!window.confirm(copy.workspace.batchDeleteConfirm(selected.size))) return;
    const ids = [...selected];
    setBatchDeleting(true);
    setBatchDeleteResult(null);
    try {
      const result = await deletePhotos(ids);
      const deleted = new Set(result.deletedIds);
      setPhotos((current) => current.filter((photo) => !deleted.has(photo.id)));
      exitMobileSelectionMode();
      setBatchDeleteResult(result);
    } catch {
      setBatchDeleteResult({
        deletedIds: [],
        failures: ids.map((photoId) => ({
          photoId,
          name: photos.find((photo) => photo.id === photoId)?.name ?? photoId,
          error: "REQUEST_FAILED",
        })),
      });
    } finally {
      setBatchDeleting(false);
    }
  }
  async function archivePhoto(photo: WorkspacePhotoView) {
    if (archivingPhotoId) return;
    setArchivingPhotoId(photo.id);
    setArchiveFailedPhotoId(null);
    try {
      await requestPhotoArchive(photo.id);
      setPhotos((current) =>
        source === "recent"
          ? current.filter((item) => item.id !== photo.id)
          : current.map((item) => (item.id === photo.id ? { ...item, libraryMember: true } : item)),
      );
    } catch {
      setArchiveFailedPhotoId(photo.id);
    } finally {
      setArchivingPhotoId(null);
    }
  }

  async function deletePhoto(photo: WorkspacePhotoView) {
    if (deletingPhotoId) return;
    setDeletingPhotoId(photo.id);
    setDeleteIssue(null);
    try {
      await requestPhotoDeletion(photo.id);
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      removePhotoFromSelection(photo.id);
    } catch (error) {
      setDeleteIssue({ photoId: photo.id, references: referencesFromPhotoError(error) });
    } finally {
      setDeletingPhotoId(null);
    }
  }

  const createHref = `/memories/new?photos=${encodeURIComponent([...selected].join(","))}`;
  return (
    <div className="workspace-panel">
      <div className="upload-bar">
        <label className="button-primary">
          {copy.workspace.upload}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(event) => upload(event.target.files)}
          />
        </label>
        <p>{copy.workspace.uploadHint}</p>
      </div>

      <div className="workspace-source-tabs" aria-label={copy.workspace.sourceLabel}>
        <button
          type="button"
          className={source === "recent" ? "is-active" : ""}
          onClick={() => changeCatalogFilter(() => setSource("recent"))}
        >
          {copy.workspace.recentPhotos}
        </button>
        <button
          type="button"
          className={source === "library" ? "is-active" : ""}
          onClick={() => changeCatalogFilter(() => setSource("library"))}
        >
          {copy.workspace.library}
        </button>
      </div>

      {source === "library" ? (
        <div className="workspace-filters">
          <label>
            <span>{copy.workspace.usageFilter}</span>
            <select
              value={usageFilter}
              onChange={(event) =>
                changeCatalogFilter(() => setUsageFilter(event.target.value as PhotoUsageFilter))
              }
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
              onChange={(event) => changeCatalogFilter(() => setMemoryQuery(event.target.value))}
              placeholder={copy.workspace.memorySearchPlaceholder}
            />
          </label>
          <label>
            <span>{copy.workspace.stageFilter}</span>
            <select
              value={stageId}
              onChange={(event) => changeCatalogFilter(() => setStageId(event.target.value))}
            >
              <option value="">{copy.workspace.stageAll}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {selected.size > 0 || mobileSelectionMode ? (
        <div className="selection-bar" aria-label={copy.workspace.batchActions}>
          <strong>{copy.workspace.selected(selected.size)}</strong>
          <div className="selection-actions">
            {selected.size > 0 ? (
              <a className="button-primary" href={createHref}>
                {copy.workspace.create}
              </a>
            ) : null}
            <button
              type="button"
              className="button-secondary"
              disabled={selectingAll}
              onClick={() => void selectAllFilteredPhotos()}
            >
              {selectingAll ? copy.workspace.selectingAll : copy.workspace.selectAll}
            </button>
            <button type="button" className="text-button" onClick={clearSelection}>
              {copy.workspace.clearSelection}
            </button>
            <button
              type="button"
              className="text-button danger"
              disabled={batchDeleting || selected.size === 0}
              onClick={() => void batchDeleteSelectedPhotos()}
            >
              {batchDeleting ? copy.workspace.batchDeleting : copy.workspace.batchDelete}
            </button>
            {mobileSelectionMode ? (
              <button
                type="button"
                className="button-secondary mobile-selection-done"
                onClick={exitMobileSelectionMode}
              >
                {copy.workspace.finishSelection}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {batchDeleteResult ? (
        <section className="batch-delete-result" role="status">
          <strong>
            {copy.workspace.batchDeleteSummary(
              batchDeleteResult.deletedIds.length,
              batchDeleteResult.failures.length,
            )}
          </strong>
          {batchDeleteResult.failures.length > 0 ? (
            <ul>
              {batchDeleteResult.failures.map((failure) => (
                <li key={failure.photoId}>
                  <span>{failure.name ?? failure.photoId}</span>
                  {failure.references ? (
                    <ul>
                      {failure.references.memories.map((memory) => (
                        <li key={`memory-${failure.photoId}-${memory.id}`}>
                          {copy.workspace.memoryReference(memory.title, memory.isCover)}
                        </li>
                      ))}
                      {failure.references.stages.map((stage) => (
                        <li key={`stage-${failure.photoId}-${stage.id}`}>
                          {copy.workspace.stageReference(stage.title)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <small>{copy.workspace.deleteFailed}</small>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {photos.length === 0 && !loading ? (
        <div className="empty-state">
          {source === "recent" ? copy.workspace.recentEmpty : copy.workspace.libraryEmpty}
        </div>
      ) : (
        <>
          <div className={`photo-grid${mobileSelectionMode ? " is-mobile-selection" : ""}`}>
            {photos.map((photo) => (
              <article
                key={photo.id}
                className={`photo-tile${selected.has(photo.id) ? " is-selected" : ""}`}
                data-photo-id={photo.id}
              >
                <label className="photo-tile-checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(photo.id)}
                    onChange={() => togglePhoto(photo.id)}
                    aria-label={copy.workspace.selectPhotoLabel(photo.name)}
                  />
                </label>
                <button
                  type="button"
                  className="photo-tile-select"
                  onClick={(event) => handlePhotoClick(event, photo.id)}
                  onPointerDown={(event) => handlePhotoPointerDown(event, photo.id)}
                  onPointerMove={handlePhotoPointerMove}
                  onPointerUp={finishPhotoPointer}
                  onPointerCancel={finishPhotoPointer}
                  onContextMenu={(event) => {
                    if (isLastPointerTouch()) event.preventDefault();
                  }}
                  aria-pressed={selected.has(photo.id)}
                >
                  <div className="photo-tile-image">
                    <img src={photo.src} alt={photo.name} loading="lazy" />
                    {photo.libraryMember ? (
                      <span className="photo-library-status">
                        {photo.activeMemoryCount > 0
                          ? copy.workspace.usedBadge
                          : copy.workspace.unusedBadge}
                      </span>
                    ) : null}
                  </div>
                  <span className="photo-tile-name">{photo.name}</span>
                  {photo.hasOriginal ? <small>{copy.workspace.originalKept}</small> : null}
                </button>
                <button
                  type="button"
                  className="photo-tile-delete"
                  disabled={Boolean(deletingPhotoId)}
                  aria-label={copy.workspace.deletePhotoLabel(photo.name)}
                  onClick={() => void deletePhoto(photo)}
                >
                  {deletingPhotoId === photo.id
                    ? copy.workspace.deletingPhoto
                    : copy.workspace.deletePhoto}
                </button>
                {!photo.libraryMember ? (
                  <div className="photo-tile-footer">
                    <button
                      type="button"
                      disabled={Boolean(archivingPhotoId)}
                      onClick={() => void archivePhoto(photo)}
                    >
                      {archivingPhotoId === photo.id
                        ? copy.workspace.archiving
                        : copy.workspace.archive}
                    </button>
                    {archiveFailedPhotoId === photo.id ? (
                      <small role="alert">{copy.workspace.archiveFailed}</small>
                    ) : null}
                  </div>
                ) : null}
                {deleteIssue?.photoId === photo.id ? (
                  <div className="photo-delete-issue" role="alert">
                    <strong>
                      {deleteIssue.references
                        ? copy.workspace.deleteBlocked
                        : copy.workspace.deleteFailed}
                    </strong>
                    {deleteIssue.references ? (
                      <ul>
                        {deleteIssue.references.memories.map((memory) => (
                          <li key={`memory-${memory.id}`}>
                            {copy.workspace.memoryReference(memory.title, memory.isCover)}
                          </li>
                        ))}
                        {deleteIssue.references.stages.map((stage) => (
                          <li key={`stage-${stage.id}`}>
                            {copy.workspace.stageReference(stage.title)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {nextCursor ? (
            <div className="workspace-load-more">
              <button
                type="button"
                className="button-secondary"
                disabled={loading}
                onClick={loadMore}
              >
                {loading ? copy.common.loading : copy.workspace.loadMore}
              </button>
            </div>
          ) : null}
        </>
      )}
      {loadFailed ? <p role="alert">{copy.workspace.loadFailed}</p> : null}
    </div>
  );
}
