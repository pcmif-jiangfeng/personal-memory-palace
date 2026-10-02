import type { EmailCodePurpose } from "../data/email-code.ts";
import { getEmailConfiguration, sendTransactionalEmail } from "./transactional-email.ts";

export function codeEmailMessage(email: string, code: string, purpose: EmailCodePurpose) {
  if (!/^\d{6}$/.test(code)) throw new Error("Email code must contain six digits");
  const label = { REGISTER: "验证邮箱", RESET_PASSWORD: "找回密码", CHANGE_PASSWORD: "修改密码" }[
    purpose
  ];
  return {
    to: email,
    subject: `个人记忆宫殿 · ${label}`,
    text: `你的${label}验证码是 ${code}，10分钟内有效，仅可使用一次。请勿向他人透露。若非本人操作，请忽略。`,
    html: `<p>你的${label}验证码：</p><p><strong>${code}</strong></p><p>10分钟内有效，仅可使用一次。请勿向他人透露。若非本人操作，请忽略。</p>`,
  };
}

export async function sendCodeEmail(email: string, code: string, purpose: EmailCodePurpose) {
  await sendTransactionalEmail(codeEmailMessage(email, code, purpose), getEmailConfiguration());
}
