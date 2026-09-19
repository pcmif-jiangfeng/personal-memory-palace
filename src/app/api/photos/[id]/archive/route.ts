import { NextResponse } from "next/server";
import { isOwner } from "@/auth";
import { archiveUploadedPhoto } from "@/data/photo-repository";
import { MAX_IDENTIFIER_LENGTH } from "@/domain/rules";
import {
  apiErrorResponse,
  ownerRequiredResponse,
  sameOriginRequiredResponse,
} from "@/http/api-error";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const { id } = await params;
    if (!id || id.length > MAX_IDENTIFIER_LENGTH) {
      return NextResponse.json({ error: "INVALID_PHOTO_ID" }, { status: 400 });
    }
    return NextResponse.json(archiveUploadedPhoto(id));
  } catch (error) {
    return apiErrorResponse(error, "archive-photo");
  }
}
