import { NextResponse } from "next/server";
import { findRandomActiveMemory } from "@/data/memory-repository";
import { isOwner } from "@/auth";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
  const memory = findRandomActiveMemory();
  return NextResponse.json({ memory }, { status: memory ? 200 : 404 });
}
