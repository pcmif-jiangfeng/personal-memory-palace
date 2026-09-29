"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClientApiError, requestJson } from "@/client/http-client";

export function MuseumRemoveCollaboratorForm({
  museumId,
  userId,
  displayName,
}: {
  museumId: string;
  userId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const warningId = `remove-warning-${userId}`;

  async function remove() {
    if (!confirmed || busy || removed) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(
        `/api/museums/${encodeURIComponent(museumId)}/collaborators/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        },
        (payload) => {
          if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true)
            throw new TypeError("Invalid collaborator removal response");
          return true;
        },
      );
      setRemoved(true);
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "USER_REQUIRED"
          ? "登录已失效，请重新登录。"
          : ["MUSEUM_OWNER_REQUIRED", "MUSEUM_NOT_FOUND"].includes(code)
            ? "当前账号已无权管理该馆，请刷新页面。"
            : code === "MEMBERSHIP_NOT_FOUND"
              ? "该成员关系不存在，请刷新列表。"
              : "未能确认移除结果，请重试；重复移除不会删除馆内内容。",
      );
    } finally {
      setBusy(false);
    }
  }

  if (removed) return <p role="status">已移除「{displayName}」的协作者权限。</p>;
  return (
    <div className="login-form">
      <p id={warningId}>
        移除「{displayName}
        」后，对方的协作者权限立即失效，旧页面下一次请求将被拒绝。馆内内容不会删除；重新加入仍需有效邀请。
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          aria-describedby={warningId}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        我确认移除该协作者
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="text-button danger"
        disabled={!confirmed || busy}
        onClick={remove}
      >
        {busy ? "正在移除…" : "移除协作者"}
      </button>
    </div>
  );
}
