import { NextResponse } from "next/server";
import { shouldUseSecureCookies } from "@/auth";
import {
  getSharedMemory,
  getShareAccessCookieValue,
  shareAccessCookieName,
} from "@/data/share-repository";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseShareAccess } from "@/http/schemas";
import { clearRateLimit, clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";

const accessLimit = { limit: 10, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limitKey = clientRateLimitKey(request, "share-access");
  const limit = consumeRateLimit(limitKey, accessLimit);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { token, password } = await parseShareAccess(request);
    if (!getSharedMemory(token, password)) {
      return NextResponse.json({ error: "ACCESS_DENIED" }, { status: 401 });
    }
    const accessCookie = getShareAccessCookieValue(token);
    if (!accessCookie) {
      return NextResponse.json({ error: "ACCESS_DENIED" }, { status: 401 });
    }
    clearRateLimit(limitKey);
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: shareAccessCookieName(token),
      value: accessCookie,
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookies(),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    return apiErrorResponse(error, "share-access");
  }
}
