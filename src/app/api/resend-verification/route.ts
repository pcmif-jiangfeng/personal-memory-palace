import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { resendVerificationEmail } from "@/email/resend-verification";
import { getEmailConfiguration, sendVerificationEmail } from "@/email/verification-email";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseResendVerification } from "@/http/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";

const resendLimit = { limit: 5, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limit = consumeRateLimit(clientRateLimitKey(request, "resend-verification"), resendLimit);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { email } = await parseResendVerification(request);
    const configuration = getEmailConfiguration();
    await resendVerificationEmail(getDatabase(), email, (address, token) =>
      sendVerificationEmail(address, token, configuration),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "resend-verification");
  }
}
