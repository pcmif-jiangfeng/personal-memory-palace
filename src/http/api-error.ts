import { NextResponse } from "next/server";
import { DomainError, type DomainErrorCode } from "../domain/errors.ts";
import { isSameOriginRequest } from "../security/same-origin.ts";
import { ApiError } from "./errors.ts";

export { ApiError } from "./errors.ts";

const statusByDomainError: Record<DomainErrorCode, number> = {
  DESCRIPTION_TOO_LONG: 400,
  EXHIBIT_DESCRIPTION_TOO_LONG: 400,
  EXHIBIT_TITLE_TOO_LONG: 400,
  INVALID_COVER: 400,
  INVALID_COVER_PHOTO: 400,
  INVALID_CURSOR: 400,
  INVALID_PHOTO_ORDER: 400,
  INVALID_PHOTOS: 400,
  INVALID_RELATIONS: 400,
  INVALID_STAGE: 400,
  MEMORY_NOT_FOUND: 404,
  MEMORY_PHOTO_NOT_FOUND: 404,
  NOTE_REQUIRED: 400,
  NOTE_TOO_LONG: 400,
  PASSWORD_REQUIRED: 400,
  PHOTOS_REQUIRED: 400,
  PHOTO_ALREADY_IN_MEMORY: 409,
  PHOTO_DELETE_FAILED: 500,
  PHOTO_DELETE_INCOMPLETE: 500,
  PHOTO_IN_USE: 409,
  PHOTO_NOT_FOUND: 404,
  STAGE_NOT_FOUND: 404,
  STORY_REQUIRED: 400,
  STORY_TOO_LONG: 400,
  TITLE_REQUIRED: 400,
  TITLE_TOO_LONG: 400,
  TOO_MANY_MEMORY_PHOTOS: 400,
};

export function apiErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.code, details: error.details },
      { status: error.status },
    );
  }
  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: error.code, details: error.details },
      { status: statusByDomainError[error.code] },
    );
  }
  console.error(
    `[${context}] unexpected failure`,
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

export function ownerRequiredResponse() {
  return NextResponse.json({ error: "OWNER_REQUIRED" }, { status: 401 });
}

export function sameOriginRequiredResponse(request: Request): NextResponse | null {
  if (isSameOriginRequest(request)) return null;
  return NextResponse.json({ error: "CROSS_ORIGIN_REQUEST" }, { status: 403 });
}
