import Link from "next/link";
import { redirect } from "next/navigation";
import { requireVerifiedPageUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function AccountDeletionPage() {
  const user = await requireVerifiedPageUser();
  if (!user) redirect("/account/login");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <h1>账号与宫殿保留</h1>
        <p role="status">当前不提供账号注销或私人宫殿整馆删除。</p>
        <p>你的账号、照片和记忆将继续保留。本页不会发起删除或更改历史状态。</p>
        <Link href="/account">返回账号</Link>
      </div>
    </section>
  );
}
