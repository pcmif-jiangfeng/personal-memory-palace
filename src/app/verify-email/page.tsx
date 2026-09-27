import { VerifyEmailForm } from "@/components/verify-email-form";

export default function VerifyEmailPage() {
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>验证你的邮箱</h1>
        <p>确认邮箱后，它才能用于后续账号流程。</p>
        <VerifyEmailForm />
      </div>
    </section>
  );
}
