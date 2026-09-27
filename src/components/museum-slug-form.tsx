"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function MuseumSlugForm({ currentSlug }: { currentSlug: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    const values = new FormData(event.currentTarget);
    try {
      await requestJson(
        "/api/museums",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: values.get("slug") }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("slug" in payload) ||
            typeof payload.slug !== "string"
          ) {
            throw new TypeError("Invalid slug response");
          }
          return payload.slug;
        },
      );
      setMessage("馆址已保存，你的回忆与照片不会改变。");
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "SLUG_TAKEN"
          ? "这个馆址已有人使用，请换一个。"
          : code === "INVALID_SLUG"
            ? "请使用小写英文字母、数字和连字符。"
            : "馆址未保存，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field" htmlFor="museum-slug">
        <span>修改馆址</span>
        <input
          id="museum-slug"
          name="slug"
          defaultValue={currentSlug}
          maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
          aria-describedby="museum-slug-help"
        />
      </label>
      <small id="museum-slug-help">使用小写英文字母、数字和连字符。修改不影响馆内内容。</small>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在保存…" : "保存馆址"}
      </button>
    </form>
  );
}
