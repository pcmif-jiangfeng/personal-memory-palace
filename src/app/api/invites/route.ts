import { NextResponse } from "next/server";
import { sameOriginRequiredResponse } from "@/http/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Task13B: retain historical records, but never execute legacy collaboration operations.
export async function GET() {
  return NextResponse.json(
    { error: "COLLABORATION_RETIRED" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  return NextResponse.json({ error: "COLLABORATION_RETIRED" }, { status: 410 });
}
