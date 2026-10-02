import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { issueEmailCode } from "@/data/email-code";
import { loginUserInDatabase } from "@/data/user-auth";
import { userSessionCookie } from "@/user-auth";
import { registerUserInDatabase } from "@/data/user-registration";
import { sendCodeEmail } from "@/email/code-email";
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
    const user = registerUserInDatabase(getDatabase(), input);
    let verificationEmailSent = true;
    try {
      await issueEmailCode(getDatabase(), user.id, "REGISTER", sendCodeEmail);
    } catch (error) {
      verificationEmailSent = false;
      console.error(
        "[register-code] delivery unavailable",
        error instanceof Error ? error.name : "UNAVAILABLE",
      );
    }
    const login = loginUserInDatabase(getDatabase(), input.email, input.password);
    if (login.status === "invalid")
      throw new Error("Registered account could not establish session");
    const response = NextResponse.json({ id: user.id, verificationEmailSent }, { status: 201 });
    response.cookies.set(userSessionCookie(login.sessionToken));
    return response;
  } catch (error) {
    return apiErrorResponse(error, "user-register");
  }
}
