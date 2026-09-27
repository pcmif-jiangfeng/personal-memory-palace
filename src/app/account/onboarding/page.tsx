import { redirect } from "next/navigation";
import { MuseumOnboardingForm } from "@/components/museum-onboarding-form";
import { getDatabase } from "@/data/database";
import { findMuseumByOwnerIdInDatabase } from "@/data/museum-repository";
import { currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function MuseumOnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  if (findMuseumByOwnerIdInDatabase(getDatabase(), user.id)) redirect("/account");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>为回忆建一座馆</h1>
        <p>给它一个名字和馆址。故事与照片可以留待日后慢慢陈列。</p>
        <MuseumOnboardingForm />
      </div>
    </section>
  );
}
