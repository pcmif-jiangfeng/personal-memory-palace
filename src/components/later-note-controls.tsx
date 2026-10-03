"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClientApiError, requestJson } from "@/client/http-client";
import { memoryMuseumUrl } from "@/client/memory-museum-url";
import type { LaterNote } from "@/domain/models";
import { LATER_NOTE_MAX_LENGTH } from "@/domain/rules";

export function LaterNoteControls({
  note,
  museumId,
  isAuthor,
  isOwner,
}: {
  note: LaterNote;
  museumId: string;
  isAuthor: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = useState(note.content);
  const [version, setVersion] = useState(note.version);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  if (!isAuthor && !isOwner) return null;

  async function send(action: "update" | "trash" | "restore" | "permanent") {
    if (busy) return;
    if (
      (action === "trash" || action === "permanent") &&
      !window.confirm(
        action === "permanent" ? "永久删除这条注记？此操作不可恢复。" : "将这条注记移入回收站？",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    setConflict(false);
    try {
      const saved = await requestJson(
        memoryMuseumUrl(`/api/later-notes/${encodeURIComponent(note.id)}`, museumId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(action === "update" ? { content, version } : {}),
            ...(action === "permanent" ? { confirm: true } : {}),
          }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("ok" in payload) ||
            payload.ok !== true ||
            !("version" in payload) ||
            (action === "permanent"
              ? payload.version !== null
              : typeof payload.version !== "number" ||
                !Number.isSafeInteger(payload.version) ||
                payload.version < 1)
          )
            throw new TypeError("Invalid Note response");
          return payload.version as number | null;
        },
      );
      if (saved !== null) setVersion(saved);
      setMessage("注记操作已保存。");
      router.refresh();
    } catch (error) {
      const stale = error instanceof ClientApiError && error.code === "LATER_NOTE_VERSION_CONFLICT";
      setConflict(stale);
      setMessage(
        stale
          ? "这条注记已被更新，草稿仍保留。请复制后重新加载。"
          : "操作未完成，输入仍保留。请确认权限或稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="later-note" data-note-id={note.id}>
      <p>
        作者：{note.authorDisplayName || "历史作者未知"}
        {note.trashedAt ? " · 已移入回收站" : ""}
      </p>
      {isAuthor && !note.trashedAt ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send("update");
          }}
        >
          <label className="form-field">
            <span>编辑我的注记</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              required
              maxLength={LATER_NOTE_MAX_LENGTH}
              rows={4}
            />
          </label>
          <button className="button-secondary" disabled={busy}>
            保存注记修改
          </button>
        </form>
      ) : (
        <p>{note.content}</p>
      )}
      <div className="stage-form-actions">
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => void send(note.trashedAt ? "restore" : "trash")}
        >
          {note.trashedAt ? "恢复注记" : "移入注记回收站"}
        </button>
        {isOwner && note.trashedAt ? (
          <button
            className="text-button danger"
            type="button"
            disabled={busy}
            onClick={() => void send("permanent")}
          >
            永久删除注记
          </button>
        ) : null}
      </div>
      {message ? <p role="status">{message}</p> : null}
      {conflict ? (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            if (window.confirm("重新加载会丢弃未保存草稿，请先复制。是否继续？"))
              window.location.reload();
          }}
        >
          重新加载注记
        </button>
      ) : null}
    </article>
  );
}
