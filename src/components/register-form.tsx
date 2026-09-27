"use client";

import Link from "next/link";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

const errorMessages: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED: "这个邮箱已经注册。",
  INVALID_EMAIL: "请输入有效的邮箱地址。",
  INVALID_DISPLAYNAME: "请输入展示名称。",
  INVALID_PASSWORD: "请输入密码。",
  PASSWORD_TOO_SHORT: "密码至少需要 12 个字符。",
  PASSWORD_TOO_LONG: "密码不能超过 512 个字符。",
  TOO_MANY_ATTEMPTS: "尝试次数过多，请稍后再试。",
};

export function RegisterForm() {
  const [error, setError] = useState("");
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = event.currentTarget;
    const values = new FormData(form);

    try {
      const result = await requestJson(
        "/api/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.get("email"),
            password: values.get("password"),
            displayName: values.get("displayName"),
          }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("id" in payload) ||
            typeof payload.id !== "string"
          ) {
            throw new TypeError("Invalid registration response");
          }
          return "verificationEmailSent" in payload &&
            typeof payload.verificationEmailSent === "boolean"
            ? payload.verificationEmailSent
            : false;
        },
      );
      form.reset();
      setEmailSent(result);
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(errorMessages[code] ?? "注册未完成，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (emailSent !== null) {
    return (
      <div className="login-form" role="status">
        <p>
          {emailSent
            ? "账号已建立。请查收验证邮件，并打开其中的链接完成验证。"
            : "账号已建立，但验证邮件暂时未能发送。请稍后重新发送。"}
        </p>
        <Link href="/resend-verification">重新发送验证邮件</Link>
        <Link href="/account/login">完成验证后登录</Link>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>邮箱</span>
        <input name="email" type="email" autoComplete="email" maxLength={254} required />
      </label>
      <label className="form-field">
        <span>展示名称</span>
        <input name="displayName" type="text" autoComplete="nickname" maxLength={80} required />
      </label>
      <label className="form-field">
        <span>密码</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={512}
          required
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在注册…" : "创建账号"}
      </button>
    </form>
  );
}
