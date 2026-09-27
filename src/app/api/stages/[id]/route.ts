import { NextResponse } from "next/server";
import { manageScopedStage, readScopedStage } from "@/data/scoped-stage";
import { getDatabase } from "@/data/database";
import { memoryRequestScope } from "@/memory-request-scope";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseStageInput } from "@/http/schemas";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await memoryRequestScope(request);
    return NextResponse.json(
      { stage: readScopedStage(getDatabase(), scope, (await params).id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "read-stage");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    const input = await parseStageInput(request, true);
    return NextResponse.json({
      stage: manageScopedStage(getDatabase(), scope, id, { action: "details", input }),
    });
  } catch (error) {
    return apiErrorResponse(error, "update-stage");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    manageScopedStage(getDatabase(), scope, (await params).id, { action: "trash" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "trash-stage");
  }
}
