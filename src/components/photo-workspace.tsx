"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/i18n/zh-CN";

export interface WorkspacePhotoView {
  id: string;
  name: string;
  src: string;
  hasOriginal: boolean;
}

export function PhotoWorkspace({ initialPhotos }: { initialPhotos: WorkspacePhotoView[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState(initialPhotos);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preserveOriginal, setPreserveOriginal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("photos", file));
    formData.set("preserveOriginal", String(preserveOriginal));
    try {
      const response = await fetch("/api/photos", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const uploaded: WorkspacePhotoView[] = result.photos.map(
        (photo: {
          id: string;
          originalName: string;
          optimizedStorageKey: string;
          originalStorageKey: string | null;
        }) => ({
          id: photo.id,
          name: photo.originalName,
          src: `/media/${photo.optimizedStorageKey}`,
          hasOriginal: Boolean(photo.originalStorageKey),
        }),
      );
      setPhotos((current) => [...uploaded, ...current]);
      setSelected(new Set(uploaded.map((photo) => photo.id)));
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setError(copy.workspace.invalid);
    } finally {
      setUploading(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const createHref = `/memories/new?photos=${encodeURIComponent([...selected].join(","))}`;
  return (
    <div className="workspace-panel">
      <div className="upload-bar">
        <label className="button-primary">
          {uploading ? copy.workspace.uploading : copy.workspace.upload}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(event) => void upload(event.target.files)}
          />
        </label>
        <div>
          <p>{copy.workspace.uploadHint}</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={preserveOriginal}
              onChange={(event) => setPreserveOriginal(event.target.checked)}
            />
            {copy.workspace.preserveOriginal}
          </label>
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
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
            <button
              key={photo.id}
              type="button"
              className={`photo-tile${selected.has(photo.id) ? " is-selected" : ""}`}
              onClick={() => toggle(photo.id)}
              aria-pressed={selected.has(photo.id)}
            >
              <img src={photo.src} alt={photo.name} />
              <span>{photo.name}</span>
              {photo.hasOriginal ? <small>{copy.workspace.originalKept}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
