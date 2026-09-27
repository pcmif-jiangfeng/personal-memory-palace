"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function MuseumOnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const values = new FormData(event.currentTarget);
    try {
      await requestJson(
        "/api/museums",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.get("name"),
            slug: values.get("slug"),
            description: values.get("description"),
          }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("id" in payload) ||
            typeof payload.id !== "string"
          ) {
            throw new TypeError("Invalid museum response");
          }
          return payload.id;
        },
      );
      router.replace("/account");
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "SLUG_TAKEN"
          ? "这个馆址已有人使用，请换一个。"
          : code === "MUSEUM_ALREADY_EXISTS"
            ? "你已经建馆，请刷新页面。"
            : code === "INVALID_SLUG"
              ? "馆址只能使用小写英文字母、数字和连字符。"
              : "建馆未完成，请检查填写内容后重试。",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>博物馆名称</span>
        <input name="name" maxLength={80} required />
      </label>
      <label className="form-field">
        <span>馆址</span>
        <input
          name="slug"
          maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
          aria-describedby="museum-slug-help"
        />
        <small id="museum-slug-help">使用小写英文字母、数字和连字符，例如 my-memory-palace。</small>
      </label>
      <label className="form-field">
        <span>关于这座馆（选填）</span>
        <textarea name="description" maxLength={500} rows={3} />
      </label>
      <p>封面照片可以稍后再添加。</p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在建馆…" : "创建我的博物馆"}
      </button>
    </form>
  );
}
