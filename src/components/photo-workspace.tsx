"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/i18n/zh-CN";
import { useUploadTasks } from "@/components/upload-task-provider";

export interface WorkspacePhotoView {
  id: string;
  name: string;
  src: string;
  hasOriginal: boolean;
}

interface PhotoReferences {
  memories: Array<{ id: string; title: string; isCover: boolean }>;
  stages: Array<{ id: string; title: string }>;
}

interface DeleteIssue {
  photoId: string;
  references?: PhotoReferences;
}

export function PhotoWorkspace({ initialPhotos }: { initialPhotos: WorkspacePhotoView[] }) {
  const router = useRouter();
  const { startUpload } = useUploadTasks();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hiddenPhotoIds, setHiddenPhotoIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [deleteIssue, setDeleteIssue] = useState<DeleteIssue | null>(null);

  const photos = initialPhotos.filter((photo) => !hiddenPhotoIds.has(photo.id));

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
      <div className="selection-bar">
        <strong>{copy.workspace.selected(selected.size)}</strong>
        {selected.size > 0 ? (
          <a className="button-primary" href={createHref}>
            {copy.workspace.create}
          </a>
        ) : null}
      </div>
      {photos.length === 0 ? (
        <div className="empty-state">{copy.workspace.empty}</div>
      ) : (
        <div className="photo-grid">
          {photos.map((photo) => (
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
                <img src={photo.src} alt={photo.name} />
                <span>{photo.name}</span>
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
      )}
    </div>
  );
}
