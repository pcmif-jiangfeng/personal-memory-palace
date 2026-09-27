import { NextResponse } from "next/server";
import { createScopedStage, listScopedStages } from "@/data/scoped-stage";
import { getDatabase } from "@/data/database";
import { memoryRequestScope } from "@/memory-request-scope";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseStageInput } from "@/http/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = await memoryRequestScope(request);
    const trashed = new URL(request.url).searchParams.get("trashed") === "true";
    return NextResponse.json(
      { stages: listScopedStages(getDatabase(), scope, trashed) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "list-stages");
  }
}

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const input = await parseStageInput(request);
    return NextResponse.json(
      { stage: createScopedStage(getDatabase(), scope, input) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "create-stage");
  }
}
