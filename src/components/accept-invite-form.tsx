"use client";

import { useState, useSyncExternalStore } from "react";
import { ClientApiError, requestJson } from "@/client/http-client";

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
const readToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
const serverToken = () => "";

const errorMessages: Record<string, string> = {
  USER_REQUIRED: "请先登录已验证邮箱的账号，再回到此页面接受邀请。",
  EMAIL_VERIFICATION_REQUIRED: "请先完成邮箱验证。",
  OWN_MUSEUM_REQUIRED: "请先创建自己的 Museum，再回到此页面接受邀请。",
  OWN_INVITE: "这是你自己的 Museum，无需接受邀请。",
  INVALID_INVITE_TOKEN: "邀请链接不完整，请使用馆长提供的完整链接。",
  INVITE_UNAVAILABLE: "邀请已失效、过期、被撤销或达到使用上限，请联系馆长。",
};

export function AcceptInviteForm() {
  const token = useSyncExternalStore(subscribe, readToken, serverToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState("");
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(
        "/api/invites/accept",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("museum" in payload) ||
            !payload.museum ||
            typeof payload.museum !== "object" ||
            !("name" in payload.museum) ||
            typeof payload.museum.name !== "string" ||
            !("alreadyMember" in payload) ||
            typeof payload.alreadyMember !== "boolean"
          )
            throw new TypeError("Invalid invite acceptance response");
          return { name: payload.museum.name, alreadyMember: payload.alreadyMember };
        },
      );
      window.history.replaceState(null, "", window.location.pathname);
      setJoined(
        result.alreadyMember
          ? `你已经是「${result.name}」的协作者。`
          : `已加入「${result.name}」，你现在是这座博物馆的协作者。`,
      );
    } catch (cause) {
      const code = cause instanceof ClientApiError ? cause.code : "";
      setError(
        errorMessages[code] ?? "暂时无法确认结果，请稍后重试；重复接受不会重复加入或扣除使用次数。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-form">
      {joined ? (
        <p role="status">{joined}</p>
      ) : (
        <>
          <p>请保留本页面，在新标签页完成登录、邮箱验证和 Museum 创建，然后返回点击接受。</p>
          <a href="/account" target="_blank" rel="noopener noreferrer">
            登录或创建自己的 Museum（新标签页）
          </a>
          <a href="/register" target="_blank" rel="noopener noreferrer">
            注册账号（新标签页）
          </a>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button-primary"
            disabled={busy || !/^[A-Za-z0-9_-]{43}$/.test(token)}
            onClick={accept}
          >
            {busy ? "正在接受…" : "接受邀请"}
          </button>
          {!token ? <p role="status">请从馆长提供的完整邀请链接进入此页面。</p> : null}
        </>
      )}
      <a href="/account">返回自己的 Museum</a>
    </div>
  );
}
