"use client";

import { useState } from "react";

export function ShareManager({
  memoryId,
  publiclyVisible,
}: {
  memoryId: string;
  publiclyVisible: boolean;
}) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");

  async function copyUrl(path: string) {
    const nextUrl = `${window.location.origin}${path}`;
    setUrl(nextUrl);
    try {
      await navigator.clipboard.writeText(nextUrl);
      setMessage("链接已复制，可以直接发送给访客，不需要密码。");
    } catch {
      setMessage("请手动复制下面的链接。");
    }
  }

  return (
    <div className="share-manager">
      <h3>分享人生博物馆</h3>
      <p>访客只能浏览公开内容，无法进入照片整理台或编辑页面。</p>
      <button className="button-secondary" type="button" onClick={() => void copyUrl("/")}>
        复制网站网址
      </button>
      <button
        className="button-secondary"
        type="button"
        disabled={!publiclyVisible}
        onClick={() => void copyUrl(`/memories/${encodeURIComponent(memoryId)}`)}
      >
        复制这段记忆的链接
      </button>
      {!publiclyVisible ? <p>这段记忆当前对访客隐藏，无法单独分享。</p> : null}
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
