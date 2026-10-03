"use client";

import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function MuseumLeaveForm({
  museumId,
  museumName,
}: {
  museumId: string;
  museumName: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function leave() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(
        `/api/museums/${museumId}/leave`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        },
        (payload) => {
          if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true)
            throw new TypeError("Invalid Museum leave response");
          return true;
        },
      );
      // A full navigation discards the old page and reloads the membership-based header.
      window.location.replace("/account");
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "USER_REQUIRED"
          ? "登录已失效，请重新登录后再试。"
          : code === "OWNER_CANNOT_LEAVE"
            ? "馆长不能通过协作者退出功能离开自己的宫殿。"
            : ["MEMBERSHIP_NOT_FOUND", "MUSEUM_NOT_FOUND"].includes(code)
              ? "这座宫殿已不可访问或成员关系已失效，请返回自己的宫殿。"
              : "暂时无法确认退出结果，请重试；重复退出不会影响其他成员或馆内内容。",
      );
      setBusy(false);
    }
  }

  return (
    <div className="login-form">
      <h2>退出这座宫殿</h2>
      <p id="museum-leave-warning">
        退出「{museumName}」后，协作者身份立即失效，这座宫殿
        会从切换列表移除，旧页面将无法继续访问。馆内照片和 Memory 不会被删除。重新加入需要有效邀请。
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
          aria-describedby="museum-leave-warning"
        />
        我已了解后果，确认退出
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
        onClick={leave}
      >
        {busy ? "正在退出…" : "退出宫殿"}
      </button>
    </div>
  );
}
