"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StageDeleteAction } from "@/components/stage-delete-action";
import type { Stage } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";

interface CoverPhotoOption {
  id: string;
  name: string;
  src: string;
  storageKey: string;
}

export function StageManager({ stages, photos }: { stages: Stage[]; photos: CoverPhotoOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>, stageId?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(stageId ?? "new");
    setMessage("");
    const response = await fetch(stageId ? `/api/stages/${stageId}` : "/api/stages", {
      method: stageId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.get("title"),
        description: data.get("description"),
        coverPhotoId: data.get("coverPhotoId") || null,
      }),
    });
    if (response.ok) {
      if (!stageId) form.reset();
      setMessage(copy.stage.saved);
      router.refresh();
    } else {
      setMessage(copy.editor.saveFailed);
    }
    setBusy(null);
  }

  function fields(stage?: Stage) {
    const currentCover = photos.find((photo) => photo.storageKey === stage?.coverKey)?.id ?? "";
    return (
      <>
        <label className="form-field">
          <span>{copy.stage.name}</span>
          <input name="title" required maxLength={80} defaultValue={stage?.title ?? ""} />
        </label>
        <label className="form-field">
          <span>{copy.stage.description}</span>
          <textarea name="description" rows={3} defaultValue={stage?.description ?? ""} />
        </label>
        <label className="form-field">
          <span>{copy.stage.cover}</span>
          <select name="coverPhotoId" defaultValue={currentCover}>
            <option value="">{copy.stage.noCover}</option>
            {photos.map((photo) => (
              <option key={photo.id} value={photo.id}>
                {photo.name}
              </option>
            ))}
          </select>
          <small>{copy.stage.coverHint}</small>
        </label>
      </>
    );
  }

  return (
    <div className="stage-manager">
      <form className="stage-form stage-form-new" onSubmit={(event) => void save(event)}>
        <h2>{copy.stage.create}</h2>
        {fields()}
        <button className="button-primary" disabled={busy === "new"}>
          {copy.stage.create}
        </button>
      </form>
      <div className="stage-edit-list">
        {stages.map((stage) => (
          <form
            key={stage.id}
            id={`stage-${stage.id}`}
            className="stage-form"
            onSubmit={(event) => void save(event, stage.id)}
          >
            <h2>{stage.title}</h2>
            {fields(stage)}
            <div className="stage-form-actions">
              <button className="button-secondary" disabled={busy === stage.id}>
                {copy.stage.save}
              </button>
              <StageDeleteAction stageId={stage.id} stageTitle={stage.title} />
            </div>
          </form>
        ))}
      </div>
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
