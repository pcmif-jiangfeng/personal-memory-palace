import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MuseumProfileForm } from "@/components/museum-profile-form";
import { museumCoverChoicesInDatabase } from "@/data/museum-profile";
import { MuseumSlugForm } from "@/components/museum-slug-form";
import { UserLogoutButton } from "@/components/user-logout-button";
import { getDatabase } from "@/data/database";
import { findMuseumByIdInDatabase, findMuseumByOwnerIdInDatabase } from "@/data/museum-repository";
import { currentUser } from "@/user-auth";
import { isPlatformAdminInDatabase } from "@/data/platform-admin";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import { readMuseumSelection } from "@/http/museum-selection";
import { ApiError } from "@/http/errors";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ museumId?: string | string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const query = await searchParams;
  let selectedId: string | null;
  try {
    selectedId = readMuseumSelection(query.museumId);
  } catch {
    notFound();
  }
  let museum;
  if (selectedId) {
    try {
      requireMuseumOwnerInDatabase(getDatabase(), user.id, selectedId);
      museum = findMuseumByIdInDatabase(getDatabase(), selectedId);
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
      throw error;
    }
  } else museum = findMuseumByOwnerIdInDatabase(getDatabase(), user.id);
  if (!museum) redirect("/account/onboarding");
  if (museum.status === "pending_deletion")
    redirect(`/account/museums/${encodeURIComponent(museum.id)}/deletion`);
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
          key={museum.id}
          museumId={museum.id}
          version={museum.version}
          name={museum.name}
          description={museum.description}
          coverPhotoId={museum.coverPhotoId}
          photos={museumCoverChoicesInDatabase(getDatabase(), museum.id, museum.coverPhotoId)}
        />
        <MuseumSlugForm key={museum.id} museumId={museum.id} currentSlug={museum.slug} />
        <Link href={`/account/invites?museumId=${encodeURIComponent(museum.id)}`}>
          管理协作者邀请
        </Link>
        <Link href={`/account/museums/${encodeURIComponent(museum.id)}/transfer`} prefetch={false}>
          转移馆长身份
        </Link>
        <Link
          href={`/account/museums/${encodeURIComponent(museum.id)}/collaborators`}
          prefetch={false}
        >
          管理协作者
        </Link>
        <Link href={`/account/museums/${encodeURIComponent(museum.id)}/audit`} prefetch={false}>
          查看操作审计
        </Link>
        <UserLogoutButton />
        <Link href="/account/deletion" prefetch={false}>
          检查账号删除条件
        </Link>
        <Link href={`/account/museums/${encodeURIComponent(museum.id)}/deletion`} prefetch={false}>
          管理本馆删除状态
        </Link>
        {isPlatformAdminInDatabase(getDatabase(), user.id) ? (
          <Link href="/admin" prefetch={false}>
            平台管理
          </Link>
        ) : null}
      </div>
    </section>
  );
}
