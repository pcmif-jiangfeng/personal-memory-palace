"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ClientApiError, requestJson } from "@/client/http-client";
import type { EmailCodePurpose } from "@/data/email-code";

export function EmailCodeForm({
  purpose,
  email = "",
}: {
  purpose: EmailCodePurpose;
  email?: string;
}) {
  const router = useRouter();
  const [address, setAddress] = useState(email);
  const [phase, setPhase] = useState<"send" | "code" | "password" | "complete">(
    purpose === "REGISTER" ? "code" : "send",
  );
  const [grant, setGrant] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function perform(action: "SEND" | "VERIFY" | "CONFIRM", values?: FormData) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const extra =
        action === "VERIFY"
          ? { code: values?.get("code") }
          : action === "CONFIRM"
            ? {
                grant,
                newPassword: values?.get("newPassword"),
                confirmPassword: values?.get("confirmPassword"),
              }
            : {};
      const result = await requestJson(
        "/api/email-code",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose, action, email: address, ...extra }),
        },
        (payload) => {
          if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true)
            throw new TypeError("Invalid email code response");
          if (action === "VERIFY" && purpose !== "REGISTER") {
            if (
              !("grant" in payload) ||
              typeof payload.grant !== "string" ||
              !/^[A-Za-z0-9_-]{43}$/.test(payload.grant)
            )
              throw new TypeError("Invalid password grant");
            return payload.grant;
          }
          return "";
        },
      );
      if (action === "SEND") {
        setGrant("");
        setPhase("code");
        setCooldown(60);
        setMessage(
          purpose === "RESET_PASSWORD"
            ? "如果该邮箱已经注册，我们已发送验证码。"
            : "验证码已发送，10分钟内有效。",
        );
      } else if (action === "VERIFY") {
        if (purpose === "REGISTER") {
          router.replace("/");
          router.refresh();
        } else {
          setGrant(result);
          setPhase("password");
        }
      } else {
        setGrant("");
        setPhase("complete");
        router.refresh();
      }
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      if (code === "USER_REQUIRED") {
        router.replace("/account/login");
        router.refresh();
      }
      if (code === "CODE_COOLDOWN") {
        setCooldown(60);
        setError("请等待60秒后重新发送。");
      } else
        setError(
          code === "INVALID_CODE"
            ? "验证码错误、已过期或已使用，请重新发送。"
            : code === "INVALID_CODE_GRANT"
              ? "验证已失效，请重新发送验证码。"
              : code === "INVALID_PASSWORD_CONFIRMATION"
                ? "两次密码需一致。"
                : code === "INVALID_PASSWORD"
                  ? "密码需为8至512个字符。"
                  : code === "TOO_MANY_ATTEMPTS"
                    ? "尝试次数过多，请稍后再试。"
                    : action === "SEND"
                      ? "验证码发送失败，请稍后重试。"
                      : "操作未完成，请稍后重试。",
        );
    } finally {
      setBusy(false);
    }
  }

  if (phase === "complete")
    return (
      <div className="login-form">
        <p role="status">
          密码已更新。
          {purpose === "CHANGE_PASSWORD" ? "当前设备保持登录。" : "请使用新密码重新登录。"}
        </p>
        {purpose === "RESET_PASSWORD" ? (
          <Link href="/account/login">前往登录</Link>
        ) : (
          <button
            className="button-secondary"
            onClick={() => {
              setPhase("send");
              setMessage("");
            }}
          >
            再次修改密码
          </button>
        )}
      </div>
    );
  return (
    <div className="login-form" aria-busy={busy}>
      {purpose === "RESET_PASSWORD" ? (
        <label className="form-field">
          <span>邮箱</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={address}
            onChange={(event) => {
              setAddress(event.currentTarget.value);
              setGrant("");
              setPhase("send");
            }}
            maxLength={254}
            required
            disabled={busy}
          />
        </label>
      ) : (
        <p>验证码发送至：{email}</p>
      )}
      {phase === "send" || phase === "code" ? (
        <button
          type="button"
          className="button-secondary"
          disabled={busy || cooldown > 0 || !address.trim()}
          onClick={() => void perform("SEND")}
        >
          {cooldown > 0
            ? `${cooldown}秒后可重发`
            : phase === "code"
              ? "重新发送验证码"
              : "发送验证码"}
        </button>
      ) : null}
      {phase === "code" ? (
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform("VERIFY", new FormData(event.currentTarget));
          }}
        >
          <label className="form-field">
            <span>六位邮箱验证码</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              disabled={busy}
            />
          </label>
          <button className="button-primary" disabled={busy}>
            {busy ? "正在验证…" : "验证验证码"}
          </button>
        </form>
      ) : null}
      {phase === "password" ? (
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform("CONFIRM", new FormData(event.currentTarget));
          }}
        >
          <label className="form-field">
            <span>新密码</span>
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={512}
              required
              disabled={busy}
            />
          </label>
          <label className="form-field">
            <span>确认新密码</span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={512}
              required
              disabled={busy}
            />
          </label>
          <button className="button-primary" disabled={busy}>
            {busy ? "正在更新…" : "更新密码"}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => {
              setGrant("");
              setPhase("send");
            }}
          >
            重新验证邮箱
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
