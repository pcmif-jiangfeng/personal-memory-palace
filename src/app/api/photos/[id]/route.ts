import { NextResponse } from "next/server";
import { isOwner } from "@/auth";
import { deleteUploadedPhoto } from "@/data/photo-deletion";
import { MAX_IDENTIFIER_LENGTH } from "@/domain/rules";
import { apiErrorResponse, ownerRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const { id } = await params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH) {
      return NextResponse.json({ error: "INVALID_PHOTO_ID" }, { status: 400 });
    }
    return NextResponse.json(await deleteUploadedPhoto(id));
  } catch (error) {
    return apiErrorResponse(error, "delete-photo");
  }
}
