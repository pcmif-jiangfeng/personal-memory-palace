import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { createEmailVerificationTokenInDatabase } from "@/data/email-verification";
import { registerUserInDatabase } from "@/data/user-registration";
import { getEmailConfiguration, sendVerificationEmail } from "@/email/verification-email";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseUserRegistration } from "@/http/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";

const registrationLimit = { limit: 5, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limit = consumeRateLimit(clientRateLimitKey(request, "user-register"), registrationLimit);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const input = await parseUserRegistration(request);
    const configuration = getEmailConfiguration();
    const user = registerUserInDatabase(getDatabase(), input);
    const token = createEmailVerificationTokenInDatabase(getDatabase(), user.id);
    let verificationEmailSent = true;
    try {
      await sendVerificationEmail(user.email, token, configuration);
    } catch {
      verificationEmailSent = false;
    }
    return NextResponse.json({ ...user, verificationEmailSent }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "user-register");
  }
}
