import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { requestPasswordResetInDatabase } from "@/data/password-reset";
import { sendPasswordResetEmail } from "@/email/password-reset-email";
import { getEmailConfiguration } from "@/email/transactional-email";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseResendVerification } from "@/http/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";

const requestLimit = { limit: 5, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limit = consumeRateLimit(
    clientRateLimitKey(request, "password-reset-request"),
    requestLimit,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { email } = await parseResendVerification(request);
    const configuration = getEmailConfiguration();
    await requestPasswordResetInDatabase(getDatabase(), email, async (address, token) => {
      try {
        await sendPasswordResetEmail(address, token, configuration);
      } catch {
        // Keep the public response identical whether or not the address exists.
        console.error("[password-reset-request] email delivery failed");
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "password-reset-request");
  }
}
