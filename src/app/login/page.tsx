import { redirect } from "next/navigation";
import { isOwner } from "@/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await isOwner()) redirect("/");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PRIVATE ARCHIVE</p>
        <h1>进入馆长模式</h1>
        <p>编辑入口受到保护。参观分享链接不需要馆长密码。</p>
        <LoginForm />
      </div>
    </section>
  );
}
