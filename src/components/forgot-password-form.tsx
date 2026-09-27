"use client";

import Link from "next/link";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const values = new FormData(event.currentTarget);
    try {
      await requestJson(
        "/api/password-reset/request",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: values.get("email") }),
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
      setMessage("如果该邮箱已有账号，你会收到一封密码重置邮件。请在一小时内使用链接。");
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "TOO_MANY_ATTEMPTS"
          ? "请求过于频繁，请稍后再试。"
          : "暂时无法发送重置邮件，请稍后再试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>注册邮箱</span>
        <input name="email" type="email" autoComplete="email" maxLength={254} required />
      </label>
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在提交…" : "发送重置链接"}
      </button>
      <Link href="/account/login">返回登录</Link>
    </form>
  );
}
