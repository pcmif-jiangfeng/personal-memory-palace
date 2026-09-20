import { redirect } from "next/navigation";
import { isOwner } from "@/auth";
import { LoginForm } from "@/components/login-form";
import { copy } from "@/i18n/zh-CN";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await isOwner()) redirect("/");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">{copy.auth.eyebrow}</p>
        <h1>{copy.auth.title}</h1>
        <p>{copy.auth.description}</p>
        <LoginForm />
      </div>
    </section>
  );
}
