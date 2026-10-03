import { NextResponse } from "next/server";
import { getDatabase } from "@/data/database";
import { manageScopedLaterNote } from "@/data/scoped-later-note";
import { memoryRequestScope } from "@/memory-request-scope";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseLaterNoteAction } from "@/http/later-note";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const scope = await memoryRequestScope(request);
    const { id } = await params;
    const version = manageScopedLaterNote(
      getDatabase(),
      scope,
      id,
      await parseLaterNoteAction(request),
    );
    return NextResponse.json({ ok: true, version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "manage-later-note");
  }
}
