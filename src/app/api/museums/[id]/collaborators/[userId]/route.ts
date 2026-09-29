import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import { removeMuseumCollaboratorInDatabase } from "@/data/museum-collaborators";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { ApiError } from "@/http/errors";
import { readJsonObject } from "@/http/schemas";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";

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
    if (![id, userId].every((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value)))
      throw new ApiError("INVALID_MEMBERSHIP_ID", 400);
    const database = getDatabase();
    requireMuseumOwnerInDatabase(database, user.id, id);
    const input = await readJsonObject(request);
    if (input.confirm !== true || Object.keys(input).some((key) => key !== "confirm"))
      throw new ApiError("REMOVE_CONFIRMATION_REQUIRED", 400);
    return NextResponse.json(removeMuseumCollaboratorInDatabase(database, user.id, id, userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "museum-collaborator-remove");
  }
}
