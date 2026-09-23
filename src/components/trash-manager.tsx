"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyTrashAction, type TrashAction, type TrashType } from "@/client/trash-api";
import type { MemorySummary, Stage } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";

type TrashItem = { id: string; title: string };

function TrashSelectionSection({
  type,
  title,
  items,
}: {
  type: TrashType;
  title: string;
  items: TrashItem[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function act(action: TrashAction) {
    if (busy || selected.size === 0) return;
    const ids = [...selected];
    if (action === "permanent" && !window.confirm(copy.trash.confirmPermanent(ids.length, title))) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await applyTrashAction(type, ids, action);
      setSelected(new Set(result.failures.map((failure) => failure.id)));
      if (result.failures.length) setError(copy.trash.partialFailure);
      router.refresh();
    } catch {
      setError(copy.trash.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="trash-section">
      <div className="trash-section-heading">
        <h2>{title}</h2>
        {items.length ? <span>{copy.trash.selected(selected.size)}</span> : null}
      </div>
      {items.length ? (
        <>
          <div className="trash-batch-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => setSelected(new Set(items.map((item) => item.id)))}
            >
              {copy.trash.selectAll(title)}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              {copy.trash.clear}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy || selected.size === 0}
              onClick={() => void act("restore")}
            >
              {copy.trash.restore}
            </button>
            <button
              type="button"
              className="text-button danger"
              disabled={busy || selected.size === 0}
              onClick={() => void act("permanent")}
            >
              {copy.trash.deletePermanently}
            </button>
          </div>
          {items.map((item) => (
            <label className="trash-row" key={item.id}>
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
              />
              <span>{item.title}</span>
            </label>
          ))}
        </>
      ) : (
        <p className="quiet-empty">{copy.trash.empty(title)}</p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function TrashManager({ memories, stages }: { memories: MemorySummary[]; stages: Stage[] }) {
  return (
    <div className="trash-list">
      <TrashSelectionSection type="memory" title="Memory" items={memories} />
      <TrashSelectionSection type="stage" title="Stage" items={stages} />
    </div>
  );
}
