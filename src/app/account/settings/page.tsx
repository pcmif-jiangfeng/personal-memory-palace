import { redirect } from "next/navigation";
import { AccountProfileForm } from "@/components/account-profile-form";
import { UserLogoutButton } from "@/components/user-logout-button";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";
import { copy } from "@/i18n/zh-CN";
import { EmailCodeForm } from "@/components/email-code-form";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  return (
    <section className="section-shell account-settings">
      <h1>{copy.account.title}</h1>
      <p>{copy.account.description}</p>
      <section className="account-settings-section" aria-labelledby="account-info-title">
        <h2 id="account-info-title">账号信息</h2>
        <dl className="account-email">
          <dt>{copy.account.email}</dt>
          <dd>{user.email}</dd>
          <dt>验证状态</dt>
          <dd>{copy.account.verified}</dd>
        </dl>
        <p>{copy.account.emailHelp}</p>
        <AccountProfileForm key={user.id} nickname={user.displayName} />
      </section>
      <section className="account-settings-section" aria-labelledby="account-security-title">
        <h2 id="account-security-title">账号安全</h2>
        <details className="account-password">
          <summary>{copy.account.password}</summary>
          <p>{copy.account.passwordHelp}</p>
          <EmailCodeForm purpose="CHANGE_PASSWORD" email={user.email} />
        </details>
        <UserLogoutButton label={copy.account.logout} className="button-secondary" />
      </section>
    </section>
  );
}
