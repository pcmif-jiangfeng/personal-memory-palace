"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUploadTasks } from "@/components/upload-task-provider";
import { usePhotoCatalog } from "@/components/use-photo-catalog";
import type { PhotoUsageFilter, WorkspacePhotoView } from "@/contracts/photo";
import { copy } from "@/i18n/zh-CN";

const PAGE_SIZE = 24;
const MAX_PHOTOS = 20;

export interface ExhibitPhotoView {
  photoId: string;
  name: string;
  src: string;
  isCover: boolean;
  exhibitTitle: string;
  exhibitDescription: string;
}

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

  const initialSelected = exhibits.find((photo) => photo.isCover) ?? exhibits[0];
  const [selectedPhotoId, setSelectedPhotoId] = useState(initialSelected?.photoId ?? "");
  const [draftTitle, setDraftTitle] = useState(initialSelected?.exhibitTitle ?? "");
  const [draftDescription, setDraftDescription] = useState(
    initialSelected?.exhibitDescription ?? "",
  );
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [librarySelection, setLibrarySelection] = useState<Set<string>>(new Set());
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
  const selected = exhibits.find((photo) => photo.photoId === selectedPhotoId) ?? exhibits[0];
  const remainingSlots = Math.max(0, MAX_PHOTOS - exhibits.length);
  const filteredLibrary = availableLibraryPhotos.filter((photo) => !currentPhotoIds.has(photo.id));

  async function request(body: unknown): Promise<void> {
    const response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("REQUEST_FAILED");
  }

  async function perform(body: unknown, successMessage: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await request(body);
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

  function loadMetadataDraft(photo: ExhibitPhotoView | undefined) {
    setDraftTitle(photo?.exhibitTitle ?? "");
    setDraftDescription(photo?.exhibitDescription ?? "");
    setMetadataDirty(false);
  }

  function selectExhibit(photo: ExhibitPhotoView) {
    if (photo.photoId === selected?.photoId) return;
    if (metadataDirty && !window.confirm(copy.exhibits.discardUnsaved)) return;
    setSelectedPhotoId(photo.photoId);
    loadMetadataDraft(photo);
    setMessage("");
    setError("");
  }

  async function moveSelected(direction: -1 | 1) {
    if (!selected) return;
    const index = exhibits.findIndex((photo) => photo.photoId === selected.photoId);
    const target = index + direction;
    if (target < 0 || target >= exhibits.length) return;
    const ordered = exhibits.map((photo) => photo.photoId);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await perform({ action: "reorderPhotos", photoIds: ordered }, copy.exhibits.orderSaved);
  }

  async function removeSelected() {
    if (!selected) return;
    const confirmation = selected.isCover
      ? copy.exhibits.removeCoverConfirm(selected.name)
      : copy.exhibits.removeConfirm(selected.name);
    if (!window.confirm(confirmation)) return;
    const index = exhibits.findIndex((photo) => photo.photoId === selected.photoId);
    const fallback = exhibits[index + 1] ?? exhibits[index - 1];
    if (
      await perform({ action: "removePhoto", photoId: selected.photoId }, copy.exhibits.removed)
    ) {
      setSelectedPhotoId(fallback?.photoId ?? "");
      loadMetadataDraft(fallback);
    }
  }

  async function saveMetadata() {
    if (!selected) return;
    if (
      await perform(
        {
          action: "exhibitMetadata",
          photoId: selected.photoId,
          title: draftTitle,
          description: draftDescription,
        },
        copy.exhibits.metadataSaved,
      )
    ) {
      setMetadataDirty(false);
    }
  }

  function toggleLibraryPhoto(photoId: string) {
    setLibrarySelection((current) => {
      const next = new Set(current);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else if (next.size < remainingSlots) {
        next.add(photoId);
      }
      return next;
    });
  }

  async function addSelectedLibraryPhotos() {
    if (librarySelection.size === 0) return;
    if (
      await perform(
        { action: "addPhotos", photoIds: [...librarySelection] },
        copy.exhibits.photosAdded,
      )
    ) {
      setLibrarySelection(new Set());
    }
  }

  function upload(files: FileList | null) {
    if (!files?.length || remainingSlots === 0) return;
    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (files.length > remainingSlots) setError(copy.exhibits.uploadLimit(remainingSlots));
    startUpload(selectedFiles, {
      onPhotoUploaded: async (photoId) => {
        await request({ action: "addPhotos", photoIds: [photoId] });
        router.refresh();
      },
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <details className="relation-editor memory-exhibit-manager" open>
      <summary>{copy.exhibits.title}</summary>
      <p className="field-help">{copy.exhibits.description}</p>

      {exhibits.length === 0 ? (
        <p className="quiet-empty">{copy.exhibits.empty}</p>
      ) : (
        <>
          <div className="memory-exhibit-strip" aria-label={copy.exhibits.currentPhotos}>
            {exhibits.map((photo, index) => (
              <button
                type="button"
                key={photo.photoId}
                className={photo.photoId === selected?.photoId ? "is-selected" : ""}
                aria-pressed={photo.photoId === selected?.photoId}
                onClick={() => selectExhibit(photo)}
              >
                <img src={photo.src} alt={photo.name} />
                <span>{index + 1}</span>
                {photo.isCover ? <strong>{copy.exhibits.coverBadge}</strong> : null}
              </button>
            ))}
          </div>

          {selected ? (
            <section className="memory-exhibit-inspector">
              <img src={selected.src} alt={selected.name} />
              <div>
                <p>{selected.name}</p>
                <div className="memory-exhibit-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy || selected.isCover}
                    onClick={() =>
                      void perform(
                        { action: "setCover", photoId: selected.photoId },
                        copy.exhibits.coverSaved,
                      )
                    }
                  >
                    {selected.isCover ? copy.exhibits.currentCover : copy.exhibits.setCover}
                  </button>
                  <button
                    type="button"
                    disabled={busy || exhibits[0]?.photoId === selected.photoId}
                    onClick={() => void moveSelected(-1)}
                  >
                    {copy.exhibits.moveEarlier}
                  </button>
                  <button
                    type="button"
                    disabled={busy || exhibits.at(-1)?.photoId === selected.photoId}
                    onClick={() => void moveSelected(1)}
                  >
                    {copy.exhibits.moveLater}
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => void removeSelected()}
                  >
                    {copy.exhibits.remove}
                  </button>
                </div>
                <form
                  className="memory-exhibit-metadata"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveMetadata();
                  }}
                >
                  <label className="form-field">
                    <span>{copy.exhibits.exhibitTitle}</span>
                    <input
                      name="exhibitTitle"
                      value={draftTitle}
                      onChange={(event) => {
                        setDraftTitle(event.target.value);
                        setMetadataDirty(true);
                      }}
                      maxLength={120}
                    />
                  </label>
                  <label className="form-field">
                    <span>{copy.exhibits.exhibitDescription}</span>
                    <textarea
                      name="exhibitDescription"
                      value={draftDescription}
                      onChange={(event) => {
                        setDraftDescription(event.target.value);
                        setMetadataDirty(true);
                      }}
                      maxLength={2000}
                      rows={4}
                    />
                  </label>
                  <button className="button-secondary" type="submit" disabled={busy}>
                    {copy.exhibits.saveMetadata}
                  </button>
                </form>
              </div>
            </section>
          ) : null}
        </>
      )}

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
                      <img src={photo.src} alt={photo.name} loading="lazy" />
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
