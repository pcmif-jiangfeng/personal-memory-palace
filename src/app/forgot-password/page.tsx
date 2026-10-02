import { EmailCodeForm } from "@/components/email-code-form";

export default function ForgotPasswordPage() {
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>找回密码</h1>
        <p>通过六位邮箱验证码验证后设置新密码，密码至少八位。</p>
        <EmailCodeForm purpose="RESET_PASSWORD" />
      </div>
    </section>
  );
}
