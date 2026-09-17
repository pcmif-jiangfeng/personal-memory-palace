import { NextResponse } from "next/server";
import { ApiError } from "./errors.ts";

export { ApiError } from "./errors.ts";

const knownDomainErrors: Record<string, number> = {
  TITLE_REQUIRED: 400,
  TITLE_TOO_LONG: 400,
  DESCRIPTION_TOO_LONG: 400,
  STORY_REQUIRED: 400,
  STORY_TOO_LONG: 400,
  NOTE_REQUIRED: 400,
  NOTE_TOO_LONG: 400,
  PHOTOS_REQUIRED: 400,
  INVALID_COVER: 400,
  INVALID_PHOTOS: 400,
  INVALID_STAGE: 400,
  INVALID_RELATIONS: 400,
  INVALID_COVER_PHOTO: 400,
  PASSWORD_REQUIRED: 400,
  CONFIRM_REQUIRED: 400,
  INVALID_ACTION: 400,
  MEMORY_NOT_FOUND: 404,
  STAGE_NOT_FOUND: 404,
};

export function apiErrorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.code, details: error.details },
      { status: error.status },
    );
  }
  if (error instanceof Error && knownDomainErrors[error.message]) {
    return NextResponse.json(
      { error: error.message },
      { status: knownDomainErrors[error.message] },
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
