import { currentUser } from "./user-auth.ts";
import { getDatabase } from "./data/database.ts";
import { findMuseumByOwnerIdInDatabase } from "./data/museum-repository.ts";
import { requireMuseumAccessInDatabase } from "./data/museum-access.ts";
import { ApiError } from "./http/errors.ts";

export async function memoryPageScope(museumId?: string) {
  const user = await currentUser();
  if (!user) return null;
  const id = museumId ?? findMuseumByOwnerIdInDatabase(getDatabase(), user.id)?.id;
  if (!id) return null;
  const access = requireMuseumAccessInDatabase(getDatabase(), user.id, id);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return { userId: user.id, museumId: id, role: access.role };
}
