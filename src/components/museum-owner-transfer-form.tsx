"use client";

import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function MuseumOwnerTransferForm({
  museumId,
  museumName,
  version,
  target,
}: {
  museumId: string;
  museumName: string;
  version: number;
  target: { id: string; displayName: string; email: string };
}) {
  const [disposition, setDisposition] = useState<"stay" | "leave">("stay");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function transfer() {
    if (!reviewing || !acknowledged || busy) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(
        `/api/museums/${encodeURIComponent(museumId)}/transfer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirm: true,
            targetUserId: target.id,
            oldOwnerDisposition: disposition,
            version,
          }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("ok" in payload) ||
            payload.ok !== true ||
            !("museumId" in payload) ||
            payload.museumId !== museumId ||
            !("ownerId" in payload) ||
            payload.ownerId !== target.id
          )
            throw new TypeError("Invalid transfer response");
          return true;
        },
      );
      window.location.assign(
        disposition === "stay" ? `/account/museums/${encodeURIComponent(museumId)}` : "/account",
      );
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "MUSEUM_VERSION_CONFLICT"
          ? "资料已更新，请刷新页面重新确认。"
          : code === "TRANSFER_TARGET_UNAVAILABLE"
            ? "接收方已不是有效协作者，请刷新页面。"
            : "转移结果未确认，请刷新查看当前身份，不要直接重复提交。",
      );
      setBusy(false);
    }
  }
  return (
    <div className="login-form">
      {!reviewing ? (
        <>
          <label className="form-field">
            <span>转移后我的身份</span>
            <select
              value={disposition}
              onChange={(event) => setDisposition(event.target.value as "stay" | "leave")}
            >
              <option value="stay">保留协作者身份</option>
              <option value="leave">退出这座博物馆</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            我理解将失去本馆的馆长权限，接收方原有博物馆不会被覆盖。
          </label>
          <button
            type="button"
            className="button-secondary"
            disabled={!acknowledged}
            onClick={() => setReviewing(true)}
          >
            下一步：核对转移
          </button>
        </>
      ) : (
        <>
          <p>
            最终确认：将「{museumName}」的馆长身份转给 {target.displayName}（{target.email}）。
          </p>
          <p>
            你将{disposition === "stay" ? "成为协作者" : "退出本馆"}
            。记忆、照片、馆址及其他协作者保持不变。
          </p>
          <button type="button" className="button-primary" disabled={busy} onClick={transfer}>
            {busy ? "正在转移…" : "确认转移馆长身份"}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => {
              setReviewing(false);
              setAcknowledged(false);
            }}
          >
            取消
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
