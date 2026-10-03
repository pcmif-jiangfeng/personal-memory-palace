import { NextResponse } from "next/server";
import { apiErrorResponse, sameOriginRequiredResponse } from "@/http/api-error";
import { parseTrashAction } from "@/http/schemas";
import { memoryRequestScope } from "@/memory-request-scope";
import { getDatabase } from "@/data/database";
import { manageScopedMemory } from "@/data/scoped-memory";
import { manageScopedStage } from "@/data/scoped-stage";
import { ApiError } from "@/http/errors";
import { DomainError } from "@/domain/errors";
import { manageScopedPhotoTrash } from "@/data/photo-trash";
import { deleteUploadedPhotoInDatabase } from "@/data/photo-deletion-service";
import { imageStorage } from "@/storage/local-image-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  try {
    const input = await parseTrashAction(request);
    const scope = await memoryRequestScope(request);
    const result: { succeededIds: string[]; failures: { id: string; error: string }[] } = {
      succeededIds: [],
      failures: [],
    };
    for (const id of input.ids) {
      try {
        const action =
          input.action === "permanent"
            ? ({ action: "permanent", confirm: true } as const)
            : { action: input.action };
        if (input.type === "memory") manageScopedMemory(getDatabase(), scope, id, action);
        else if (input.type === "stage") manageScopedStage(getDatabase(), scope, id, action);
        else if (input.action === "permanent")
          await deleteUploadedPhotoInDatabase(getDatabase(), imageStorage, id, scope, true);
        else manageScopedPhotoTrash(getDatabase(), scope, id, input.action);
        result.succeededIds.push(id);
      } catch (error) {
        result.failures.push({
          id,
          error:
            error instanceof ApiError || error instanceof DomainError
              ? error.code
              : input.type === "memory"
                ? "MEMORY_OPERATION_FAILED"
                : "STAGE_OPERATION_FAILED",
        });
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "manage-trash");
  }
}
