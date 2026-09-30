import { NextResponse } from "next/server";
import { copyMemoryToMuseum } from "@/application/cross-museum-memory-copy";
import { getDatabase } from "@/data/database";
import { ApiError } from "@/http/errors";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseMuseumCopyTarget } from "@/http/museum-copy";
import { memoryRequestScope } from "@/memory-request-scope";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError("INVALID_MEMORY_ID", 400);
    const target = await parseMuseumCopyTarget(request);
    return NextResponse.json(await copyMemoryToMuseum(getDatabase(), scope, id, target), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error, "memory-copy");
  }
}
