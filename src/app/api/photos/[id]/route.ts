import { NextResponse } from "next/server";
import { memoryRequestScope } from "@/memory-request-scope";
import { getDatabase } from "@/data/database";
import { imageStorage } from "@/storage/local-image-storage";
import { deleteUploadedPhotoInDatabase } from "@/data/photo-deletion-service";
import { MAX_IDENTIFIER_LENGTH } from "@/domain/rules";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH) {
      return NextResponse.json({ error: "INVALID_PHOTO_ID" }, { status: 400 });
    }
    return NextResponse.json(
      await deleteUploadedPhotoInDatabase(getDatabase(), imageStorage, id, scope),
    );
  } catch (error) {
    return apiErrorResponse(error, "delete-photo");
  }
}
