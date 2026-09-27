import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { leaveMuseumInDatabase } from "@/data/museum-leave";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { ApiError } from "@/http/errors";
import { readJsonObject } from "@/http/schemas";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError("INVALID_MUSEUM_ID", 400);
    const input = await readJsonObject(request);
    if (input.confirm !== true) throw new ApiError("LEAVE_CONFIRMATION_REQUIRED", 400);
    return NextResponse.json(leaveMuseumInDatabase(getDatabase(), user.id, id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "museum-leave");
  }
}
