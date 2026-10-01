"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";
import { MIN_USER_PASSWORD_LENGTH } from "@/domain/rules";

function subscribeToHashChange(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

const readToken = () => window.location.hash.slice(1);
const emptyToken = () => "";

export function ResetPasswordForm() {
  const token = useSyncExternalStore(subscribeToHashChange, readToken, emptyToken);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const newPassword = values.get("newPassword");
    if (newPassword !== values.get("confirmPassword")) {
      setError("两次输入的密码不一致。");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await requestJson(
        "/api/password-reset/confirm",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, newPassword }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("ok" in payload) ||
            payload.ok !== true
          ) {
            throw new TypeError("Invalid password-reset response");
          }
          return true;
        },
      );
      window.history.replaceState(null, "", window.location.pathname);
      setComplete(true);
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "INVALID_RESET_TOKEN"
          ? "链接已过期或已使用，请重新申请。"
          : code === "TOO_MANY_ATTEMPTS"
            ? "尝试次数过多，请稍后再试。"
            : "暂时无法重置密码，请稍后再试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (complete) {
    return (
      <div className="login-form">
        <p role="status">密码已更新，之前的登录会话均已退出。</p>
        <Link href="/account/login">使用新密码登录</Link>
      </div>
    );
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return (
      <div className="login-form">
        <p role="alert">链接无效，请重新申请密码重置。</p>
        <Link href="/forgot-password">重新申请</Link>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>新密码</span>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_USER_PASSWORD_LENGTH}
          required
        />
      </label>
      <label className="form-field">
        <span>确认新密码</span>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_USER_PASSWORD_LENGTH}
          required
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在更新…" : "更新密码"}
      </button>
      <Link href="/forgot-password">重新申请链接</Link>
    </form>
  );
}
