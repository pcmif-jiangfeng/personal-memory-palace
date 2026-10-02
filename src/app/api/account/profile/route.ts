import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { updateOwnNicknameInDatabase } from "@/data/user-profile";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseNicknameUpdate } from "@/http/user-profile";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { nickname } = await parseNicknameUpdate(request);
    return NextResponse.json(updateOwnNicknameInDatabase(getDatabase(), user.id, nickname));
  } catch (error) {
    return apiErrorResponse(error, "account-profile");
  }
}
