import { NextResponse } from "next/server";
import { updateStage } from "@/data/stage-repository";
import { trashStage } from "@/data/management-repository";
import { isOwner } from "@/auth";
import {
  apiErrorResponse,
  ownerRequiredResponse,
  sameOriginRequiredResponse,
} from "@/http/api-error";
import { parseStageInput } from "@/http/schemas";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const { id } = await params;
    const input = await parseStageInput(request);
    return NextResponse.json({ stage: updateStage(id, input) });
  } catch (error) {
    return apiErrorResponse(error, "update-stage");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    trashStage((await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "trash-stage");
  }
}
