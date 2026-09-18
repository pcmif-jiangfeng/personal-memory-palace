"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/i18n/zh-CN";
import { useUploadTasks } from "@/components/upload-task-provider";

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
  references?: PhotoReferences;
}

type PhotoSource = "recent" | "library";
type UsageFilter = "all" | "used" | "unused";

export function PhotoWorkspace({
  initialPhotos,
  stages,
}: {
  initialPhotos: WorkspacePhotoView[];
  stages: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const { startUpload } = useUploadTasks();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hiddenPhotoIds, setHiddenPhotoIds] = useState<Set<string>>(new Set());
  const [archivedPhotoIds, setArchivedPhotoIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<PhotoSource>(() =>
    initialPhotos.some((photo) => !photo.libraryMember) ? "recent" : "library",
  );
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [stageId, setStageId] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [archivingPhotoId, setArchivingPhotoId] = useState<string | null>(null);
  const [archiveFailedPhotoId, setArchiveFailedPhotoId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<DeleteIssue | null>(null);

  const photos = initialPhotos
    .filter((photo) => !hiddenPhotoIds.has(photo.id))
    .map((photo) => (archivedPhotoIds.has(photo.id) ? { ...photo, libraryMember: true } : photo));
  const recentPhotos = photos.filter((photo) => !photo.libraryMember);
  const libraryPhotos = photos.filter((photo) => photo.libraryMember);
  const normalizedQuery = memoryQuery.trim().toLocaleLowerCase();
  const filteredPhotos = (source === "recent" ? recentPhotos : libraryPhotos).filter((photo) => {
    if (source === "recent") return true;
    const currentlyUsed = photo.activeMemoryCount > 0;
    const matchesUsage =
      usageFilter === "all" ||
      (usageFilter === "used" && currentlyUsed) ||
      (usageFilter === "unused" && !currentlyUsed);
    const matchesMemory =
      !normalizedQuery ||
      photo.memoryTitles.some((title) => title.toLocaleLowerCase().includes(normalizedQuery));
    const matchesStage = !stageId || photo.stageIds.includes(stageId);
    return matchesUsage && matchesMemory && matchesStage;
  });
  const visiblePhotos = filteredPhotos.slice(0, visibleCount);

  function resetVisibleCount() {
    setVisibleCount(PAGE_SIZE);
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    startUpload(Array.from(files));
    if (inputRef.current) inputRef.current.value = "";
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      setArchivedPhotoIds((current) => new Set(current).add(photo.id));
      router.refresh();
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
      setHiddenPhotoIds((current) => new Set(current).add(photo.id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
      router.refresh();
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
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => upload(event.target.files)}
          />
        </label>
        <p>{copy.workspace.uploadHint}</p>
      </div>

      <div className="workspace-source-tabs" aria-label={copy.workspace.sourceLabel}>
        <button
          type="button"
          className={source === "recent" ? "is-active" : ""}
          onClick={() => {
            setSource("recent");
            resetVisibleCount();
          }}
        >
          {copy.workspace.recentPhotos} <span>{recentPhotos.length}</span>
        </button>
        <button
          type="button"
          className={source === "library" ? "is-active" : ""}
          onClick={() => {
            setSource("library");
            resetVisibleCount();
          }}
        >
          {copy.workspace.library} <span>{libraryPhotos.length}</span>
        </button>
      </div>

      {source === "library" ? (
        <div className="workspace-filters">
          <label>
            <span>{copy.workspace.usageFilter}</span>
            <select
              value={usageFilter}
              onChange={(event) => {
                setUsageFilter(event.target.value as UsageFilter);
                resetVisibleCount();
              }}
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
              onChange={(event) => {
                setMemoryQuery(event.target.value);
                resetVisibleCount();
              }}
              placeholder={copy.workspace.memorySearchPlaceholder}
            />
          </label>
          <label>
            <span>{copy.workspace.stageFilter}</span>
            <select
              value={stageId}
              onChange={(event) => {
                setStageId(event.target.value);
                resetVisibleCount();
              }}
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

      <div className="selection-bar">
        <strong>{copy.workspace.selected(selected.size)}</strong>
        {selected.size > 0 ? (
          <a className="button-primary" href={createHref}>
            {copy.workspace.create}
          </a>
        ) : null}
      </div>

      {filteredPhotos.length === 0 ? (
        <div className="empty-state">
          {source === "recent" ? copy.workspace.recentEmpty : copy.workspace.libraryEmpty}
        </div>
      ) : (
        <>
          <div className="photo-grid">
            {visiblePhotos.map((photo) => (
              <article
                key={photo.id}
                className={`photo-tile${selected.has(photo.id) ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="photo-tile-select"
                  onClick={() => toggle(photo.id)}
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
          {visiblePhotos.length < filteredPhotos.length ? (
            <div className="workspace-load-more">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                {copy.workspace.loadMore}
              </button>
              <span>{copy.workspace.shownCount(visiblePhotos.length, filteredPhotos.length)}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
