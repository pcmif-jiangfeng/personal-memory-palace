"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function MuseumOnboardingForm({ hasPrivatePalace = false }: { hasPrivatePalace?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [museumType, setMuseumType] = useState<"private" | "shared">(
    hasPrivatePalace ? "shared" : "private",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const values = new FormData(event.currentTarget);
    try {
      const museumId = await requestJson(
        "/api/museums",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.get("name"),
            slug: values.get("slug"),
            description: values.get("description"),
            museumType,
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
      router.replace(`/account?museumId=${encodeURIComponent(museumId)}`);
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "SLUG_TAKEN"
          ? "这个馆址已有人使用，请换一个。"
          : code === "MUSEUM_ALREADY_EXISTS"
            ? "你已拥有私人宫殿，可以选择创建共同宫殿。"
            : code === "INVALID_SLUG"
              ? "馆址只能使用小写英文字母、数字和连字符。"
              : "建馆未完成，请检查填写内容后重试。",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="museum-type">宫殿类型</label>
        <select
          id="museum-type"
          name="museumType"
          value={museumType}
          disabled={submitting}
          onChange={(event) =>
            setMuseumType(event.target.value === "shared" ? "shared" : "private")
          }
          aria-describedby="museum-type-help"
        >
          <option value="private" disabled={hasPrivatePalace}>
            私人宫殿{hasPrivatePalace ? "（已拥有）" : ""}
          </option>
          <option value="shared">共同宫殿</option>
        </select>
      </div>
      <p id="museum-type-help">
        {museumType === "private"
          ? "每个账号拥有一座私人宫殿，也可以邀请他人帮助整理。"
          : "保存共同经历，不替代私人宫殿。新建不会增加账号存储配额。"}
      </p>
      <label className="form-field">
        <span>博物馆名称</span>
        <input name="name" maxLength={80} required />
      </label>
      <div className="form-field">
        <label htmlFor="museum-slug">馆址</label>
        <input
          id="museum-slug"
          name="slug"
          maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
          aria-describedby="museum-slug-help"
        />
        <small id="museum-slug-help">使用小写英文字母、数字和连字符，例如 my-memory-palace。</small>
      </div>
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
        {submitting ? "正在建馆…" : museumType === "shared" ? "创建共同宫殿" : "创建私人宫殿"}
      </button>
    </form>
  );
}
