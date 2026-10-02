import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { listScopedMemories } from "@/data/scoped-memory";
import { memoryRequestScope } from "@/memory-request-scope";
import { apiErrorResponse } from "@/http/api-error";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const memories = listScopedMemories(getDatabase(), await memoryRequestScope(request));
    const memory = memories.length ? memories[Math.floor(Math.random() * memories.length)] : null;
    return NextResponse.json({ memory }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "recall-memory");
  }
}
