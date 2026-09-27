import { NextResponse } from "next/server";
import { memoryRequestScope } from "@/memory-request-scope";
import { getDatabase } from "@/data/database";
import { archiveScopedPhoto } from "@/data/photo-access";
import { MAX_IDENTIFIER_LENGTH } from "@/domain/rules";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH) {
      return NextResponse.json({ error: "INVALID_PHOTO_ID" }, { status: 400 });
    }
    return NextResponse.json(archiveScopedPhoto(getDatabase(), scope, id));
  } catch (error) {
    return apiErrorResponse(error, "archive-photo");
  }
}
