import { ResendVerificationForm } from "@/components/resend-verification-form";

export default function ResendVerificationPage() {
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>重新发送验证邮件</h1>
        <p>输入注册时使用的邮箱。如果账号尚未验证，我们会发送新的验证链接。</p>
        <ResendVerificationForm />
      </div>
    </section>
  );
}
