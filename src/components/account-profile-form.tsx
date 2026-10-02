"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClientApiError, requestJson } from "@/client/http-client";
import { nicknameMaxLength, normalizeNickname } from "@/domain/user-profile";
import { copy } from "@/i18n/zh-CN";

export function AccountProfileForm({ nickname }: { nickname: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(nickname);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || refreshing) return;
    setMessage("");
    const normalized = normalizeNickname(draft);
    if (normalized === null) {
      setError(copy.account.invalid);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const saved = await requestJson(
        "/api/account/profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: normalized }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("nickname" in payload) ||
            payload.nickname !== normalized
          )
            throw new TypeError("Invalid nickname response");
          return normalized;
        },
      );
      setDraft(saved);
      setMessage(copy.account.saved);
      startTransition(() => router.refresh());
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 401) {
        router.replace("/account/login");
        router.refresh();
      }
      setError(
        cause instanceof ClientApiError && cause.code === "INVALID_NICKNAME"
          ? copy.account.invalid
          : copy.account.failed,
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit} aria-busy={submitting || refreshing}>
      <label className="form-field">
        <span>{copy.account.nickname}</span>
        <input
          name="nickname"
          autoComplete="nickname"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          maxLength={nicknameMaxLength}
          required
          aria-describedby="nickname-help"
        />
      </label>
      <small id="nickname-help">{copy.account.nicknameHelp}</small>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <button className="button-primary" disabled={submitting || refreshing}>
        {submitting || refreshing ? copy.account.saving : copy.account.save}
      </button>
    </form>
  );
}
