"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MemoryDetails, MemorySummary, Stage } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";

export function MemoryManagement({ memory, candidates, stages }: {
  memory: MemoryDetails;
  candidates: MemorySummary[];
  stages: Stage[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(memory.title);
  const [story, setStory] = useState(memory.story);
  const [stageId, setStageId] = useState(memory.stageId ?? "");
  const [note, setNote] = useState("");
  const [related, setRelated] = useState<string[]>(memory.relatedMemories?.map((item) => item.id) ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function send(body: unknown, successMessage = ""): Promise<boolean> {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/memories/${memory.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("REQUEST_FAILED");
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

  return <div className="memory-management">
    <details className="relation-editor memory-details-editor" open>
      <summary>{copy.management.editDetails}</summary>
      <form className="memory-details-form" onSubmit={(event) => {
        event.preventDefault();
        void send({
          action: "details",
          title,
          story,
          stageId: stageId || null,
        }, copy.management.saved);
      }}>
        <label className="form-field">
          <span>{copy.editor.memoryTitle}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} />
        </label>
        <label className="form-field">
          <span>{copy.management.originalStory}</span>
          <textarea value={story} onChange={(event) => setStory(event.target.value)} required rows={8} />
        </label>
        <label className="form-field">
          <span>{copy.editor.stage}</span>
          <select value={stageId} onChange={(event) => setStageId(event.target.value)}>
            <option value="">{copy.editor.uncategorized}</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
          </select>
          <small><Link href="/stages" target="_blank">{copy.management.manageStages}</Link> {copy.management.manageStagesHint}</small>
        </label>
        <button className="button-secondary" type="submit" disabled={busy}>
          {busy ? copy.management.saving : copy.management.saveDetails}
        </button>
      </form>
    </details>

    {message ? <p className="memory-management-message" role="status">{message}</p> : null}
    {error ? <p className="form-error memory-management-message" role="alert">{error}</p> : null}

    <form onSubmit={(event) => {
      event.preventDefault();
      void (async () => {
        if (await send({ action: "note", content: note })) setNote("");
      })();
    }}>
      <label className="form-field"><span>追加 Later Note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="给未来的自己留一句话…" /></label>
      <button className="button-secondary" disabled={busy || !note.trim()}>保存注记</button>
    </form>
    <details className="relation-editor"><summary>编辑相关记忆</summary>
      <div className="relation-list">{candidates.filter((item) => item.id !== memory.id).map((item) => <label className="check-row" key={item.id}><input type="checkbox" checked={related.includes(item.id)} onChange={() => setRelated((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])} />{item.title}</label>)}</div>
      <button className="button-secondary" disabled={busy} onClick={() => void send({ action: "relations", relatedMemoryIds: related })}>保存关联</button>
    </details>
    <button className="text-button danger" disabled={busy} onClick={() => {
      if (window.confirm("将这段 Memory 移入回收站？")) void send({ action: "trash" });
    }}>移入回收站</button>
  </div>;
}
