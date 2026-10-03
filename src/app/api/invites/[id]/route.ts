import { NextResponse } from "next/server";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { revokeEmailInviteInDatabase } from "@/data/email-invites";
import { requestMuseumSelection } from "@/http/museum-selection";
import { ApiError } from "@/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const museumId = requestMuseumSelection(request);
    if (!museumId) throw new ApiError("MUSEUM_SELECTION_REQUIRED", 400);
    const { id } = await params;
    return NextResponse.json({
      invite: revokeEmailInviteInDatabase(getDatabase(), user.id, museumId, id),
    });
  } catch (error) {
    return apiErrorResponse(error, "email-invite-revoke");
  }
}
