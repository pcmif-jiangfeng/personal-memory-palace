import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { acceptInviteInDatabase } from "@/data/invite-acceptance";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { ApiError } from "@/http/errors";
import { readJsonObject } from "@/http/schemas";
import { currentUser } from "@/user-auth";
import { scheduleMuseumNotificationDelivery } from "@/email/after-museum-notifications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const input = await readJsonObject(request);
    if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.token))
      throw new ApiError("INVALID_INVITE_TOKEN", 400);
    const database = getDatabase();
    const result = acceptInviteInDatabase(database, user.id, input.token);
    scheduleMuseumNotificationDelivery(database, result.museum.id);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "invite-accept");
  }
}
