import { NextResponse } from "next/server";
import { createStage, type StageInput } from "@/data/stage-repository";
import { isOwner } from "@/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
  try {
    const input = await request.json() as StageInput;
    return NextResponse.json({ stage: createStage(input) }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SAVE_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
