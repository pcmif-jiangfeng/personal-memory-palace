"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MemorySummary, Stage } from "@/domain/models";

type TrashType = "memory" | "stage";
type TrashAction = "restore" | "permanent";
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
    if (
      action === "permanent" &&
      !window.confirm(`即将永久删除 ${ids.length} 个 ${title}。永久删除后无法恢复，确定继续吗？`)
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ids, action, confirm: action === "permanent" }),
      });
      const result = (await response.json()) as {
        succeededIds?: string[];
        failures?: Array<{ id: string; error: string }>;
      };
      if (!response.ok) throw new Error("REQUEST_FAILED");
      setSelected(new Set(result.failures?.map((failure) => failure.id) ?? []));
      if (result.failures?.length) setError("部分项目未能处理，请重试。");
      router.refresh();
    } catch {
      setError("批量操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="trash-section">
      <div className="trash-section-heading">
        <h2>{title}</h2>
        {items.length ? <span>已选择 {selected.size} 项</span> : null}
      </div>
      {items.length ? (
        <>
          <div className="trash-batch-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => setSelected(new Set(items.map((item) => item.id)))}
            >
              全选 {title}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy || selected.size === 0}
              onClick={() => void act("restore")}
            >
              批量恢复
            </button>
            <button
              type="button"
              className="text-button danger"
              disabled={busy || selected.size === 0}
              onClick={() => void act("permanent")}
            >
              批量永久删除
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
        <p className="quiet-empty">没有待处理的 {title}。</p>
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
