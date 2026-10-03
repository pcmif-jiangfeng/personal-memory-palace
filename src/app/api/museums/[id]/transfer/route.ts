import { NextResponse } from "next/server";
import { sameOriginRequiredResponse, apiErrorResponse } from "@/http/api-error";
import { getDatabase } from "@/data/database";
import { requireMuseumAccessInDatabase } from "@/data/museum-access";
import {
  createOwnerTransferRequestInDatabase,
  resolveOwnerTransferRequestInDatabase,
} from "@/data/owner-transfer-requests";
import { parseOwnerTransferAction } from "@/http/owner-transfer-request";
import { currentUser } from "@/user-auth";
import { ApiError } from "@/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) throw new ApiError("USER_REQUIRED", 401);
    const { id } = await params;
    const database = getDatabase();
    const access = requireMuseumAccessInDatabase(database, user.id, id);
    if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
    const input = await parseOwnerTransferAction(request);
    if (input.action === "request") {
      const transfer = createOwnerTransferRequestInDatabase(database, user.id, id, input);
      return NextResponse.json(
        {
          ok: true,
          museumId: id,
          status: transfer.status,
          requestId: transfer.id,
          expiresAt: transfer.expiresAt,
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(resolveOwnerTransferRequestInDatabase(database, user.id, id, input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "museum-transfer-request");
  }
}
