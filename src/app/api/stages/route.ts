import { NextResponse } from "next/server";
import { createStage } from "@/data/stage-repository";
import { isOwner } from "@/auth";
import {
  apiErrorResponse,
  ownerRequiredResponse,
  sameOriginRequiredResponse,
} from "@/http/api-error";
import { parseStageInput } from "@/http/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const input = await parseStageInput(request);
    return NextResponse.json({ stage: createStage(input) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "create-stage");
  }
}
