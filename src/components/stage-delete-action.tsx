"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { copy } from "@/i18n/zh-CN";

interface StageDeleteActionProps {
  stageId: string;
  stageTitle: string;
  mode?: "button" | "menu";
  redirectTo?: string;
}

export function StageDeleteAction({
  stageId,
  stageTitle,
  mode = "button",
  redirectTo,
}: StageDeleteActionProps) {
  const router = useRouter();
  const deletingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function deleteStage() {
    if (deletingRef.current || !window.confirm(copy.stage.deleteConfirm(stageTitle))) return;
    deletingRef.current = true;
    setBusy(true);
    setError("");
    let deleted = false;
    try {
      const response = await fetch("/api/stages/" + stageId, { method: "DELETE" });
      if (!response.ok) {
        setError(copy.stage.deleteFailed);
        return;
      }
      deleted = true;
      if (redirectTo) {
        router.replace(redirectTo);
      } else {
        router.refresh();
      }
    } catch {
      setError(copy.stage.deleteFailed);
    } finally {
      if (!deleted) {
        deletingRef.current = false;
        setBusy(false);
      }
    }
  }

  if (mode === "menu") {
    return (
      <div className="stage-card-menu">
        <details>
          <summary aria-label={copy.stage.openActions}>···</summary>
          <div className="stage-card-menu-panel">
            <Link href={"/stages#stage-" + stageId}>{copy.stage.editAction}</Link>
            <button type="button" disabled={busy} onClick={() => void deleteStage()}>
              {busy ? copy.stage.deleting : copy.stage.deleteAction}
            </button>
          </div>
        </details>
        {error ? (
          <span className="stage-delete-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stage-delete-action">
      <button
        type="button"
        className="text-button danger"
        disabled={busy}
        onClick={() => void deleteStage()}
      >
        {busy ? copy.stage.deleting : copy.stage.deleteAction}
      </button>
      {error ? (
        <span className="stage-delete-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
