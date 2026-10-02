"use client";

import { useState } from "react";
import { requestJson } from "@/client/http-client";

export function ShareManager({ memoryId, museumId }: { memoryId: string; museumId: string }) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function configure(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const path = await requestJson(
        `/api/shares?museumId=${encodeURIComponent(museumId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memoryId, enabled, mode: "link" }),
        },
        (payload) => {
          if (!payload || typeof payload !== "object")
            throw new TypeError("Invalid share response");
          if (!enabled && "ok" in payload && payload.ok === true) return "";
          if (
            enabled &&
            "url" in payload &&
            typeof payload.url === "string" &&
            /^\/share\/[A-Za-z0-9_-]+$/.test(payload.url)
          )
            return payload.url;
          throw new TypeError("Invalid share response");
        },
      );
      if (!enabled) {
        setUrl("");
        setMessage("分享已关闭，旧链接立即失效。");
        return;
      }
      const nextUrl = new URL(path, window.location.origin).href;
      setUrl(nextUrl);
      try {
        await navigator.clipboard.writeText(nextUrl);
        setMessage("分享链接已复制，访客只能查看这段记忆。");
      } catch {
        setMessage("分享已创建，请手动复制下面的链接。");
      }
    } catch {
      setMessage("分享设置未完成，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="share-manager">
      <h3>分享这段记忆</h3>
      <p>持有链接的访客可以只读查看这段记忆，无需登录，不能查看其他私人内容。</p>
      <button
        className="button-secondary"
        type="button"
        disabled={busy}
        onClick={() => void configure(true)}
      >
        复制这段记忆的链接
      </button>
      <button
        className="button-secondary"
        type="button"
        disabled={busy}
        onClick={() => void configure(false)}
      >
        关闭这段记忆的分享
      </button>
      {url ? (
        <input
          className="share-url"
          aria-label="分享链接"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
