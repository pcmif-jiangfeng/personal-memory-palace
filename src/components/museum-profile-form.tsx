"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";
import { copy } from "@/i18n/zh-CN";

export function MuseumProfileForm({
  museumId,
  name,
  description,
  coverPhotoId,
  photos,
  version,
}: {
  museumId: string;
  name: string;
  description: string;
  coverPhotoId: string | null;
  photos: { id: string; name: string }[];
  version: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draftVersion, setDraftVersion] = useState(version);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const savedVersion = await requestJson(
        `/api/museums?museumId=${encodeURIComponent(museumId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.get("name"),
            description: values.get("description"),
            coverPhotoId: values.get("coverPhotoId") || null,
            version: draftVersion,
          }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("id" in payload) ||
            payload.id !== museumId
          )
            throw new TypeError("Invalid museum response");
          if (
            !("version" in payload) ||
            !Number.isSafeInteger(payload.version) ||
            (payload.version as number) < 1
          )
            throw new TypeError("Invalid museum version");
          return payload.version as number;
        },
      );
      setDraftVersion(savedVersion);
      setMessage("博物馆资料已保存。");
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "MUSEUM_VERSION_CONFLICT"
          ? copy.management.museumConflict
          : code === "INVALID_COVER_PHOTO"
            ? "这张照片已不可用，请重新选择封面。"
            : "资料未保存，请检查填写内容或稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>博物馆名称</span>
        <input name="name" defaultValue={name} maxLength={80} required />
      </label>
      <label className="form-field">
        <span>博物馆简介</span>
        <textarea name="description" defaultValue={description} maxLength={500} rows={4} />
      </label>
      <label className="form-field">
        <span>博物馆封面</span>
        <select
          name="coverPhotoId"
          defaultValue={coverPhotoId ?? ""}
          aria-describedby="museum-cover-help"
        >
          <option value="">不设置封面</option>
          {coverPhotoId && !photos.some((photo) => photo.id === coverPhotoId) ? (
            <option value={coverPhotoId} disabled>
              原封面已不可用，请重新选择
            </option>
          ) : null}
          {photos.map((photo) => (
            <option key={photo.id} value={photo.id}>
              {photo.name}
            </option>
          ))}
        </select>
      </label>
      <small id="museum-cover-help">
        从本馆最近的照片中选择（最多60张，包含当前封面）。
        {photos.length === 0 ? "本馆暂时没有可用照片。" : ""}
      </small>
      {error ? (
        <p className="form-error" role="alert">
          {error}
          {error === copy.management.museumConflict ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (window.confirm(copy.management.reloadConfirm)) window.location.reload();
              }}
            >
              {copy.management.reloadLatest}
            </button>
          ) : null}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在保存…" : "保存博物馆资料"}
      </button>
    </form>
  );
}
