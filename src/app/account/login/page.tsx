import Link from "next/link";
import { redirect } from "next/navigation";
import { UserLoginForm } from "@/components/user-login-form";
import { currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function UserLoginPage() {
  if (await currentUser()) redirect("/account");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>邮箱账号登录</h1>
        <p>使用已验证的邮箱，继续你的数字人生博物馆之旅。</p>
        <UserLoginForm />
        <p>
          还没有账号？<Link href="/register">创建账号</Link>
        </p>
      </div>
    </section>
  );
}
