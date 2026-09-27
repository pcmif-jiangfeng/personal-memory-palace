import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { resetPasswordInDatabase } from "@/data/password-reset";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parsePasswordResetConfirmation } from "@/http/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";

const confirmLimit = { limit: 10, windowMs: 15 * 60 * 1000 };

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limit = consumeRateLimit(
    clientRateLimitKey(request, "password-reset-confirm"),
    confirmLimit,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const { token, newPassword } = await parsePasswordResetConfirmation(request);
    if (!resetPasswordInDatabase(getDatabase(), token, newPassword)) {
      return NextResponse.json({ error: "INVALID_RESET_TOKEN" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "password-reset-confirm");
  }
}
