export type DomainErrorCode =
  | "EXHIBIT_DESCRIPTION_TOO_LONG"
  | "EXHIBIT_TITLE_TOO_LONG"
  | "DESCRIPTION_TOO_LONG"
  | "INVALID_COVER"
  | "INVALID_COVER_PHOTO"
  | "INVALID_CURSOR"
  | "INVALID_PHOTO_ORDER"
  | "INVALID_PHOTOS"
  | "INVALID_RELATIONS"
  | "INVALID_STAGE"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_PHOTO_NOT_FOUND"
  | "NOTE_REQUIRED"
  | "NOTE_TOO_LONG"
  | "PASSWORD_REQUIRED"
  | "PHOTOS_REQUIRED"
  | "PHOTO_ALREADY_IN_MEMORY"
  | "PHOTO_DELETE_FAILED"
  | "PHOTO_DELETE_INCOMPLETE"
  | "PHOTO_IN_USE"
  | "PHOTO_NOT_FOUND"
  | "STAGE_NOT_FOUND"
  | "STORY_REQUIRED"
  | "STORY_TOO_LONG"
  | "TITLE_REQUIRED"
  | "TITLE_TOO_LONG"
  | "TOO_MANY_MEMORY_PHOTOS";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}
