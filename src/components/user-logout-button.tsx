"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/client/http-client";

export function UserLogoutButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setError("");
    setSubmitting(true);
    try {
      await requestJson("/api/user-auth", { method: "DELETE" }, (payload) => {
        if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true) {
          throw new TypeError("Invalid logout response");
        }
        return true;
      });
      router.replace("/account/login");
      router.refresh();
    } catch {
      setError("登出未完成，请重试。");
      setSubmitting(false);
    }
  }

  return (
    <div className="login-form">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-primary" type="button" disabled={submitting} onClick={logout}>
        {submitting ? "正在登出…" : "登出账号"}
      </button>
    </div>
  );
}
