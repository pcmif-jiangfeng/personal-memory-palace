import { NextResponse } from "next/server";
import { applyTrashBatch } from "@/data/management-repository";
import { isOwner } from "@/auth";
import {
  apiErrorResponse,
  ownerRequiredResponse,
  sameOriginRequiredResponse,
} from "@/http/api-error";
import { parseTrashAction } from "@/http/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  try {
    const input = await parseTrashAction(request);
    const result = applyTrashBatch(input.type, input.action, input.ids);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "manage-trash");
  }
}
