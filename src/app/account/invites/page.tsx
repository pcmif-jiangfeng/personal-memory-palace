import { notFound } from "next/navigation";
import { requireVerifiedPageUser } from "@/user-auth";

export const dynamic = "force-dynamic";
// Historical collaboration URLs no longer expose private content or mutation controls.
export default async function RetiredCollaborationPage() {
  await requireVerifiedPageUser();
  notFound();
}
