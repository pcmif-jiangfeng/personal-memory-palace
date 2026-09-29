"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/client/http-client";
import type { InviteSummary } from "@/domain/invites";

export function InviteManagement({
  invites,
  now,
  museumId,
}: {
  invites: InviteSummary[];
  now: string;
  museumId: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState("single-use");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createdLink, setCreatedLink] = useState("");
  const [createdId, setCreatedId] = useState("");

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const days = Number(values.get("expiryDays"));
    setBusy("create");
    setError("");
    setMessage("");
    setCreatedLink("");
    try {
      const result = await requestJson(
        `/api/invites?museumId=${encodeURIComponent(museumId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            useMode: mode,
            maxUses:
              mode === "single-use"
                ? 1
                : values.get("maxUses")
                  ? Number(values.get("maxUses"))
                  : null,
            expiresAt: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
          }),
        },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("token" in payload) ||
            typeof payload.token !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(payload.token) ||
            !("invite" in payload) ||
            !payload.invite ||
            typeof payload.invite !== "object" ||
            !("id" in payload.invite) ||
            typeof payload.invite.id !== "string"
          )
            throw new TypeError("Invalid invite response");
          return { token: payload.token, id: payload.invite.id };
        },
      );
      setCreatedLink(`${window.location.origin}/invite#token=${result.token}`);
      setCreatedId(result.id);
      setMessage("邀请已创建。请复制保存链接，离开页面后不会再次显示。");
      router.refresh();
    } catch {
      setError("创建未确认成功，请先检查列表再决定是否重新创建。");
    } finally {
      setBusy("");
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    setError("");
    setMessage("");
    try {
      await requestJson(
        `/api/invites/${encodeURIComponent(id)}?museumId=${encodeURIComponent(museumId)}`,
        { method: "DELETE" },
        (payload) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("invite" in payload) ||
            !payload.invite ||
            typeof payload.invite !== "object" ||
            !("revokedAt" in payload.invite) ||
            typeof payload.invite.revokedAt !== "string"
          )
            throw new TypeError("Invalid revocation response");
          return true;
        },
      );
      if (createdId === id) setCreatedLink("");
      setMessage("邀请已撤销。");
      router.refresh();
    } catch {
      setError("撤销未确认成功，请刷新列表查看状态后重试。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="login-form">
      <form className="login-form" onSubmit={create}>
        <label className="form-field">
          <span>邀请类型</span>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="single-use">单次邀请</option>
            <option value="multi-use">多次邀请</option>
          </select>
        </label>
        {mode === "multi-use" ? (
          <label className="form-field">
            <span>最多使用次数（留空不限次）</span>
            <input name="maxUses" type="number" min={1} step={1} max={Number.MAX_SAFE_INTEGER} />
          </label>
        ) : null}
        <label className="form-field">
          <span>邀请有效期</span>
          <select name="expiryDays" defaultValue="7">
            <option value="7">7天</option>
            <option value="30">30天</option>
            <option value="0">不设到期时间</option>
          </select>
        </label>
        <button className="button-primary" disabled={Boolean(busy)}>
          {busy === "create" ? "正在创建…" : "创建邀请"}
        </button>
      </form>
      {createdLink ? (
        <label className="form-field">
          <span>新邀请链接（仅显示一次）</span>
          <textarea
            readOnly
            rows={4}
            value={createdLink}
            onFocus={(event) => event.currentTarget.select()}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <h2>已有邀请</h2>
      {invites.length === 0 ? (
        <p>暂无邀请。</p>
      ) : (
        <ul>
          {invites.map((invite) => {
            const status = invite.revokedAt
              ? "已撤销"
              : invite.expiresAt && invite.expiresAt <= now
                ? "已过期"
                : invite.maxUses !== null && invite.usageCount >= invite.maxUses
                  ? "已用完"
                  : "可用";
            return (
              <li key={invite.id}>
                <p>
                  {invite.useMode === "single-use" ? "单次邀请" : "多次邀请"} · {status}
                </p>
                <small>
                  创建：{invite.createdAt.slice(0, 10)} · 使用：{invite.usageCount}/
                  {invite.maxUses ?? "不限"}
                  <br />
                  到期：{invite.expiresAt ? invite.expiresAt.slice(0, 10) : "不设到期时间"}
                </small>
                {!invite.revokedAt ? (
                  <p>
                    <button
                      className="button-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => void revoke(invite.id)}
                    >
                      {busy === invite.id ? "正在撤销…" : "撤销邀请"}
                    </button>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
