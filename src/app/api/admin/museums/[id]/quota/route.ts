import { NextResponse } from "next/server";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { requirePlatformAdminInDatabase } from "@/data/platform-admin";
import { adjustMuseumQuotaInDatabase } from "@/data/platform-admin-quota";
import { parseQuotaAdjustment } from "@/http/platform-admin-quota";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    const database = getDatabase();
    const actorUserId = requirePlatformAdminInDatabase(database, user?.id ?? null);
    const input = await parseQuotaAdjustment(request);
    const { id } = await params;
    const result = adjustMuseumQuotaInDatabase(database, actorUserId, id, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "admin-quota-update");
  }
}
