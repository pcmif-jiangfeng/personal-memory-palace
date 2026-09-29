"use client";

import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function MuseumDeletionForm({
  museumId,
  version,
  pending,
}: {
  museumId: string;
  version: number;
  pending: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(
        `/api/museums/${encodeURIComponent(museumId)}/deletion`,
        {
          method: pending ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true, version }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("museumId" in payload) ||
            payload.museumId !== museumId ||
            !("status" in payload) ||
            payload.status !== (pending ? "active" : "pending_deletion")
          )
            throw new TypeError("Invalid deletion response");
          return true;
        },
      );
      window.location.reload();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "MUSEUM_VERSION_CONFLICT"
          ? "博物馆状态已改变，请刷新后重新确认。"
          : code === "TRANSFER_OWNERSHIP_REQUIRED"
            ? "名下博物馆仍有有效协作者，请先转移馆长身份。"
            : "操作结果未确认，请刷新查看当前状态，不要直接重复提交。",
      );
      setBusy(false);
    }
  }
  return (
    <div className="login-form">
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {pending
          ? "确认取消待删除，恢复博物馆访问。"
          : "我理解本馆将暂停访问，记录 30 天删除期限，可在最终清理前取消。"}
      </label>
      <button
        type="button"
        className="button-primary"
        disabled={!confirmed || busy}
        onClick={submit}
      >
        {busy ? "正在处理…" : pending ? "确认取消删除" : "确认进入 30 天待删除"}
      </button>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
