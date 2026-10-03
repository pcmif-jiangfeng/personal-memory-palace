"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

export function AdminQuotaForm({
  museumId,
  ownerId,
  quota,
}: {
  museumId: string;
  ownerId: string;
  quota: number;
}) {
  const router = useRouter();
  const [expectedQuota, setExpectedQuota] = useState(quota);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inputId = `quota-${museumId}`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const value = new FormData(event.currentTarget).get("quota");
    const bytes = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      setError("请输入 0 至 9007199254740991 范围内的整数字节数。");
      return;
    }
    setSubmitting(true);
    try {
      const saved = await requestJson(
        `/api/admin/museums/${encodeURIComponent(museumId)}/quota`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageQuotaBytes: bytes,
            expectedQuotaBytes: expectedQuota,
            expectedOwnerId: ownerId,
          }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("id" in payload) ||
            payload.id !== museumId ||
            !("storageQuotaBytes" in payload) ||
            payload.storageQuotaBytes !== bytes
          )
            throw new TypeError("Invalid quota response");
          return bytes;
        },
      );
      setExpectedQuota(saved);
      setMessage("馆长账号总配额已保存并立即生效，适用于其全部自有宫殿；已有照片不会被删除。");
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        code === "STORAGE_QUOTA_CONFLICT" || code === "STORAGE_QUOTA_OWNER_CONFLICT"
          ? "配额或馆长已被修改，请刷新页面后重新确认。"
          : code === "INVALID_STORAGE_QUOTA"
            ? "请输入有效的非负整数字节数。"
            : "配额未保存，请确认管理员登录状态后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form admin-quota-form" onSubmit={submit}>
      <label className="form-field" htmlFor={inputId}>
        <span>调整馆长账号总配额（字节）</span>
        <input
          id={inputId}
          name="quota"
          type="text"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={16}
          defaultValue={quota}
          required
          disabled={submitting}
          aria-describedby={`${inputId}-help`}
        />
      </label>
      <small id={`${inputId}-help`}>
        1 GiB = 1073741824 字节。0 表示禁止新增上传；低于已用容量时也禁止新增上传，不删除已有内容。
      </small>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <button className="button-primary" disabled={submitting}>
        {submitting ? "正在保存…" : "保存配额"}
      </button>
    </form>
  );
}
