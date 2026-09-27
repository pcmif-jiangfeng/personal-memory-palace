import { AcceptInviteForm } from "@/components/accept-invite-form";

export default function InvitePage() {
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>接受协作者邀请</h1>
        <p>加入另一座人生博物馆。接受邀请前，请验证邮箱并创建自己的 Museum。</p>
        <AcceptInviteForm />
      </div>
    </section>
  );
}
