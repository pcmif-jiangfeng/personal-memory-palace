"use client";

import { useState } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";
import { copy } from "@/i18n/zh-CN";

export function MuseumCopyForm({
  photoId,
  memoryId,
  museumId,
  targets,
}: {
  museumId: string;
  targets: Array<{ id: string; name: string }>;
} & ({ photoId: string; memoryId?: never } | { memoryId: string; photoId?: never })) {
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedMuseumId, setCopiedMuseumId] = useState("");
  const [copiedId, setCopiedId] = useState("");
  if (!targets.length) return null;
  async function submit() {
    if (!targetId || busy) return;
    setBusy(true);
    setError("");
    setCopiedMuseumId("");
    try {
      const result = await requestJson(
        `/api/${memoryId ? "memories" : "photos"}/${encodeURIComponent(memoryId ?? photoId!)}/copy?museumId=${encodeURIComponent(museumId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetMuseumId: targetId }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("museumId" in payload) ||
            payload.museumId !== targetId
          )
            throw new TypeError("Invalid copy response");
          const id =
            memoryId && "memoryId" in payload
              ? payload.memoryId
              : !memoryId && "photoId" in payload
                ? payload.photoId
                : null;
          if (typeof id !== "string" || !id) throw new TypeError("Invalid copied resource");
          return { museumId: payload.museumId, id };
        },
      );
      setCopiedMuseumId(result.museumId);
      setCopiedId(result.id);
    } catch (cause) {
      setError(
        cause instanceof ClientApiError && cause.code === "STORAGE_QUOTA_EXCEEDED"
          ? copy.museumCopy.quota
          : copy.museumCopy.failed,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-form">
      <label>
        <span>{copy.museumCopy.target}</span>
        <select
          value={targetId}
          disabled={busy}
          onChange={(event) => {
            setTargetId(event.target.value);
            setCopiedMuseumId("");
            setError("");
          }}
        >
          <option value="">{copy.museumCopy.choose}</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button-secondary"
        disabled={!targetId || busy || !!copiedMuseumId}
        onClick={submit}
      >
        {busy ? copy.museumCopy.busy : memoryId ? copy.museumCopy.memory : copy.museumCopy.photo}
      </button>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {copiedMuseumId ? (
        <p role="status">
          {memoryId ? copy.museumCopy.memorySuccess : copy.museumCopy.success}{" "}
          <a
            href={`${memoryId ? `/memories/${encodeURIComponent(copiedId)}` : "/workspace"}?museumId=${encodeURIComponent(copiedMuseumId)}`}
          >
            {copy.museumCopy.open}
          </a>
        </p>
      ) : null}
    </div>
  );
}
