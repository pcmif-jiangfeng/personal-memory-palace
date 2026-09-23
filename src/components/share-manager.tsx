"use client";
import { useState } from "react";
import { configureShare } from "@/client/share-api";
import { copy } from "@/i18n/zh-CN";
export function ShareManager({ memoryId }: { memoryId: string }) {
  const [mode, setMode] = useState<"link" | "password">("link");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: React.FormEvent, rotate = false) {
    event.preventDefault();
    try {
      const result = await configureShare({ memoryId, enabled, mode, password, rotate });
      setUrl(result.url ? `${window.location.origin}${result.url}` : "");
      setMessage(copy.share.saved);
    } catch {
      setMessage(copy.share.failed);
    }
  }
  return (
    <form className="share-manager" onSubmit={save}>
      <h3>{copy.share.title}</h3>
      <label className="check-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {copy.share.visitorAccess}
      </label>
      {enabled ? (
        <>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "link" | "password")}
          >
            <option value="link">{copy.share.linkAccess}</option>
            <option value="password">{copy.share.passwordAccess}</option>
          </select>
          {mode === "password" ? (
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={copy.share.password}
              type="password"
              required
            />
          ) : null}
        </>
      ) : null}
      <button className="button-secondary">{copy.share.save}</button>
      {enabled && url ? (
        <button
          className="button-secondary"
          type="button"
          onClick={(event) => void save(event, true)}
        >
          {copy.share.rotate}
        </button>
      ) : null}
      {url ? (
        <input
          className="share-url"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
      {message ? <p className="form-message">{message}</p> : null}
    </form>
  );
}
