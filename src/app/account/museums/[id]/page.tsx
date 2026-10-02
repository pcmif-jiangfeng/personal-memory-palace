import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/data/database";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import { requireVerifiedPageUser } from "@/user-auth";
import { ApiError } from "@/http/errors";

export const dynamic = "force-dynamic";
export default async function MuseumPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireVerifiedPageUser();
  const { id } = await params;
  try {
    requireMuseumOwnerInDatabase(getDatabase(), user.id, id);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  redirect(`/account?museumId=${encodeURIComponent(id)}`);
}
