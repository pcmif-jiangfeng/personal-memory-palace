import Link from "next/link";
import { redirect } from "next/navigation";
import { MuseumProfileForm } from "@/components/museum-profile-form";
import { museumCoverChoicesInDatabase } from "@/data/museum-profile";
import { MuseumSlugForm } from "@/components/museum-slug-form";
import { UserLogoutButton } from "@/components/user-logout-button";
import { getDatabase } from "@/data/database";
import { findMuseumByOwnerIdInDatabase } from "@/data/museum-repository";
import { currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const museum = findMuseumByOwnerIdInDatabase(getDatabase(), user.id);
  if (!museum) redirect("/account/onboarding");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>{museum.name}</h1>
        <p>{museum.description || "属于你的人生博物馆已经建立。未来的故事，将在这里慢慢展开。"}</p>
        <p>
          馆长：{user.displayName} · 馆址：{museum.slug}
        </p>
        <MuseumProfileForm
          version={museum.version}
          name={museum.name}
          description={museum.description}
          coverPhotoId={museum.coverPhotoId}
          photos={museumCoverChoicesInDatabase(getDatabase(), museum.id, museum.coverPhotoId)}
        />
        <MuseumSlugForm currentSlug={museum.slug} />
        <Link href="/account/invites">管理协作者邀请</Link>
        <UserLogoutButton />
      </div>
    </section>
  );
}
