import { NextResponse } from "next/server";
import { isOwnerPasswordValid, ownerCookie } from "@/auth";
export const runtime = "nodejs";
export async function POST(request: Request) { const { password } = await request.json() as { password?: string }; if (!password || !isOwnerPasswordValid(password)) return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 401 }); const response = NextResponse.json({ ok: true }); response.cookies.set(ownerCookie()); return response; }
export async function DELETE() { const response = NextResponse.json({ ok: true }); response.cookies.delete("memory_palace_owner"); return response; }
