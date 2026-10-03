import { NextResponse } from "next/server";
import { currentUser } from "@/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json(
    { error: user ? "ACCOUNT_DELETION_DISABLED" : "USER_REQUIRED" },
    { status: user ? 410 : 401, headers: { "Cache-Control": "private, no-store" } },
  );
}
