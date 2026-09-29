import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import {
  cancelMuseumDeletionInDatabase,
  readMuseumDeletionInDatabase,
  scheduleMuseumDeletionInDatabase,
} from "@/data/museum-deletion";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { ApiError } from "@/http/errors";
import { parseMuseumDeletionConfirmation } from "@/http/museum-deletion";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await currentUser();
    const { id } = await params;
    validateId(id);
    return NextResponse.json(readMuseumDeletionInDatabase(getDatabase(), user?.id ?? null, id), {
      headers: noStore,
    });
  } catch (error) {
    return apiErrorResponse(error, "museum-deletion-read");
  }
}

export async function POST(request: Request, context: Context) {
  return mutate(request, context, false);
}

// DELETE removes the deletion plan, not the Museum or any physical assets.
export async function DELETE(request: Request, context: Context) {
  return mutate(request, context, true);
}

async function mutate(request: Request, { params }: Context, cancel: boolean) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "USER_REQUIRED" }, { status: 401 });
    const { id } = await params;
    validateId(id);
    const database = getDatabase();
    requireMuseumOwnerInDatabase(database, user.id, id);
    const input = await parseMuseumDeletionConfirmation(request);
    const result = cancel
      ? cancelMuseumDeletionInDatabase(database, user.id, id, input)
      : scheduleMuseumDeletionInDatabase(database, user.id, id, input);
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    return apiErrorResponse(error, "museum-deletion-write");
  }
}

function validateId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError("INVALID_MUSEUM_ID", 400);
}
