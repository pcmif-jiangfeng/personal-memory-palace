import { ApiError } from "../http/errors.ts";

export type EmailConfiguration = { apiKey: string; from: string };

export function getEmailConfiguration(): EmailConfiguration {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MEMORY_PALACE_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new ApiError("EMAIL_NOT_CONFIGURED", 503);
  return { apiKey, from };
}

export async function sendTransactionalEmail(
  message: { to: string; subject: string; text: string; html: string },
  configuration: EmailConfiguration,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${configuration.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: configuration.from, ...message }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Transactional email delivery failed");
}
