import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { codeEmailMessage } from "../src/email/code-email.ts";
import {
  getEmailConfiguration,
  sendTransactionalEmail,
  EmailDeliveryError,
} from "../src/email/transactional-email.ts";

/** Explicitly requested test messages only. No User, Session or valid verification grant is created. */
export async function testEmailDelivery(addresses: string[], fetcher: typeof fetch = fetch) {
  const supported = new Set(["qq.com", "163.com", "126.com", "outlook.com", "gmail.com"]);
  if (
    !addresses.length ||
    addresses.length > 5 ||
    addresses.some(
      (email) =>
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !supported.has(email.split("@")[1].toLowerCase()),
    )
  )
    throw new Error("Provide 1–5 user-controlled QQ/163/126/Outlook/Gmail test addresses");
  const configuration = getEmailConfiguration();
  const results = [];
  for (const email of addresses) {
    const code = String(randomInt(1_000_000)).padStart(6, "0");
    const message = codeEmailMessage(email, code, "REGISTER");
    message.subject = `[投递测试] ${message.subject}`;
    message.text += "\n这是投递验收邮件，验证码不绑定任何账号，不能用于登录或验证。";
    message.html += "<p>这是投递验收邮件，验证码不绑定任何账号，不能用于登录或验证。</p>";
    const sentAt = new Date().toISOString();
    const domain = email.split("@")[1].toLowerCase();
    try {
      const receipt = await sendTransactionalEmail(message, configuration, fetcher);
      results.push({
        domain,
        sentAt,
        acceptedAt: new Date().toISOString(),
        providerStatus: "accepted",
        ...receipt,
        inboxStatus: "requires-recipient-check",
      });
    } catch (error) {
      results.push({
        domain,
        sentAt,
        providerStatus: "failed",
        status: error instanceof EmailDeliveryError ? error.status : null,
        providerCode: error instanceof EmailDeliveryError ? error.providerCode : "UNAVAILABLE",
        requestId: error instanceof EmailDeliveryError ? error.requestId : null,
        inboxStatus: "not-verified",
      });
    }
    if (email !== addresses.at(-1)) await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [confirmation, ...addresses] = process.argv.slice(2);
  if (confirmation !== "--send") {
    console.error(
      "Usage: node --env-file=.env.local --experimental-strip-types scripts/test-email-delivery.ts --send <your-qq-address> <your-163-address> <your-126-address> <your-outlook-address> <your-gmail-address>",
    );
    process.exitCode = 1;
  } else
    await testEmailDelivery(addresses)
      .then((results) => {
        console.log(JSON.stringify(results, null, 2));
        if (results.some((result) => result.providerStatus === "failed")) process.exitCode = 1;
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Delivery test failed");
        process.exitCode = 1;
      });
}
