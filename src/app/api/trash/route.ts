import { NextResponse } from "next/server";
import { permanentlyDeleteMemory, permanentlyDeleteStage, restoreMemory, restoreStage, trashMemory, trashStage } from "@/data/management-repository";
import { isOwner } from "@/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
  try {
    const input = await request.json() as { type?: "memory" | "stage"; id?: string; action?: "trash" | "restore" | "permanent"; confirm?: boolean };
    if (!input.id || !input.type || !input.action) throw new Error("INVALID_ACTION");
    if (input.action === "permanent" && !input.confirm) throw new Error("CONFIRM_REQUIRED");
    const handlers = input.type === "memory"
      ? { trash: trashMemory, restore: restoreMemory, permanent: permanentlyDeleteMemory }
      : { trash: trashStage, restore: restoreStage, permanent: permanentlyDeleteStage };
    handlers[input.action](input.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "REQUEST_FAILED" }, { status: 400 });
  }
}
