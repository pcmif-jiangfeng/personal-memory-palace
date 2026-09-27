import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>找回密码</h1>
        <p>输入注册邮箱，我们会向该邮箱发送重置链接。</p>
        <ForgotPasswordForm />
      </div>
    </section>
  );
}
