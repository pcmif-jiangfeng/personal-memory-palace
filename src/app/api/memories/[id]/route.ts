import { NextResponse } from "next/server";
import { addLaterNote, permanentlyDeleteMemory, trashMemory, updateMemoryRelations, restoreMemory } from "@/data/management-repository";
import { isOwner } from "@/auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
  const { id } = await params;
  try {
    const input = await request.json() as { action?: string; content?: string; relatedMemoryIds?: string[]; confirm?: boolean };
    if (input.action === "note") addLaterNote(id, input.content ?? "");
    else if (input.action === "relations") updateMemoryRelations(id, input.relatedMemoryIds ?? []);
    else if (input.action === "trash") trashMemory(id);
    else if (input.action === "restore") restoreMemory(id);
    else if (input.action === "permanent" && input.confirm) permanentlyDeleteMemory(id);
    else throw new Error("INVALID_ACTION");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "REQUEST_FAILED" }, { status: 400 });
  }
}
