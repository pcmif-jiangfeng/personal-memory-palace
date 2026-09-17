import { NextResponse } from "next/server";
import { expiredOwnerCookie, isOwnerPasswordValid, ownerCookie } from "@/auth";
import { apiErrorResponse } from "@/http/api-error";
import { parseOwnerLogin } from "@/http/schemas";
import { clearRateLimit, clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";

const loginLimit = { limit: 8, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const limitKey = clientRateLimitKey(request, "owner-login");
  const limit = consumeRateLimit(limitKey, loginLimit);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { password } = await parseOwnerLogin(request);
    if (!isOwnerPasswordValid(password)) {
      return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 401 });
    }
    clearRateLimit(limitKey);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ownerCookie());
    return response;
  } catch (error) {
    return apiErrorResponse(error, "owner-login");
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(expiredOwnerCookie());
  return response;
}
