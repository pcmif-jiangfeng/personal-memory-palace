import { readJsonObject } from "./schemas.ts";
import { ApiError } from "./errors.ts";
import { LATER_NOTE_MAX_LENGTH } from "../domain/rules.ts";
import type { LaterNoteAction } from "../data/scoped-later-note.ts";

export async function parseLaterNoteAction(request: Request): Promise<LaterNoteAction> {
  const input = await readJsonObject(request);
  const allowed =
    input.action === "update"
      ? ["action", "content", "version"]
      : input.action === "permanent"
        ? ["action", "confirm"]
        : ["action"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new ApiError("INVALID_LATER_NOTE_ACTION", 400);
  switch (input.action) {
    case "update":
      if (
        typeof input.content !== "string" ||
        !input.content.trim() ||
        input.content.trim().length > LATER_NOTE_MAX_LENGTH
      )
        throw new ApiError("INVALID_LATER_NOTE_CONTENT", 400);
      if (
        typeof input.version !== "number" ||
        !Number.isSafeInteger(input.version) ||
        input.version < 1
      )
        throw new ApiError("INVALID_LATER_NOTE_VERSION", 400);
      return { action: "update", content: input.content.trim(), version: input.version };
    case "trash":
    case "restore":
      return { action: input.action };
    case "permanent":
      if (input.confirm !== true) throw new ApiError("LATER_NOTE_CONFIRMATION_REQUIRED", 400);
      return { action: "permanent", confirm: true };
    default:
      throw new ApiError("INVALID_LATER_NOTE_ACTION", 400);
  }
}
