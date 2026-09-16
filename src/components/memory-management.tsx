"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MemoryDetails, MemorySummary } from "@/domain/models";

export function MemoryManagement({ memory, candidates }: { memory: MemoryDetails; candidates: MemorySummary[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [related, setRelated] = useState<string[]>(memory.relatedMemories?.map((item) => item.id) ?? []);
  const [busy, setBusy] = useState(false);
  async function send(body: unknown) {
    setBusy(true);
    const response = await fetch(`/api/memories/${memory.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (response.ok) { setNote(""); router.refresh(); }
  }
  return <div className="memory-management">
    <form onSubmit={(event) => { event.preventDefault(); void send({ action: "note", content: note }); }}>
      <label className="form-field"><span>追加 Later Note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="给未来的自己留一句话…" /></label>
      <button className="button-secondary" disabled={busy || !note.trim()}>保存注记</button>
    </form>
    <details className="relation-editor"><summary>编辑相关记忆</summary>
      <div className="relation-list">{candidates.filter((item) => item.id !== memory.id).map((item) => <label className="check-row" key={item.id}><input type="checkbox" checked={related.includes(item.id)} onChange={() => setRelated((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])} />{item.title}</label>)}</div>
      <button className="button-secondary" disabled={busy} onClick={() => void send({ action: "relations", relatedMemoryIds: related })}>保存关联</button>
    </details>
    <button className="text-button danger" disabled={busy} onClick={() => { if (window.confirm("将这段 Memory 移入回收站？")) void send({ action: "trash" }); }}>移入回收站</button>
  </div>;
}
