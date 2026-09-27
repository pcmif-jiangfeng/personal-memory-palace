"use client";

import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function ResendVerificationForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      await requestJson(
        "/api/resend-verification",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("ok" in payload) ||
            payload.ok !== true
          ) {
            throw new TypeError("Invalid resend response");
          }
          return true;
        },
      );
      setMessage("如果该邮箱有待验证的账号，验证邮件会发送给你。若刚请求过，请稍等一分钟再试。");
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setMessage(
        code === "TOO_MANY_ATTEMPTS" ? "请求过于频繁，请稍后再试。" : "暂时无法发送，请稍后再试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>邮箱</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {message ? <p role="status">{message}</p> : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在发送…" : "重新发送验证邮件"}
      </button>
    </form>
  );
}
