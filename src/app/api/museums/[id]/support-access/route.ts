import { NextResponse } from "next/server";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import {
  grantOwnerSupportAccessInDatabase,
  revokeOwnerSupportAccessInDatabase,
} from "@/data/platform-admin-support";
import { parseOwnerSupportAccess, validateSupportId } from "@/http/museum-support-access";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return mutate(request, context, false);
}
export async function DELETE(request: Request, context: Context) {
  return mutate(request, context, true);
}

async function mutate(request: Request, { params }: Context, revoke: boolean) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    const database = getDatabase();
    const { id } = await params;
    validateSupportId(id);
    requireMuseumOwnerInDatabase(database, user?.id ?? null, id);
    const input = await parseOwnerSupportAccess(request, revoke);
    const result = revoke
      ? revokeOwnerSupportAccessInDatabase(database, user?.id ?? null, id, input.id)
      : grantOwnerSupportAccessInDatabase(database, user?.id ?? null, id, input.id, input.confirm);
    return NextResponse.json(result, {
      status: revoke ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "museum-support-access");
  }
}
