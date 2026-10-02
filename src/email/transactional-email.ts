import { ApiError } from "../http/errors.ts";
import { randomUUID } from "node:crypto";

export class EmailDeliveryError extends Error {
  readonly status: number;
  readonly providerCode: string;
  readonly requestId: string;
  readonly providerRequestId: string | null;
  constructor(
    status: number,
    providerCode: string,
    requestId: string,
    providerRequestId: string | null,
  ) {
    super(`Email provider failure: ${status} ${providerCode}; request ${requestId}`);
    this.name = "EmailDeliveryError";
    this.status = status;
    this.providerCode = providerCode;
    this.requestId = requestId;
    this.providerRequestId = providerRequestId;
  }
}

const providerCodes = new Set([
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "suspended_api_key",
  "invalid_permission",
  "invalid_parameter",
  "missing_required_field",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "rate_limit_exceeded",
  "application_error",
  "service_unavailable",
  "internal_server_error",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
): Promise<{ requestId: string; messageId: string | null }> {
  const requestId = randomUUID();
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: configuration.from, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    const error = new EmailDeliveryError(0, "NETWORK_OR_TIMEOUT", requestId, null);
    console.error("[email-delivery]", {
      status: error.status,
      providerCode: error.providerCode,
      requestId,
    });
    throw error;
  }
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const name = payload && typeof payload === "object" && "name" in payload ? payload.name : null;
    const providerCode =
      typeof name === "string" && providerCodes.has(name) ? name : "UNCLASSIFIED_PROVIDER_ERROR";
    const header = response.headers.get("x-request-id");
    const providerRequestId = header && uuidPattern.test(header) ? header : null;
    // Never log provider text, recipients, message contents, API keys or raw network errors.
    console.error("[email-delivery]", {
      status: response.status,
      providerCode,
      requestId,
      providerRequestId,
    });
    throw new EmailDeliveryError(response.status, providerCode, requestId, providerRequestId);
  }
  // Acceptance is useful for log correlation, but is not proof of inbox delivery.
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const id = payload && typeof payload === "object" && "id" in payload ? payload.id : null;
  return { requestId, messageId: typeof id === "string" && uuidPattern.test(id) ? id : null };
}
