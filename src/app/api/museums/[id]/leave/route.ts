import { NextResponse } from "next/server";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { leaveMuseumInDatabase } from "@/data/museum-leave";
import { scheduleMuseumNotificationDelivery } from "@/email/after-museum-notifications";
import { readJsonObject } from "@/http/schemas";
import { ApiError } from "@/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { id } = await params;
    const input = await readJsonObject(request);
    if (input.confirm !== true || Object.keys(input).some((key) => key !== "confirm"))
      throw new ApiError("INVALID_LEAVE_INPUT", 400);
    const database = getDatabase();
    const result = leaveMuseumInDatabase(database, user.id, id);
    scheduleMuseumNotificationDelivery(database, id);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "museum-leave");
  }
}
