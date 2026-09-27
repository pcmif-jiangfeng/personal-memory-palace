import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { verifyEmailVerificationTokenInDatabase } from "@/data/email-verification";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseEmailVerification } from "@/http/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";

const verificationLimit = { limit: 10, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limit = consumeRateLimit(
    clientRateLimitKey(request, "email-verification"),
    verificationLimit,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { token } = await parseEmailVerification(request);
    if (!verifyEmailVerificationTokenInDatabase(getDatabase(), token)) {
      return NextResponse.json({ error: "INVALID_VERIFICATION_TOKEN" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "email-verification");
  }
}
