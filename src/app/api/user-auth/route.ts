import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { loginUserInDatabase, revokeUserSessionInDatabase } from "@/data/user-auth";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseUserLogin } from "@/http/schemas";
import { clearRateLimit, clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";
import { expiredUserSessionCookie, userCookieName, userSessionCookie } from "@/user-auth";

export const runtime = "nodejs";

const loginLimit = { limit: 8, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limitKey = clientRateLimitKey(request, "user-login");
  const limit = consumeRateLimit(limitKey, loginLimit);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { email, password } = await parseUserLogin(request);
    const result = loginUserInDatabase(getDatabase(), email, password);
    if (result.status === "invalid") {
      return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }
    if (result.status === "unverified") {
      return NextResponse.json({ error: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    }
    clearRateLimit(limitKey);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(userSessionCookie(result.sessionToken));
    return response;
  } catch (error) {
    return apiErrorResponse(error, "user-login");
  }
}

export async function DELETE(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const sessionToken = (await cookies()).get(userCookieName)?.value;
    revokeUserSessionInDatabase(getDatabase(), sessionToken);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(expiredUserSessionCookie());
    return response;
  } catch (error) {
    return apiErrorResponse(error, "user-logout");
  }
}
