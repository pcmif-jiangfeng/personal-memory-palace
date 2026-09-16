"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MemorySummary, Stage } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";

interface EditorPhoto {
  id: string;
  name: string;
  src: string;
}

export function MemoryEditor({ photos, stages, memories }: {
  photos: EditorPhoto[];
  stages: Stage[];
  memories: MemorySummary[];
}) {
  const router = useRouter();
  const [coverPhotoId, setCoverPhotoId] = useState(photos[0]?.id ?? "");
  const [relatedIds, setRelatedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (photos.length === 0) {
    return <div className="empty-state"><p>{copy.editor.noPhotos}</p><Link className="text-link" href="/workspace">{copy.editor.backToWorkspace}</Link></div>;
  }

  function toggleRelated(id: string) {
    setRelatedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          story: form.get("story"),
          stageId: form.get("stageId") || null,
          photoIds: photos.map((photo) => photo.id),
          coverPhotoId,
          relatedMemoryIds: [...relatedIds],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      router.push(`/memories/${result.memory.id}`);
      router.refresh();
    } catch {
      setError(copy.editor.saveFailed);
      setSaving(false);
    }
  }

  return (
    <form className="memory-form" onSubmit={submit}>
      <fieldset>
        <legend>{copy.editor.photos}</legend>
        <p className="field-help">{copy.editor.cover}</p>
        <div className="editor-photo-grid">
          {photos.map((photo) => (
            <label key={photo.id} className={`editor-photo${coverPhotoId === photo.id ? " is-cover" : ""}`}>
              <img src={photo.src} alt={photo.name} />
              <span><input type="radio" name="cover" value={photo.id} checked={coverPhotoId === photo.id}
                onChange={() => setCoverPhotoId(photo.id)} />{copy.editor.cover}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="form-field"><span>{copy.editor.memoryTitle}</span><input name="title" required maxLength={120} /></label>
      <label className="form-field"><span>{copy.editor.story}</span><small>{copy.editor.storyHint}</small>
        <textarea name="story" required rows={10} /></label>
      <label className="form-field"><span>{copy.editor.stage}</span>
        <select name="stageId" defaultValue=""><option value="">{copy.editor.uncategorized}</option>
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select>
        <small><Link href="/stages" target="_blank">{copy.editor.manageStages}</Link> {copy.editor.manageStagesHint}</small>
      </label>
      <fieldset>
        <legend>{copy.editor.related}</legend>
        {memories.length === 0 ? <p className="field-help">{copy.editor.noRelated}</p> : (
          <div className="relation-list">{memories.map((memory) => (
            <label key={memory.id} className="check-row"><input type="checkbox" checked={relatedIds.has(memory.id)}
              onChange={() => toggleRelated(memory.id)} />{memory.title}</label>
          ))}</div>
        )}
      </fieldset>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button-primary" type="submit" disabled={saving}>{saving ? copy.editor.saving : copy.editor.save}</button>
    </form>
  );
}
