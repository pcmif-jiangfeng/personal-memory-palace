import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import { transferMuseumOwnerInDatabase } from "@/data/museum-owner-transfer";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { ApiError } from "@/http/errors";
import { parseMuseumOwnerTransfer } from "@/http/museum-owner-transfer";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError("INVALID_MUSEUM_ID", 400);
    const database = getDatabase();
    requireMuseumOwnerInDatabase(database, user.id, id);
    const input = await parseMuseumOwnerTransfer(request);
    return NextResponse.json(transferMuseumOwnerInDatabase(database, user.id, id, input), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "museum-owner-transfer");
  }
}
