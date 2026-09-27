import { publicSiteUrl } from "../domain/share-links.ts";
import { sendTransactionalEmail, type EmailConfiguration } from "./transactional-email.ts";

export function passwordResetLink(token: string): string {
  return `${new URL("reset-password", publicSiteUrl).href}#${token}`;
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  configuration: EmailConfiguration,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const link = passwordResetLink(token);
  await sendTransactionalEmail(
    {
      to: email,
      subject: "重设你的个人记忆宫殿密码",
      text: `请打开以下链接重设密码。链接在 1 小时后失效：\n${link}\n如果这不是你发起的请求，请忽略这封邮件。`,
      html: `<p>请在 1 小时内重设你的密码：</p><p><a href="${link}">重设密码</a></p><p>如果这不是你发起的请求，请忽略这封邮件。</p>`,
    },
    configuration,
    fetcher,
  );
}
