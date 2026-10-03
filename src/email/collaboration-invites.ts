import { publicSiteUrl } from "../domain/share-links.ts";
import { sendTransactionalEmail, type EmailConfiguration } from "./transactional-email.ts";

export async function sendCollaborationInviteEmail(
  invite: { id: string; targetEmail: string; expiresAt: string },
  configuration: EmailConfiguration,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invite.id))
    throw new Error("Invalid invitation locator");
  const expiry = new Date(invite.expiresAt);
  if (!Number.isFinite(expiry.getTime()) || expiry.toISOString() !== invite.expiresAt)
    throw new Error("Invalid invitation expiry");
  const base = process.env.NODE_ENV === "development" ? "http://localhost:3000/" : publicSiteUrl;
  const link = new URL("account/invites", base);
  link.searchParams.set("inviteId", invite.id);
  await sendTransactionalEmail(
    {
      to: invite.targetEmail,
      subject: "个人记忆宫殿 · 协作邀请",
      text: `你收到了宫殿协作邀请。请使用此邮箱注册或登录，验证邮箱后主动接受邀请。转发链接不能授权其他账号。\n截止时间：${invite.expiresAt}\n${link.href}\n如果你不希望加入，可以忽略此邮件。`,
      html: `<p>你收到了宫殿协作邀请。请使用此邮箱注册或登录，验证邮箱后主动接受邀请。</p><p>转发链接不能授权其他账号。</p><p>截止时间：${invite.expiresAt}</p><p><a href="${link.href}">查看邀请</a></p><p>如果你不希望加入，可以忽略此邮件。</p>`,
    },
    configuration,
    fetcher,
  );
}
