"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/client/auth-api";
import { copy } from "@/i18n/zh-CN";
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    try {
      await login(password);
      router.replace("/");
      router.refresh();
    } catch {
      setError(copy.auth.invalidPassword);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label className="form-field">
        <span>{copy.auth.password}</span>
        <input name="password" type="password" required autoFocus />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="button-primary">{copy.auth.enter}</button>
    </form>
  );
}
