import { ApiError } from "./errors.ts";
import {
  EXHIBIT_DESCRIPTION_MAX_LENGTH,
  EXHIBIT_TITLE_MAX_LENGTH,
  LATER_NOTE_MAX_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_MEMORY_PHOTOS,
  MAX_PASSWORD_LENGTH,
  MAX_RELATED_MEMORIES,
  MEMORY_STORY_MAX_LENGTH,
  MEMORY_TITLE_MAX_LENGTH,
  STAGE_DESCRIPTION_MAX_LENGTH,
  STAGE_TITLE_MAX_LENGTH,
} from "../domain/rules.ts";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("INVALID_JSON_BODY", 400);
  }
  return value as JsonObject;
}

function stringValue(
  object: JsonObject,
  key: string,
  options: { required?: boolean; maxLength?: number; trim?: boolean } = {},
): string | undefined {
  const value = object[key];
  if (value === undefined || value === null) {
    if (options.required) throw new ApiError(`INVALID_${key.toUpperCase()}`, 400);
    return undefined;
  }
  if (typeof value !== "string") throw new ApiError(`INVALID_${key.toUpperCase()}`, 400);
  const normalized = options.trim === false ? value : value.trim();
  if (options.required && !normalized) throw new ApiError(`INVALID_${key.toUpperCase()}`, 400);
  if (options.maxLength && normalized.length > options.maxLength) {
    throw new ApiError(`${key.toUpperCase()}_TOO_LONG`, 400);
  }
  return normalized;
}

function optionalIdentifier(object: JsonObject, key: string): string | null | undefined {
  if (object[key] === null) return null;
  return stringValue(object, key, { maxLength: MAX_IDENTIFIER_LENGTH });
}

function stringArray(
  object: JsonObject,
  key: string,
  options: { required?: boolean; min?: number; max: number },
): string[] {
  const value = object[key];
  if (value === undefined && !options.required) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > MAX_IDENTIFIER_LENGTH,
    )
  ) {
    throw new ApiError(`INVALID_${key.toUpperCase()}`, 400);
  }
  if ((options.min ?? 0) > value.length || value.length > options.max) {
    throw new ApiError(`INVALID_${key.toUpperCase()}`, 400);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  try {
    return objectValue(await request.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_JSON_BODY", 400);
  }
}

export async function parseOwnerLogin(request: Request) {
  const input = await readJsonObject(request);
  return {
    password: stringValue(input, "password", {
      required: true,
      maxLength: MAX_PASSWORD_LENGTH,
      trim: false,
    })!,
  };
}

export async function parseShareAccess(request: Request) {
  const input = await readJsonObject(request);
  return {
    token: stringValue(input, "token", { required: true, maxLength: MAX_IDENTIFIER_LENGTH })!,
    password: stringValue(input, "password", { maxLength: MAX_PASSWORD_LENGTH, trim: false }),
  };
}

export async function parseShareConfiguration(request: Request) {
  const input = await readJsonObject(request);
  const enabled = input.enabled;
  const mode = input.mode ?? "link";
  if (typeof enabled !== "boolean") throw new ApiError("INVALID_ENABLED", 400);
  if (mode !== "link" && mode !== "password") throw new ApiError("INVALID_MODE", 400);
  return {
    memoryId: stringValue(input, "memoryId", { required: true, maxLength: MAX_IDENTIFIER_LENGTH })!,
    enabled,
    mode: mode as "link" | "password",
    password: stringValue(input, "password", { maxLength: MAX_PASSWORD_LENGTH, trim: false }),
  };
}

export async function parseStageInput(request: Request) {
  const input = await readJsonObject(request);
  return {
    title: stringValue(input, "title", { required: true, maxLength: STAGE_TITLE_MAX_LENGTH })!,
    description:
      stringValue(input, "description", { maxLength: STAGE_DESCRIPTION_MAX_LENGTH }) ?? "",
    coverPhotoId: optionalIdentifier(input, "coverPhotoId"),
  };
}

export async function parseCreateMemory(request: Request) {
  const input = await readJsonObject(request);
  return {
    title: stringValue(input, "title", { required: true, maxLength: MEMORY_TITLE_MAX_LENGTH })!,
    story: stringValue(input, "story", { required: true, maxLength: MEMORY_STORY_MAX_LENGTH })!,
    photoIds: stringArray(input, "photoIds", { required: true, min: 1, max: MAX_MEMORY_PHOTOS }),
    coverPhotoId: stringValue(input, "coverPhotoId", {
      required: true,
      maxLength: MAX_IDENTIFIER_LENGTH,
    })!,
    stageId: optionalIdentifier(input, "stageId"),
    relatedMemoryIds: stringArray(input, "relatedMemoryIds", { max: MAX_RELATED_MEMORIES }),
  };
}

export async function parseMemoryAction(request: Request) {
  const input = await readJsonObject(request);
  const action = stringValue(input, "action", { required: true, maxLength: 30 })!;
  if (action === "details") {
    return {
      action,
      title: stringValue(input, "title", { required: true, maxLength: MEMORY_TITLE_MAX_LENGTH })!,
      story: stringValue(input, "story", { required: true, maxLength: MEMORY_STORY_MAX_LENGTH })!,
      stageId: optionalIdentifier(input, "stageId"),
    } as const;
  }
  if (action === "note") {
    return {
      action,
      content: stringValue(input, "content", { required: true, maxLength: LATER_NOTE_MAX_LENGTH })!,
    } as const;
  }
  if (action === "relations") {
    return {
      action,
      relatedMemoryIds: stringArray(input, "relatedMemoryIds", { max: MAX_RELATED_MEMORIES }),
    } as const;
  }
  if (action === "addPhotos") {
    return {
      action,
      photoIds: stringArray(input, "photoIds", {
        required: true,
        min: 1,
        max: MAX_MEMORY_PHOTOS,
      }),
    } as const;
  }
  if (action === "removePhoto" || action === "setCover") {
    return {
      action,
      photoId: stringValue(input, "photoId", {
        required: true,
        maxLength: MAX_IDENTIFIER_LENGTH,
      })!,
    } as const;
  }
  if (action === "reorderPhotos") {
    return {
      action,
      photoIds: stringArray(input, "photoIds", { max: MAX_MEMORY_PHOTOS }),
    } as const;
  }
  if (action === "exhibitMetadata") {
    return {
      action,
      photoId: stringValue(input, "photoId", {
        required: true,
        maxLength: MAX_IDENTIFIER_LENGTH,
      })!,
      title: stringValue(input, "title", { maxLength: EXHIBIT_TITLE_MAX_LENGTH }) ?? "",
      description:
        stringValue(input, "description", { maxLength: EXHIBIT_DESCRIPTION_MAX_LENGTH }) ?? "",
    } as const;
  }
  if (action === "trash" || action === "restore") return { action } as const;
  if (action === "permanent" && input.confirm === true) return { action, confirm: true } as const;
  throw new ApiError("INVALID_ACTION", 400);
}

export async function parseTrashAction(request: Request) {
  const input = await readJsonObject(request);
  const type = input.type;
  const action = input.action;
  if (type !== "memory" && type !== "stage") throw new ApiError("INVALID_TYPE", 400);
  if (action !== "trash" && action !== "restore" && action !== "permanent")
    throw new ApiError("INVALID_ACTION", 400);
  if (action === "permanent" && input.confirm !== true) throw new ApiError("CONFIRM_REQUIRED", 400);
  return {
    type,
    action: action as "trash" | "restore" | "permanent",
    id: stringValue(input, "id", { required: true, maxLength: MAX_IDENTIFIER_LENGTH })!,
  };
}
