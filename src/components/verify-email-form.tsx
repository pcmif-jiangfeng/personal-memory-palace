"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

function subscribeToHashChange(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

const readToken = () => window.location.hash.slice(1);
const emptyToken = () => "";

export function VerifyEmailForm() {
  const token = useSyncExternalStore(subscribeToHashChange, readToken, emptyToken);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setMessage("");
    setSubmitting(true);
    try {
      await requestJson(
        "/api/verify-email",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("ok" in payload) ||
            payload.ok !== true
          ) {
            throw new TypeError("Invalid verification response");
          }
          return true;
        },
      );
      window.history.replaceState(null, "", window.location.pathname);
      setVerified(true);
      setMessage("邮箱验证成功，现在可以登录账号。");
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setMessage(
        code === "INVALID_VERIFICATION_TOKEN"
          ? "链接已过期或已使用，请重新请求验证邮件。"
          : "验证未完成，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-form">
      {message ? <p role="status">{message}</p> : null}
      {!verified && /^[A-Za-z0-9_-]{43}$/.test(token) ? (
        <button className="button-primary" disabled={submitting} onClick={submit}>
          {submitting ? "正在验证…" : "验证邮箱"}
        </button>
      ) : null}
      {!verified ? <Link href="/resend-verification">重新发送验证邮件</Link> : null}
      {verified ? <Link href="/account/login">前往邮箱账号登录</Link> : null}
    </div>
  );
}
