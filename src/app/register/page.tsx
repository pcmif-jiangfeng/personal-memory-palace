import { RegisterForm } from "@/components/register-form";

export default function RegisterPage() {
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>建立你的账号</h1>
        <p>留下邮箱与展示名称，为未来的数字人生博物馆准备一把属于自己的钥匙。</p>
        <RegisterForm />
      </div>
    </section>
  );
}
