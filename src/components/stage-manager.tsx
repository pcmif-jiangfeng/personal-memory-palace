"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StageCoverSelector, type StageCoverPhotoOption } from "@/components/stage-cover-selector";
import { StageDeleteAction } from "@/components/stage-delete-action";
import { createStage, updateStage } from "@/client/stage-api";
import type { Stage } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";

export function StageManager({
  stages,
  photos,
}: {
  stages: Stage[];
  photos: StageCoverPhotoOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [newCoverVersion, setNewCoverVersion] = useState(0);

  async function save(event: React.FormEvent<HTMLFormElement>, stageId?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(stageId ?? "new");
    setMessage("");
    try {
      const input = {
        title: String(data.get("title") ?? ""),
        description: String(data.get("description") ?? ""),
        coverPhotoId: String(data.get("coverPhotoId") ?? "") || null,
      };
      if (stageId) await updateStage(stageId, input);
      else await createStage(input);
      if (!stageId) {
        form.reset();
        setNewCoverVersion((current) => current + 1);
      }
      setMessage(copy.stage.saved);
      router.refresh();
    } catch {
      setMessage(copy.editor.saveFailed);
    } finally {
      setBusy(null);
    }
  }

  function fields(stage?: Stage, selectorKey?: string) {
    const currentCover = photos.find((photo) => photo.storageKey === stage?.coverKey)?.id ?? "";
    const currentCoverUnavailable = Boolean(stage?.coverKey) && !currentCover;
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
        <StageCoverSelector
          key={selectorKey}
          photos={photos}
          initialPhotoId={currentCover}
          currentCoverUnavailable={currentCoverUnavailable}
          initiallyExpanded={!stage}
        />
      </>
    );
  }

  return (
    <div className="stage-manager">
      <form className="stage-form stage-form-new" onSubmit={(event) => void save(event)}>
        <h2>{copy.stage.create}</h2>
        {fields(undefined, `new-cover-${newCoverVersion}`)}
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
