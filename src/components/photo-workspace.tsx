"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { copy } from "@/i18n/zh-CN";
import { useUploadTasks } from "@/components/upload-task-provider";
import {
  addPhotoSelection,
  replacePhotoSelection,
  togglePhotoSelection,
} from "@/components/photo-selection";

const PAGE_SIZE = 24;

export interface WorkspacePhotoView {
  id: string;
  name: string;
  src: string;
  hasOriginal: boolean;
  libraryMember: boolean;
  activeMemoryCount: number;
  memoryTitles: string[];
  stageIds: string[];
}

interface PhotoReferences {
  memories: Array<{ id: string; title: string; isCover: boolean }>;
  stages: Array<{ id: string; title: string }>;
}

interface DeleteIssue {
  photoId: string;
  name?: string;
  error?: string;
  references?: PhotoReferences;
}

interface BatchDeleteResult {
  deletedIds: string[];
  failures: Array<DeleteIssue & { error: string }>;
}

type PhotoSource = "recent" | "library";
type UsageFilter = "all" | "used" | "unused";

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
  const initialRequest = useRef(true);
  const selectionModeRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    longPressed: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const lastPointerWasTouchRef = useRef(false);
  const [photos, setPhotos] = useState(initialPhotos);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<PhotoSource>(initialSource);
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [stageId, setStageId] = useState("");
  const [archivingPhotoId, setArchivingPhotoId] = useState<string | null>(null);
  const [archiveFailedPhotoId, setArchiveFailedPhotoId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<DeleteIssue | null>(null);
  const [mobileSelectionMode, setMobileSelectionMode] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDeleteResult, setBatchDeleteResult] = useState<BatchDeleteResult | null>(null);

  const loadPhotos = useCallback(
    async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
      setLoading(true);
      setLoadFailed(false);
      const parameters = new URLSearchParams({ source, limit: String(PAGE_SIZE) });
      if (source === "library") {
        parameters.set("usage", usageFilter);
        if (memoryQuery.trim()) parameters.set("q", memoryQuery.trim());
        if (stageId) parameters.set("stageId", stageId);
      }
      if (cursor) parameters.set("cursor", cursor);
      try {
        const response = await fetch(`/api/photos?${parameters}`, { signal });
        if (!response.ok) {
          setLoadFailed(true);
          return;
        }
        const page = (await response.json()) as {
          items: WorkspacePhotoView[];
          nextCursor: string | null;
        };
        setPhotos((current) => (append ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadFailed(true);
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [memoryQuery, source, stageId, usageFilter],
  );

  useEffect(() => {
    if (initialRequest.current) {
      initialRequest.current = false;
      return;
    }
    const controller = new AbortController();
    setSelected(new Set());
    setBatchDeleteResult(null);
    selectionModeRef.current = false;
    setMobileSelectionMode(false);
    setPhotos([]);
    setNextCursor(null);
    void loadPhotos(null, false, controller.signal);
    return () => controller.abort();
  }, [loadPhotos]);
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  function upload(files: FileList | null) {
    if (!files?.length) return;
    startUpload(Array.from(files));
    if (inputRef.current) inputRef.current.value = "";
  }

  function toggle(id: string) {
    setSelected((current) => togglePhotoSelection(current, id));
  }

  function selectPhoto(id: string) {
    setSelected((current) => addPhotoSelection(current, id));
  }

  function clearLongPress() {
    if (!longPressTimerRef.current) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function exitMobileSelectionMode() {
    clearLongPress();
    touchGestureRef.current = null;
    selectionModeRef.current = false;
    setMobileSelectionMode(false);
    setSelected(new Set());
  }

  function handlePhotoPointerDown(event: ReactPointerEvent<HTMLButtonElement>, photoId: string) {
    lastPointerWasTouchRef.current = event.pointerType === "touch";
    if (event.pointerType !== "touch") return;
    const tile = event.currentTarget;
    const gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      longPressed: selectionModeRef.current,
    };
    touchGestureRef.current = gesture;
    if (selectionModeRef.current) {
      selectPhoto(photoId);
      tile.setPointerCapture(event.pointerId);
      return;
    }
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      if (touchGestureRef.current !== gesture) return;
      gesture.longPressed = true;
      suppressClickRef.current = true;
      selectionModeRef.current = true;
      setMobileSelectionMode(true);
      selectPhoto(photoId);
      tile.setPointerCapture(event.pointerId);
    }, 450);
  }

  function handlePhotoPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.longPressed && !selectionModeRef.current) {
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (distance > 12) clearLongPress();
      return;
    }
    event.preventDefault();
    const tile = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-photo-id]");
    const photoId = tile?.dataset.photoId;
    if (photoId) selectPhoto(photoId);
  }

  function finishPhotoPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    clearLongPress();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    touchGestureRef.current = null;
  }

  function handlePhotoClick(event: ReactMouseEvent<HTMLButtonElement>, photoId: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      return;
    }
    if (event.detail === 0) {
      toggle(photoId);
      return;
    }
    if (lastPointerWasTouchRef.current) {
      if (selectionModeRef.current) selectPhoto(photoId);
      return;
    }
    toggle(photoId);
  }

  async function selectAllFilteredPhotos() {
    if (selectingAll) return;
    setSelectingAll(true);
    const parameters = new URLSearchParams({ source, limit: String(PAGE_SIZE), selection: "ids" });
    if (source === "library") {
      parameters.set("usage", usageFilter);
      if (memoryQuery.trim()) parameters.set("q", memoryQuery.trim());
      if (stageId) parameters.set("stageId", stageId);
    }
    try {
      const response = await fetch(`/api/photos?${parameters}`);
      if (!response.ok) throw new Error("REQUEST_FAILED");
      const result = (await response.json()) as { ids: string[] };
      setSelected(replacePhotoSelection(result.ids));
    } catch {
      setLoadFailed(true);
    } finally {
      setSelectingAll(false);
    }
  }

  async function batchDeleteSelectedPhotos() {
    if (batchDeleting || selected.size === 0) return;
    if (!window.confirm(copy.workspace.batchDeleteConfirm(selected.size))) return;
    const ids = [...selected];
    setBatchDeleting(true);
    setBatchDeleteResult(null);
    try {
      const response = await fetch("/api/photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error("REQUEST_FAILED");
      const payload = (await response.json()) as {
        deletedIds: string[];
        failures: Array<
          DeleteIssue & { error: string; details?: { references?: PhotoReferences } }
        >;
      };
      const result: BatchDeleteResult = {
        deletedIds: payload.deletedIds,
        failures: payload.failures.map(({ details, ...failure }) => ({
          ...failure,
          references: details?.references,
        })),
      };
      const deleted = new Set(result.deletedIds);
      setPhotos((current) => current.filter((photo) => !deleted.has(photo.id)));
      setSelected(new Set());
      setBatchDeleteResult(result);
      selectionModeRef.current = false;
      setMobileSelectionMode(false);
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
      const response = await fetch(`/api/photos/${encodeURIComponent(photo.id)}/archive`, {
        method: "POST",
      });
      if (!response.ok) {
        setArchiveFailedPhotoId(photo.id);
        return;
      }
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
      const response = await fetch(`/api/photos/${encodeURIComponent(photo.id)}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as {
        error?: string;
        details?: { references?: PhotoReferences };
      };
      if (!response.ok) {
        if (response.status === 409 && result.error === "PHOTO_IN_USE") {
          setDeleteIssue({ photoId: photo.id, references: result.details?.references });
          return;
        }
        setDeleteIssue({ photoId: photo.id });
        return;
      }
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
    } catch {
      setDeleteIssue({ photoId: photo.id });
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
          onClick={() => setSource("recent")}
        >
          {copy.workspace.recentPhotos}
        </button>
        <button
          type="button"
          className={source === "library" ? "is-active" : ""}
          onClick={() => setSource("library")}
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
              onChange={(event) => setUsageFilter(event.target.value as UsageFilter)}
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
            <button type="button" className="text-button" onClick={() => setSelected(new Set())}>
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
            <button
              type="button"
              className="button-secondary"
              disabled={selectingAll}
              onClick={() => void selectAllFilteredPhotos()}
            >
              {selectingAll ? copy.workspace.selectingAll : copy.workspace.selectAll}
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
                    onChange={() => toggle(photo.id)}
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
                    if (lastPointerWasTouchRef.current) event.preventDefault();
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
                onClick={() => void loadPhotos(nextCursor, true)}
              >
                {loading ? "加载中…" : copy.workspace.loadMore}
              </button>
            </div>
          ) : null}
        </>
      )}
      {loadFailed ? <p role="alert">{copy.workspace.loadFailed}</p> : null}
    </div>
  );
}
