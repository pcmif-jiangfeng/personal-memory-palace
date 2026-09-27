import { getDatabase } from "./data/database.ts";
import {
  requireMuseumAccessInDatabase,
  requireMuseumOwnerInDatabase,
} from "./data/museum-access.ts";
import { currentUser } from "./user-auth.ts";

// Server request entry points: callers supply only the target Museum, never a client userId.
export async function requireMuseumAccess(museumId: string) {
  const user = await currentUser();
  return requireMuseumAccessInDatabase(getDatabase(), user?.id ?? null, museumId);
}

export async function requireMuseumOwner(museumId: string) {
  const user = await currentUser();
  return requireMuseumOwnerInDatabase(getDatabase(), user?.id ?? null, museumId);
}
