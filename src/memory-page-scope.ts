import { requireVerifiedPageUser } from "./user-auth.ts";
import { redirect } from "next/navigation";
import { getDatabase } from "./data/database.ts";
import { findMuseumByOwnerIdInDatabase } from "./data/museum-repository.ts";
import { requireMuseumAccessInDatabase } from "./data/museum-access.ts";
import { ApiError } from "./http/errors.ts";
import { readMuseumSelection } from "./http/museum-selection.ts";

export async function memoryPageScope(museumId?: string) {
  const user = await requireVerifiedPageUser();
  const id =
    readMuseumSelection(museumId) ?? findMuseumByOwnerIdInDatabase(getDatabase(), user.id)?.id;
  if (!id) redirect("/account/onboarding");
  const access = requireMuseumAccessInDatabase(getDatabase(), user.id, id);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return { userId: user.id, museumId: id, role: access.role };
}
