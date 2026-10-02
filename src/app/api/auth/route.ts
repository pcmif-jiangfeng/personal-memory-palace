import { NextResponse } from "next/server";
import { expiredOwnerCookie } from "@/auth";
import { sameOriginRequiredResponse } from "@/http/api-error";
export async function POST() {
  return NextResponse.json({ error: "LEGACY_AUTH_REMOVED" }, { status: 410 });
}
export async function DELETE(request: Request) {
  const error = sameOriginRequiredResponse(request);
  if (error) return error;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(expiredOwnerCookie());
  return response;
}
