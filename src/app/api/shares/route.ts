import { NextResponse } from "next/server";
import { memoryRequestScope } from "@/memory-request-scope";
import { getDatabase } from "@/data/database";
import { configureScopedShare } from "@/data/scoped-share";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseShareConfiguration } from "@/http/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const input = await parseShareConfiguration(request);
    const token = configureScopedShare(getDatabase(), scope, input.memoryId, input);
    if (!token) return NextResponse.json({ ok: true });
    return NextResponse.json({ token, url: `/share/${token}` });
  } catch (error) {
    return apiErrorResponse(error, "configure-share");
  }
}
