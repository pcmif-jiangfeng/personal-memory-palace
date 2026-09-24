"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addMemoryNote,
  setMemoryPublic,
  trashMemory,
  updateMemoryDetails,
  updateMemoryRelations,
} from "@/client/memory-api";
import type { WorkspacePhotoView } from "@/contracts/photo";
import type { MemoryDetails, MemorySummary, Stage } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";
import { MemoryExhibitManager, type ExhibitPhotoView } from "@/components/memory-exhibit-manager";

export function MemoryManagement({
  memory,
  candidates,
  stages,
  exhibits,
  libraryPhotos,
  libraryNextCursor,
}: {
  memory: MemoryDetails;
  candidates: MemorySummary[];
  stages: Stage[];
  exhibits: ExhibitPhotoView[];
  libraryPhotos: WorkspacePhotoView[];
  libraryNextCursor: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(memory.title);
  const [story, setStory] = useState(memory.story);
  const [stageId, setStageId] = useState(memory.stageId ?? "");
  const [note, setNote] = useState("");
  const [related, setRelated] = useState<string[]>(
    memory.relatedMemories?.map((item) => item.id) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function send(request: () => Promise<void>, successMessage = ""): Promise<boolean> {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await request();
      setMessage(successMessage);
      router.refresh();
      return true;
    } catch {
      setError(copy.management.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="memory-management">
      <section className="publication-control">
        <h3>访客可见范围</h3>
        <p>{memory.isPublic ? copy.publication.public : copy.publication.private}</p>
        <p className="field-help">{copy.publication.memoryHint}</p>
        {memory.stageId &&
        stages.find((stage) => stage.id === memory.stageId)?.isPublic === false ? (
          <p className="field-help">所属章节目前对访客隐藏，因此这段记忆也不会显示。</p>
        ) : null}
        <button
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void send(() => setMemoryPublic(memory.id, !memory.isPublic), copy.publication.saved)
          }
        >
          {memory.isPublic ? copy.publication.hide : copy.publication.publish}
        </button>
      </section>
      <details className="relation-editor memory-details-editor" open>
        <summary>{copy.management.editDetails}</summary>
        <form
          className="memory-details-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send(
              () => updateMemoryDetails(memory.id, { title, story, stageId: stageId || null }),
              copy.management.saved,
            );
          }}
        >
          <label className="form-field">
            <span>{copy.editor.memoryTitle}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label className="form-field">
            <span>{copy.management.originalStory}</span>
            <textarea
              value={story}
              onChange={(event) => setStory(event.target.value)}
              required
              rows={8}
            />
          </label>
          <label className="form-field">
            <span>{copy.editor.stage}</span>
            <select value={stageId} onChange={(event) => setStageId(event.target.value)}>
              <option value="">{copy.editor.uncategorized}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.title}
                </option>
              ))}
            </select>
            <small>
              <Link href="/stages" target="_blank">
                {copy.management.manageStages}
              </Link>{" "}
              {copy.management.manageStagesHint}
            </small>
          </label>
          <button className="button-secondary" type="submit" disabled={busy}>
            {busy ? copy.management.saving : copy.management.saveDetails}
          </button>
        </form>
      </details>

      <MemoryExhibitManager
        key={`${memory.id}-${memory.updatedAt}`}
        memoryId={memory.id}
        exhibits={exhibits}
        libraryPhotos={libraryPhotos}
        initialNextCursor={libraryNextCursor}
        stages={stages.map((stage) => ({ id: stage.id, title: stage.title }))}
      />

      {message ? (
        <p className="memory-management-message" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-error memory-management-message" role="alert">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            if (await send(() => addMemoryNote(memory.id, note))) setNote("");
          })();
        }}
      >
        <label className="form-field">
          <span>{copy.management.laterNote}</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            placeholder={copy.management.laterNotePlaceholder}
          />
        </label>
        <button className="button-secondary" disabled={busy || !note.trim()}>
          {copy.management.saveNote}
        </button>
      </form>
      <details className="relation-editor">
        <summary>{copy.management.editRelations}</summary>
        <div className="relation-list">
          {candidates
            .filter((item) => item.id !== memory.id)
            .map((item) => (
              <label className="check-row" key={item.id}>
                <input
                  type="checkbox"
                  checked={related.includes(item.id)}
                  onChange={() =>
                    setRelated((items) =>
                      items.includes(item.id)
                        ? items.filter((id) => id !== item.id)
                        : [...items, item.id],
                    )
                  }
                />
                {item.title}
              </label>
            ))}
        </div>
        <button
          className="button-secondary"
          disabled={busy}
          onClick={() => void send(() => updateMemoryRelations(memory.id, related))}
        >
          {copy.management.saveRelations}
        </button>
      </details>
      <button
        className="text-button danger"
        disabled={busy}
        onClick={() => {
          if (window.confirm(copy.management.trashConfirm)) void send(() => trashMemory(memory.id));
        }}
      >
        {copy.management.trash}
      </button>
    </div>
  );
}
