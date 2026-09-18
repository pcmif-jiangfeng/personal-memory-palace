"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/i18n/zh-CN";

type RecallStatus = "idle" | "spinning" | "empty" | "error";

export function TimeGear() {
  const router = useRouter();
  const feedbackId = useId();
  const requestInFlight = useRef(false);
  const [status, setStatus] = useState<RecallStatus>("idle");
  const busy = status === "spinning";

  async function recall() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setStatus("spinning");
    try {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const ritualDelay = reduceMotion
        ? Promise.resolve()
        : new Promise<void>((resolve) => window.setTimeout(resolve, 650));
      const [response] = await Promise.all([
        fetch("/api/recall", { cache: "no-store" }),
        ritualDelay,
      ]);
      if (!response.ok) throw new Error("RECALL_FAILED");
      const result = (await response.json()) as { memory: { id: string } | null };
      if (result.memory?.id) {
        router.push(`/memories/${encodeURIComponent(result.memory.id)}`);
        return;
      }
      setStatus("empty");
    } catch {
      setStatus("error");
    } finally {
      requestInFlight.current = false;
    }
  }

  return (
    <div className="time-gear-experience">
      <button
        className={`time-gear${busy ? " is-spinning" : ""}`}
        onClick={() => void recall()}
        disabled={busy}
        aria-label={copy.recall.button}
        aria-describedby={status === "empty" || status === "error" ? feedbackId : undefined}
      >
        <span className="time-gear-ring" aria-hidden="true">
          ✦
        </span>
        <span>{busy ? copy.recall.spinning : copy.recall.button}</span>
      </button>
      {status === "empty" ? (
        <div id={feedbackId} className="time-gear-feedback" role="status">
          <strong>{copy.recall.emptyTitle}</strong>
          <p>{copy.recall.emptyDescription}</p>
          <Link href="/memories/new">{copy.recall.createFirst}</Link>
        </div>
      ) : null}
      {status === "error" ? (
        <p id={feedbackId} className="time-gear-feedback time-gear-error" role="alert">
          {copy.recall.failed}
        </p>
      ) : null}
    </div>
  );
}
