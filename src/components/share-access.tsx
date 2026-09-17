"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
        else setError("访问密码不正确。");
      }}
    >
      <label className="form-field">
        <span>访问密码</span>
        <input name="password" type="password" required autoFocus />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="button-primary">进入展览</button>
    </form>
  );
}
