import { NextResponse } from "next/server";
import { memoryRequestScope } from "@/memory-request-scope";
import { getDatabase } from "@/data/database";
import { manageScopedPhotoTrash } from "@/data/photo-trash";
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
    manageScopedPhotoTrash(getDatabase(), scope, id, "trash");
    return NextResponse.json({ deleted: true, alreadyDeleted: false });
  } catch (error) {
    return apiErrorResponse(error, "delete-photo");
  }
}
