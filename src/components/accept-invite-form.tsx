"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function AcceptInviteForm({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      await requestJson(
        "/api/invites/accept",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteId }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("alreadyMember" in payload) ||
            typeof payload.alreadyMember !== "boolean"
          )
            throw new TypeError("Invalid invitation acceptance response");
          return true;
        },
      );
      setJoined(true);
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "INVITE_UNAVAILABLE"
          ? "邀请已撤销、过期或当前不可用，请向馆长确认。"
          : code === "INVITE_NOT_FOUND"
            ? "此邀请不属于当前账号。"
            : "接受未确认成功，请刷新邀请状态后重试。",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {joined ? (
        <p role="status">邀请已接受。</p>
      ) : (
        <button className="button-primary" disabled={busy} onClick={() => void accept()}>
          {busy ? "正在接受…" : "接受邀请"}
        </button>
      )}
    </div>
  );
}
