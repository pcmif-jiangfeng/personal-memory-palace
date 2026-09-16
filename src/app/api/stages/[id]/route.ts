import { NextResponse } from "next/server";
import { updateStage, type StageInput } from "@/data/stage-repository";
import { trashStage } from "@/data/management-repository";
import { isOwner } from "@/auth";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
  try {
    const { id } = await params;
    const input = await request.json() as StageInput;
    return NextResponse.json({ stage: updateStage(id, input) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SAVE_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
  try {
    trashStage((await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "DELETE_FAILED" }, { status: 400 });
  }
}
