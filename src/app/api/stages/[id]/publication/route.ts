import { NextResponse } from "next/server";
import { manageScopedStage } from "@/data/scoped-stage";
import { getDatabase } from "@/data/database";
import { memoryRequestScope } from "@/memory-request-scope";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { readJsonObject } from "@/http/schemas";
import { ApiError } from "@/http/errors";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const input = await readJsonObject(request);
    if (typeof input.isPublic !== "boolean") throw new ApiError("INVALID_IS_PUBLIC", 400);
    manageScopedStage(getDatabase(), scope, (await params).id, {
      action: "publication",
      isPublic: input.isPublic,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "set-stage-publication");
  }
}
