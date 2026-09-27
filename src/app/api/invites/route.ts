import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { createOwnInviteInDatabase, listOwnInvitesInDatabase } from "@/data/invite-management";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseCreateInvite, readInvitePage } from "@/http/invite-management";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const page = readInvitePage(new URL(request.url).searchParams.get("page"));
    return NextResponse.json(listOwnInvitesInDatabase(getDatabase(), user.id, page), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "invite-list");
  }
}

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const input = await parseCreateInvite(request);
    return NextResponse.json(createOwnInviteInDatabase(getDatabase(), user.id, input), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "invite-create");
  }
}
