import { NextResponse } from "next/server";
import {
  addLaterNote,
  permanentlyDeleteMemory,
  restoreMemory,
  trashMemory,
  updateMemoryDetails,
  updateMemoryRelations,
} from "@/data/management-repository";
import { isOwner } from "@/auth";
import { apiErrorResponse, ownerRequiredResponse } from "@/http/api-error";
import { parseMemoryAction } from "@/http/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return ownerRequiredResponse();
  const { id } = await params;
  try {
    const input = await parseMemoryAction(request);
    if (input.action === "details") {
      updateMemoryDetails(id, input);
    } else if (input.action === "note") {
      addLaterNote(id, input.content);
    } else if (input.action === "relations") {
      updateMemoryRelations(id, input.relatedMemoryIds);
    } else if (input.action === "trash") {
      trashMemory(id);
    } else if (input.action === "restore") {
      restoreMemory(id);
    } else {
      permanentlyDeleteMemory(id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "manage-memory");
  }
}
