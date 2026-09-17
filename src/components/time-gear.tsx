"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TimeGear() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function recall() {
    setBusy(true);
    const response = await fetch("/api/recall", { cache: "no-store" });
    const result = (await response.json()) as { memory?: { id: string } };
    if (result.memory) router.push(`/memories/${result.memory.id}`);
    else setBusy(false);
  }
  return (
    <button
      className={`time-gear${busy ? " is-spinning" : ""}`}
      onClick={() => void recall()}
      disabled={busy}
      aria-label="随机回忆"
    >
      <span className="time-gear-ring" aria-hidden="true">
        ✦
      </span>
      <span>{busy ? "正在翻阅…" : "随机回忆"}</span>
    </button>
  );
}
