import { NextResponse } from "next/server";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { acceptEmailInviteInDatabase } from "@/data/email-invite-acceptance";
import { parseEmailInviteAcceptance } from "@/http/email-invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Never call the historical bearer-token acceptance service.
export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const input = await parseEmailInviteAcceptance(request);
    return NextResponse.json(acceptEmailInviteInDatabase(getDatabase(), user.id, input.inviteId));
  } catch (error) {
    return apiErrorResponse(error, "email-invites-accept");
  }
}
