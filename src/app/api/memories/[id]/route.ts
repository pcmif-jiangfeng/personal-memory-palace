import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { manageScopedMemory, readScopedMemory } from "@/data/scoped-memory";
import { memoryRequestScope } from "@/memory-request-scope";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseMemoryAction } from "@/http/schemas";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    const memory = readScopedMemory(getDatabase(), scope, id);
    return NextResponse.json({ memory }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "read-memory");
  }
}
export async function POST(request: Request, { params }: Context) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    const version = manageScopedMemory(getDatabase(), scope, id, await parseMemoryAction(request));
    return NextResponse.json({ ok: true, version });
  } catch (error) {
    return apiErrorResponse(error, "manage-memory");
  }
}
