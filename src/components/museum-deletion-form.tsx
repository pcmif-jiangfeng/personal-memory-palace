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
          : code === "DELETION_DEADLINE_PASSED"
            ? "删除截止时间已到，不能撤销；请查看后台清理状态。"
            : code === "DELETION_DEADLINE_UNKNOWN"
              ? "历史删除期限未知，不能自动撤销，需要先核对历史数据。"
              : code === "MUSEUM_DELETE_IN_PROGRESS"
                ? "后台清理已经开始，不能撤销。"
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
          : "我理解本馆所有成员和分享将暂停访问，30×24小时截止前可取消，截止后不可撤销。"}
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
