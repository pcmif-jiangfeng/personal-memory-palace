import { ResetPasswordForm } from "@/components/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>设置新密码</h1>
        <p>新密码至少需要 8 个字符。更新后，所有已登录设备都需要重新登录。</p>
        <ResetPasswordForm />
      </div>
    </section>
  );
}
