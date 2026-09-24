import { NextResponse } from "next/server";
import {
  addLaterNote,
  permanentlyDeleteMemory,
  restoreMemory,
  trashMemory,
  updateMemoryDetails,
  updateMemoryRelations,
} from "@/data/management-repository";
import {
  addMemoryPhotos,
  removeMemoryPhoto,
  reorderMemoryPhotos,
  setMemoryCover,
  updateMemoryExhibitMetadata,
} from "@/data/memory-exhibit-repository";
import { isOwner } from "@/auth";
import {
  apiErrorResponse,
  ownerRequiredResponse,
  sameOriginRequiredResponse,
} from "@/http/api-error";
import { parseMemoryAction } from "@/http/schemas";
import { setMemoryPublic } from "@/data/publication-repository";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = sameOriginRequiredResponse(request);
  if (originError) return originError;
  if (!(await isOwner())) return ownerRequiredResponse();
  const { id } = await params;
  try {
    const input = await parseMemoryAction(request);
    if (input.action === "details") {
      updateMemoryDetails(id, input);
    } else if (input.action === "note") {
      addLaterNote(id, input.content);
    } else if (input.action === "relations") {
      updateMemoryRelations(id, input.relatedMemoryIds);
    } else if (input.action === "trash") {
      trashMemory(id);
    } else if (input.action === "restore") {
      restoreMemory(id);
    } else if (input.action === "addPhotos") {
      addMemoryPhotos(id, input.photoIds);
    } else if (input.action === "removePhoto") {
      removeMemoryPhoto(id, input.photoId);
    } else if (input.action === "reorderPhotos") {
      reorderMemoryPhotos(id, input.photoIds);
    } else if (input.action === "setCover") {
      setMemoryCover(id, input.photoId);
    } else if (input.action === "exhibitMetadata") {
      updateMemoryExhibitMetadata(id, input.photoId, input);
    } else if (input.action === "publication") {
      setMemoryPublic(id, input.isPublic);
    } else {
      permanentlyDeleteMemory(id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "manage-memory");
  }
}
