import { NextResponse } from "next/server";
import { copyPhotoToMuseum } from "@/application/cross-museum-photo-copy";
import { getDatabase } from "@/data/database";
import { ApiError } from "@/http/errors";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseMuseumCopyTarget } from "@/http/museum-copy";
import { memoryRequestScope } from "@/memory-request-scope";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError("INVALID_PHOTO_ID", 400);
    const targetMuseumId = await parseMuseumCopyTarget(request);
    const photo = await copyPhotoToMuseum(getDatabase(), scope, id, targetMuseumId);
    return NextResponse.json(
      { photoId: photo.id, museumId: targetMuseumId },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "photo-copy");
  }
}
