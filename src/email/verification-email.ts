import { accountEmailLink } from "./account-email-link.ts";
import { sendTransactionalEmail, type EmailConfiguration } from "./transactional-email.ts";

export { getEmailConfiguration, type EmailConfiguration } from "./transactional-email.ts";

export function verificationLink(token: string): string {
  return accountEmailLink("verify-email", token);
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  configuration: EmailConfiguration,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const link = verificationLink(token);
  await sendTransactionalEmail(
    {
      to: email,
      subject: "验证你的个人记忆宫殿邮箱",
      text: `请打开以下链接验证邮箱。链接在 24 小时后失效：\n${link}`,
      html: `<p>欢迎来到个人记忆宫殿。请在 24 小时内验证你的邮箱：</p><p><a href="${link}">验证邮箱</a></p><p>如果这不是你发起的注册，可以忽略这封邮件。</p>`,
    },
    configuration,
    fetcher,
  );
}
