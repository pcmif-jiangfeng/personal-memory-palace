import { redirect } from "next/navigation";
import Link from "next/link";
import { MuseumOnboardingForm } from "@/components/museum-onboarding-form";
import { getDatabase } from "@/data/database";
import { findMuseumByOwnerIdInDatabase } from "@/data/museum-repository";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function MuseumOnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const hasPrivatePalace = Boolean(findMuseumByOwnerIdInDatabase(getDatabase(), user.id));
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>{hasPrivatePalace ? "创建共同宫殿" : "为回忆建一座馆"}</h1>
        <p>给它一个名字和馆址。故事与照片可以留待日后慢慢陈列。</p>
        <MuseumOnboardingForm hasPrivatePalace={hasPrivatePalace} />
        <Link href="/account/deletion" prefetch={false}>
          账号与宫殿保留说明
        </Link>
      </div>
    </section>
  );
}
