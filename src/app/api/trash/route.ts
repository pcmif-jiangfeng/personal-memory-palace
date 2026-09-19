import { NextResponse } from "next/server";
import {
  permanentlyDeleteMemory,
  permanentlyDeleteStage,
  restoreMemory,
  restoreStage,
  trashMemory,
  trashStage,
} from "@/data/management-repository";
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
    const handlers =
      input.type === "memory"
        ? { trash: trashMemory, restore: restoreMemory, permanent: permanentlyDeleteMemory }
        : { trash: trashStage, restore: restoreStage, permanent: permanentlyDeleteStage };
    handlers[input.action](input.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "manage-trash");
  }
}
