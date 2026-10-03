import { currentUser } from "./user-auth.ts";
import { getDatabase } from "./data/database.ts";
import { findMuseumByOwnerIdInDatabase } from "./data/museum-repository.ts";
import { requireMuseumAccessInDatabase } from "./data/museum-access.ts";
import { ApiError } from "./http/errors.ts";
import { readMuseumSelection, requestMuseumSelection } from "./http/museum-selection.ts";

export async function memoryRequestScope(request: Request, targetMuseumId?: string) {
  const user = await currentUser();
  if (!user) throw new ApiError("USER_REQUIRED", 401);
  const querySelection = requestMuseumSelection(request);
  const targetSelection = readMuseumSelection(targetMuseumId);
  if (targetSelection && querySelection && targetSelection !== querySelection)
    throw new ApiError("INVALID_MUSEUM_SELECTION", 400);
  const selected = targetSelection ?? querySelection;
  const museumId = selected ?? findMuseumByOwnerIdInDatabase(getDatabase(), user.id)?.id;
  if (!museumId) throw new ApiError("MUSEUM_NOT_FOUND", 404);
  const access = requireMuseumAccessInDatabase(getDatabase(), user.id, museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return { userId: user.id, museumId };
}
