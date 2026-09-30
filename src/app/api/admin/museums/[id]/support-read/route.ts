import { NextResponse } from "next/server";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { requirePlatformAdminInDatabase } from "@/data/platform-admin";
import { readSupportMemoryInDatabase } from "@/data/platform-admin-support";
import { parseSupportRead, validateSupportId } from "@/http/museum-support-access";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const user = await currentUser();
    const database = getDatabase();
    const actorUserId = requirePlatformAdminInDatabase(database, user?.id ?? null);
    const input = await parseSupportRead(request);
    const { id } = await params;
    validateSupportId(id);
    const result = readSupportMemoryInDatabase(
      database,
      actorUserId,
      id,
      input.memoryId,
      input.grantId,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  } catch (error) {
    return apiErrorResponse(error, "admin-support-read");
  }
}
