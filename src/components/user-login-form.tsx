"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function UserLoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNeedsVerification(false);
    setSubmitting(true);
    const values = new FormData(event.currentTarget);
    try {
      await requestJson(
        "/api/user-auth",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("ok" in payload) ||
            payload.ok !== true
          ) {
            throw new TypeError("Invalid login response");
          }
          return true;
        },
      );
      router.replace("/account");
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setNeedsVerification(code === "EMAIL_NOT_VERIFIED");
      setError(
        code === "EMAIL_NOT_VERIFIED"
          ? "邮箱尚未验证，请先完成验证。"
          : code === "TOO_MANY_ATTEMPTS"
            ? "尝试次数过多，请稍后再试。"
            : "邮箱或密码不正确。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>邮箱</span>
        <input name="email" type="email" autoComplete="email" maxLength={254} required />
      </label>
      <label className="form-field">
        <span>密码</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <Link href="/forgot-password">忘记密码？</Link>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {needsVerification ? <Link href="/resend-verification">重新发送验证邮件</Link> : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在登录…" : "登录"}
      </button>
    </form>
  );
}
