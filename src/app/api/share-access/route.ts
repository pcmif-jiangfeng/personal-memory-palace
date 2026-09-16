import { NextResponse } from "next/server";
import { getSharedMemory, getShareAccessCookieValue } from "@/data/share-repository";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const { token, password } = await request.json() as { token?: string; password?: string };
  if (!token || !getSharedMemory(token, password)) return NextResponse.json({ error: "ACCESS_DENIED" }, { status: 401 });
  const accessCookie = getShareAccessCookieValue(token); if (!accessCookie) return NextResponse.json({ error: "ACCESS_DENIED" }, { status: 401 });
  const response = NextResponse.json({ ok: true }); response.cookies.set({ name: `memory_palace_share_${token}`, value: accessCookie, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: `/share/${token}`, maxAge: 60 * 60 * 24 * 30 }); return response;
}
