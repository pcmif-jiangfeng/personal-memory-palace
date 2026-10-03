"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";
import type { EmailInviteSummary } from "@/data/email-invites";

export function InviteManagement({
  invites,
  museumId,
}: {
  invites: EmailInviteSummary[];
  museumId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function send(targetEmail: string) {
    setBusy(targetEmail);
    setError("");
    setMessage("");
    try {
      const delivery = await requestJson(
        "/api/invites?museumId=" + encodeURIComponent(museumId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetEmail }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("delivery" in payload) ||
            (payload.delivery !== "accepted" && payload.delivery !== "failed")
          )
            throw new TypeError("Invalid invitation delivery response");
          return payload.delivery;
        },
      );
      setMessage(
        delivery === "accepted"
          ? "邀请已提交邮件服务。对方须验证此邮箱并主动接受；请以实际收件为准。"
          : "邀请已保存，但邮件发送失败。可重试发送，不会延长原截止时间。",
      );
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "ALREADY_MUSEUM_MEMBER"
          ? "对方已是本馆成员，不能再次邀请。"
          : code === "INVITE_RATE_LIMITED"
            ? "发送过于频繁，请稍后重试。"
            : "邀请未确认成功，请刷新列表核对后重试。",
      );
    } finally {
      setBusy("");
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    setError("");
    setMessage("");
    try {
      const status = await requestJson(
        "/api/invites/" + encodeURIComponent(id) + "?museumId=" + encodeURIComponent(museumId),
        { method: "DELETE" },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("invite" in payload) ||
            !payload.invite ||
            typeof payload.invite !== "object" ||
            !("status" in payload.invite) ||
            (payload.invite.status !== "revoked" && payload.invite.status !== "expired")
          )
            throw new TypeError("Invalid invitation revocation response");
          return payload.invite.status;
        },
      );
      setMessage(status === "revoked" ? "邀请已撤销。" : "邀请已过期，无需撤销。");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ClientApiError && cause.code === "INVITE_ALREADY_ACCEPTED"
          ? "对方已接受邀请。如需移除，请使用成员管理。"
          : "撤销未确认成功，请刷新列表核对后重试。",
      );
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="login-form">
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(email);
        }}
      >
        <div className="form-field">
          <label htmlFor="invitation-email">受邀邮箱</label>
          <input
            id="invitation-email"
            type="email"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={Boolean(busy)}
            autoComplete="off"
          />
        </div>
        <p>邀请固定有效七天。重复发送沿用原邀请，不延长截止时间；链接不能授权其他邮箱账号。</p>
        <button className="button-primary" disabled={Boolean(busy)}>
          {busy ? "正在处理…" : "发送邀请"}
        </button>
      </form>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <h2>本馆邀请</h2>
      {!invites.length ? (
        <p>暂无邀请。</p>
      ) : (
        <ul className="invitation-list">
          {invites.map((invite) => (
            <li key={invite.id}>
              <p>
                {invite.targetEmail} ·{" "}
                {
                  { pending: "待接受", accepted: "已接受", revoked: "已撤销", expired: "已过期" }[
                    invite.status
                  ]
                }
              </p>
              <p>
                截止：<time dateTime={invite.expiresAt}>{invite.expiresAt}</time>
              </p>
              {invite.status === "pending" ? (
                <div>
                  <button
                    className="button-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => void send(invite.targetEmail)}
                  >
                    重新发送
                  </button>{" "}
                  <button
                    className="button-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => void revoke(invite.id)}
                  >
                    撤销邀请
                  </button>
                </div>
              ) : invite.status === "expired" || invite.status === "revoked" ? (
                <button
                  className="button-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void send(invite.targetEmail)}
                >
                  重新邀请
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
