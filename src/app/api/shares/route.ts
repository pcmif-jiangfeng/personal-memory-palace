import { NextResponse } from "next/server";
import { isOwner } from "@/auth";
import { configureShare, disableShare } from "@/data/share-repository";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
  try { const input = await request.json() as { memoryId?: string; enabled?: boolean; mode?: "link" | "password"; password?: string }; if (!input.memoryId) throw new Error("MEMORY_REQUIRED"); if (input.enabled === false) { disableShare(input.memoryId); return NextResponse.json({ ok: true }); } const token = configureShare(input.memoryId, input.mode ?? "link", input.password); return NextResponse.json({ token, url: `/share/${token}` }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "SHARE_FAILED" }, { status: 400 }); }
}
