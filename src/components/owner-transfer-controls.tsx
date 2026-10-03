"use client";

import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";
import type { OwnerTransferAction } from "@/http/owner-transfer-request";

export function OwnerTransferControls({
  museumId,
  version,
  role,
  pending,
  targets,
}: {
  museumId: string;
  version: number;
  role: "owner" | "collaborator";
  pending: { id: string; targetName: string; expiresAt: string } | null;
  targets: Array<{ id: string; displayName: string }>;
}) {
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(action: OwnerTransferAction) {
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(
        `/api/museums/${encodeURIComponent(museumId)}/transfer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("ok" in payload) ||
            payload.ok !== true ||
            !("museumId" in payload) ||
            payload.museumId !== museumId ||
            !("status" in payload) ||
            payload.status !==
              (
                {
                  request: "pending",
                  accept: "accepted",
                  reject: "rejected",
                  cancel: "cancelled",
                } as const
              )[action.action]
          )
            throw new TypeError("Invalid transfer response");
          return true;
        },
      );
      window.location.replace(`/account/museums/${encodeURIComponent(museumId)}/transfer`);
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "STORAGE_QUOTA_EXCEEDED"
          ? "你的账号剩余额度不足，转让未完成，当前馆长不变。"
          : ["ACCOUNT_QUOTA_NOT_READY", "STORAGE_USAGE_NOT_READY"].includes(code)
            ? "存储占用或账号额度尚未核对，转让未完成。"
            : [
                  "TRANSFER_EXPIRED",
                  "TRANSFER_NOT_PENDING",
                  "TRANSFER_TARGET_UNAVAILABLE",
                  "TRANSFER_ALREADY_PENDING",
                  "MUSEUM_VERSION_CONFLICT",
                ].includes(code)
              ? "申请或宫殿状态已变化，请刷新查看；本次操作未完成。"
              : "暂时无法确认操作结果，请刷新核对当前馆长和申请状态。",
      );
      setBusy(false);
    }
  }
  if (!pending && role !== "owner") return <p>当前没有需要你处理的转让申请。</p>;
  return (
    <div className="login-form">
      {pending ? (
        <p>
          接任者：{pending.targetName} · 截止时间：
          <time dateTime={pending.expiresAt}>
            {pending.expiresAt.replace("T", " ").replace("Z", " UTC")}
          </time>
        </p>
      ) : (
        <label className="form-field">
          <span id="transfer-target-label">接任协作者</span>
          <select
            aria-labelledby="transfer-target-label"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={busy || !targets.length}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      {!pending && !targets.length ? (
        <p>本页没有有效协作者可接任；请查看其他成员页或先邀请协作者。</p>
      ) : null}
      <p id="transfer-warning">
        接受前馆长不变。接任者须主动接受，并满足账号额度要求；成功后原馆长固定成为协作者。照片、记忆和作者归属保持不变。
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
          aria-describedby="transfer-warning"
        />
        我已了解转让规则，确认本次操作
      </label>
      {pending ? (
        role === "owner" ? (
          <button
            type="button"
            className="button-secondary"
            disabled={!confirmed || busy}
            onClick={() => submit({ action: "cancel", requestId: pending.id, confirm: true })}
          >
            撤回转让申请
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button-primary"
              disabled={!confirmed || busy}
              onClick={() => submit({ action: "accept", requestId: pending.id, confirm: true })}
            >
              接受馆长转让
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={!confirmed || busy}
              onClick={() => submit({ action: "reject", requestId: pending.id, confirm: true })}
            >
              拒绝转让申请
            </button>
          </>
        )
      ) : (
        <button
          type="button"
          className="button-primary"
          disabled={!confirmed || busy || !targetId}
          onClick={() =>
            submit({ action: "request", targetUserId: targetId, version, confirm: true })
          }
        >
          发起转让申请
        </button>
      )}
      {busy ? <p role="status">正在处理…</p> : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
