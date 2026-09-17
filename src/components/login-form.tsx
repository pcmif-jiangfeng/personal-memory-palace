"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.ok) router.push("/");
    else setError("密码不正确或尚未配置馆长密码。");
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>馆长密码</span>
        <input name="password" type="password" required autoFocus />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="button-primary">进入</button>
    </form>
  );
}
