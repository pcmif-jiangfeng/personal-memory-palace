import { NextResponse } from "next/server";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { listEmailInvitesInDatabase } from "@/data/email-invites";
import { createAndSendEmailInviteInDatabase } from "@/application/collaboration-invites";
import { sendCollaborationInviteEmail } from "@/email/collaboration-invites";
import { getEmailConfiguration } from "@/email/transactional-email";
import { parseEmailInviteCreation } from "@/http/email-invites";
import { requestMuseumSelection } from "@/http/museum-selection";
import { readInvitePage } from "@/http/invite-management";
import { ApiError } from "@/http/errors";
import { consumeRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const museumId = requestMuseumSelection(request);
    if (!museumId) throw new ApiError("MUSEUM_SELECTION_REQUIRED", 400);
    const pages = new URL(request.url).searchParams.getAll("page");
    if (pages.length > 1) throw new ApiError("INVALID_PAGE", 400);
    const result = listEmailInvitesInDatabase(
      getDatabase(),
      user.id,
      museumId,
      readInvitePage(pages[0] ?? null),
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "email-invites-list");
  }
}

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const museumId = requestMuseumSelection(request);
    if (!museumId) throw new ApiError("MUSEUM_SELECTION_REQUIRED", 400);
    const input = await parseEmailInviteCreation(request);
    // Temporary abuse protection, not a product cap on palace/member counts.
    const limit = consumeRateLimit(`collaboration-invite:${user.id}`, {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.allowed)
      return NextResponse.json(
        { error: "INVITE_RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    const result = await createAndSendEmailInviteInDatabase(
      getDatabase(),
      user.id,
      museumId,
      input.targetEmail,
      (invite) => sendCollaborationInviteEmail(invite, getEmailConfiguration()),
    );
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error, "email-invites-create");
  }
}
