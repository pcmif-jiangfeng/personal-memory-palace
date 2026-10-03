import { NextResponse } from "next/server";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import { removeMuseumCollaboratorInDatabase } from "@/data/museum-collaborators";
import { scheduleMuseumNotificationDelivery } from "@/email/after-museum-notifications";
import { readJsonObject } from "@/http/schemas";
import { ApiError } from "@/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { id, userId } = await params;
    const database = getDatabase();
    requireMuseumOwnerInDatabase(database, user.id, id);
    const input = await readJsonObject(request);
    if (input.confirm !== true || Object.keys(input).some((key) => key !== "confirm"))
      throw new ApiError("INVALID_MEMBER_REMOVAL_INPUT", 400);
    const result = removeMuseumCollaboratorInDatabase(database, user.id, id, userId);
    scheduleMuseumNotificationDelivery(database, id);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "museum-collaborator-remove");
  }
}
