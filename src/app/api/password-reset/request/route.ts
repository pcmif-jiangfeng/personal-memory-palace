import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({ error: "LEGACY_EMAIL_LINK_REMOVED" }, { status: 410 });
}
