"use client";

import { useRouter } from "next/navigation";
import type { MemorySummary, Stage } from "@/domain/models";

export function TrashManager({ memories, stages }: { memories: MemorySummary[]; stages: Stage[] }) {
  const router = useRouter();
  async function act(type: "memory" | "stage", id: string, action: "restore" | "permanent") {
    if (action === "permanent" && !window.confirm("永久删除后无法恢复，确定继续吗？")) return;
    await fetch("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id, action, confirm: action === "permanent" }),
    });
    router.refresh();
  }
  return (
    <div className="trash-list">
      <section>
        <h2>Memory</h2>
        {memories.length ? (
          memories.map((item) => (
            <div className="trash-row" key={item.id}>
              <span>{item.title}</span>
              <span>
                <button
                  className="text-button"
                  onClick={() => void act("memory", item.id, "restore")}
                >
                  恢复
                </button>
                <button
                  className="text-button danger"
                  onClick={() => void act("memory", item.id, "permanent")}
                >
                  永久删除
                </button>
              </span>
            </div>
          ))
        ) : (
          <p className="quiet-empty">没有待处理的 Memory。</p>
        )}
      </section>
      <section>
        <h2>Stage</h2>
        {stages.length ? (
          stages.map((item) => (
            <div className="trash-row" key={item.id}>
              <span>{item.title}</span>
              <span>
                <button
                  className="text-button"
                  onClick={() => void act("stage", item.id, "restore")}
                >
                  恢复
                </button>
                <button
                  className="text-button danger"
                  onClick={() => void act("stage", item.id, "permanent")}
                >
                  永久删除
                </button>
              </span>
            </div>
          ))
        ) : (
          <p className="quiet-empty">没有待处理的 Stage。</p>
        )}
      </section>
    </div>
  );
}
