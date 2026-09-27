import { NextResponse } from "next/server";
import { createMemoryInDatabase } from "@/data/memory-write-repository";
import { getDatabase } from "@/data/database";
import { listScopedMemories } from "@/data/scoped-memory";
import { memoryRequestScope } from "@/memory-request-scope";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseCreateMemory } from "@/http/schemas";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const scope = await memoryRequestScope(request);
    const params = new URL(request.url).searchParams;
    return NextResponse.json(
      {
        memories: listScopedMemories(
          getDatabase(),
          scope,
          params.get("trashed") === "true",
          params.get("q") ?? "",
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "list-memories");
  }
}
export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const memory = createMemoryInDatabase(getDatabase(), await parseCreateMemory(request), scope);
    return NextResponse.json({ memory }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "create-memory");
  }
}
