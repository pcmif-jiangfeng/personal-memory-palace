"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/i18n/zh-CN";
export function ShareAccess({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <form
      className="login-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const password = new FormData(event.currentTarget).get("password");
        const response = await fetch("/api/share-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });
        if (response.ok) router.refresh();
        else setError(copy.share.invalidPassword);
      }}
    >
      <label className="form-field">
        <span>{copy.share.password}</span>
        <input name="password" type="password" required autoFocus />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="button-primary">{copy.share.enter}</button>
    </form>
  );
}
