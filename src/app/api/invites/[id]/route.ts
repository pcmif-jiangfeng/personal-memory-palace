import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { revokeOwnInviteInDatabase } from "@/data/invite-management";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { currentUser } from "@/user-auth";
import { requestMuseumSelection } from "@/http/museum-selection";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { id } = await context.params;
    return NextResponse.json(
      {
        invite: revokeOwnInviteInDatabase(
          getDatabase(),
          user.id,
          id,
          requestMuseumSelection(request),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "invite-revoke");
  }
}
