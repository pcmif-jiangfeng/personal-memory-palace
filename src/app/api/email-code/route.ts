import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import {
  issueEmailCode,
  verifyEmailCode,
  finishPasswordCode,
  type EmailCodePurpose,
} from "@/data/email-code";
import { createOwnMuseumInDatabase } from "@/data/museum-onboarding";
import { findMuseumByOwnerIdInDatabase } from "@/data/museum-repository";
import { withTransaction } from "@/data/transaction";
import { sendCodeEmail } from "@/email/code-email";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { readJsonObject } from "@/http/schemas";
import { ApiError } from "@/http/errors";
import { currentSessionUser } from "@/user-auth";
import { consumeRateLimit, clientRateLimitKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  const limit = consumeRateLimit(clientRateLimitKey(request, "email-code"), {
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  try {
    const input = await readJsonObject(request);
    if (
      Object.keys(input).some(
        (key) =>
          ![
            "purpose",
            "action",
            "email",
            "code",
            "grant",
            "newPassword",
            "confirmPassword",
          ].includes(key),
      )
    )
      throw new ApiError("INVALID_CODE_INPUT", 400);
    if (
      !["REGISTER", "RESET_PASSWORD", "CHANGE_PASSWORD"].includes(String(input.purpose)) ||
      !["SEND", "VERIFY", "CONFIRM"].includes(String(input.action))
    )
      throw new ApiError("INVALID_CODE_INPUT", 400);
    const purpose = input.purpose as EmailCodePurpose;
    const db = getDatabase();
    const session = await currentSessionUser();
    let userId: string | null = null;
    if (purpose === "RESET_PASSWORD") {
      if (
        typeof input.email !== "string" ||
        input.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
      )
        throw new ApiError("INVALID_EMAIL", 400);
      const row = db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(input.email.trim().toLowerCase());
      userId = row ? String(row.id) : null;
    } else {
      if (!session) throw new ApiError("USER_REQUIRED", 401);
      if (purpose === "REGISTER" && session.emailVerified)
        throw new ApiError("EMAIL_ALREADY_VERIFIED", 409);
      if (purpose === "CHANGE_PASSWORD" && !session.emailVerified)
        throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
      userId = session.id;
    }
    if (input.action === "SEND") {
      if (userId) {
        try {
          await issueEmailCode(db, userId, purpose, sendCodeEmail);
        } catch (error) {
          if (purpose !== "RESET_PASSWORD") {
            if (error instanceof ApiError && error.code === "CODE_COOLDOWN") throw error;
            console.error(
              "[email-code] delivery failed",
              error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE",
            );
            throw new ApiError("EMAIL_DELIVERY_FAILED", 502);
          }
          // Identical reset response for missing accounts, cooldowns and delivery failures.
          console.error(
            "[email-code-reset] delivery unavailable",
            error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE",
          );
        }
      }
      return NextResponse.json({ ok: true });
    }
    if (input.action === "VERIFY") {
      if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code))
        throw new ApiError("INVALID_CODE", 400);
      if (!userId) throw new ApiError("INVALID_CODE", 400);
      // A failed verification must commit its attempt count rather than throw inside the transaction.
      const result = withTransaction(db, () => {
        const grant = verifyEmailCode(db, userId!, purpose, input.code as string);
        if (!grant) return null;
        if (purpose === "REGISTER") {
          db.prepare("UPDATE users SET email_verified=1,updated_at=? WHERE id=?").run(
            new Date().toISOString(),
            userId,
          );
          db.prepare("DELETE FROM email_verification_tokens WHERE user_id=?").run(userId);
          if (!findMuseumByOwnerIdInDatabase(db, userId!))
            createOwnMuseumInDatabase(db, userId!, {
              name: `${session!.displayName}的记忆宫殿`,
              slug: `palace-${userId}`,
              description: "",
            });
          db.prepare(
            "UPDATE email_codes SET grant_hash=NULL,grant_expires_at=NULL WHERE user_id=? AND purpose='REGISTER'",
          ).run(userId);
        }
        return grant;
      });
      if (!result) throw new ApiError("INVALID_CODE", 400);
      return NextResponse.json(purpose === "REGISTER" ? { ok: true } : { ok: true, grant: result });
    }
    if (
      purpose === "REGISTER" ||
      !userId ||
      typeof input.grant !== "string" ||
      typeof input.newPassword !== "string" ||
      input.newPassword !== input.confirmPassword
    )
      throw new ApiError("INVALID_PASSWORD_CONFIRMATION", 400);
    if (!finishPasswordCode(db, purpose, input.grant, input.newPassword, userId))
      throw new ApiError("INVALID_CODE_GRANT", 400);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "email-code");
  }
}
