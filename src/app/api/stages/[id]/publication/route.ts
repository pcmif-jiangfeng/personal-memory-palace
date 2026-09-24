import { NextResponse } from "next/server";
import { isOwner } from "@/auth";
import { setStagePublic } from "@/data/publication-repository";
import {
  apiErrorResponse,
  ownerRequiredResponse,
  sameOriginRequiredResponse,
} from "@/http/api-error";
import { readJsonObject } from "@/http/schemas";
import { ApiError } from "@/http/errors";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const input = await readJsonObject(request);
    if (typeof input.isPublic !== "boolean") throw new ApiError("INVALID_IS_PUBLIC", 400);
    setStagePublic((await params).id, input.isPublic);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "set-stage-publication");
  }
}
