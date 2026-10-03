import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { createMemoryInDatabase } from "@/data/memory-write-repository";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseCreateMemory } from "@/http/schemas";
import { memoryRequestScope } from "@/memory-request-scope";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const { id } = await params;
    const scope = await memoryRequestScope(request, id);
    const input = await parseCreateMemory(request);
    const memory = createMemoryInDatabase(getDatabase(), input, scope);
    return NextResponse.json({ memory }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "create-museum-memory");
  }
}
