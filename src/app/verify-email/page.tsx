import { EmailCodeForm } from "@/components/email-code-form";
import { UserLogoutButton } from "@/components/user-logout-button";
import { currentSessionUser } from "@/user-auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function VerifyEmailPage() {
  const user = await currentSessionUser();
  if (!user) redirect("/account/login");
  if (user.emailVerified) redirect("/");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>验证你的邮箱</h1>
        <p>验证邮箱后才能进入你的私人记忆宫殿。</p>
        <EmailCodeForm purpose="REGISTER" email={user.email} />
        <UserLogoutButton label="退出登录" className="button-secondary" />
      </div>
    </section>
  );
}
