import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MuseumProfileForm } from "@/components/museum-profile-form";
import { museumCoverChoicesInDatabase } from "@/data/museum-profile";
import { MuseumSlugForm } from "@/components/museum-slug-form";
import { UserLogoutButton } from "@/components/user-logout-button";
import { getDatabase } from "@/data/database";
import { findMuseumByIdInDatabase, findMuseumByOwnerIdInDatabase } from "@/data/museum-repository";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";
import { isPlatformAdminInDatabase } from "@/data/platform-admin";
import { requireMuseumAccessInDatabase } from "@/data/museum-access";
import { readMuseumSelection } from "@/http/museum-selection";
import { ApiError } from "@/http/errors";
import { readMuseumStorageSummaryInDatabase } from "@/data/museum-storage-usage";

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
      requireMuseumAccessInDatabase(getDatabase(), user.id, selectedId);
      museum = findMuseumByIdInDatabase(getDatabase(), selectedId);
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
      throw error;
    }
  } else museum = findMuseumByOwnerIdInDatabase(getDatabase(), user.id);
  if (!museum) redirect("/account/onboarding");
  const access = requireMuseumAccessInDatabase(getDatabase(), user.id, museum.id);
  const ownerName = getDatabase()
    .prepare("SELECT display_name FROM users WHERE id=?")
    .get(museum.ownerId)?.display_name;
  if (museum.status === "pending_deletion")
    redirect(`/account/museums/${encodeURIComponent(museum.id)}/deletion`);
  const storage = readMuseumStorageSummaryInDatabase(getDatabase(), user.id, museum.id);
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>{museum.name}</h1>
        <p>{museum.description || "属于你的人生博物馆已经建立。未来的故事，将在这里慢慢展开。"}</p>
        <p>
          {museum.museumType === "private" ? "私人宫殿" : "共同宫殿"} · 馆长：
          {typeof ownerName === "string" ? ownerName : "昵称未知"} · 馆址：{museum.slug}
        </p>
        <p>你的身份：{access.role === "owner" ? "馆长" : "协作者"}</p>
        <Link href={`/?museumId=${encodeURIComponent(museum.id)}`} className="button-primary">
          进入这座宫殿
        </Link>
        <dl aria-label="当前宫殿存储">
          <dt>本馆照片占用</dt>
          <dd>
            {storage.storageUsedBytes === null ? "核对中" : `${storage.storageUsedBytes} 字节`}
          </dd>
          <dt>本馆上传预留</dt>
          <dd>{storage.reservedBytes} 字节</dd>
          <dt>馆长账号剩余可用空间</dt>
          <dd>
            {storage.ownerRemainingBytes === null
              ? "核对中"
              : `${storage.ownerRemainingBytes} 字节`}
          </dd>
        </dl>
        <p>私人和共同宫殿共用馆长账号额度；待清理照片在物理文件删除前仍占用空间。</p>
        <Link href="/account/onboarding" prefetch={false}>
          创建共同宫殿
        </Link>
        {access.role === "owner" ? (
          <>
            <MuseumProfileForm
              key={`profile-${museum.id}`}
              museumId={museum.id}
              version={museum.version}
              name={museum.name}
              description={museum.description}
              coverPhotoId={museum.coverPhotoId}
              photos={museumCoverChoicesInDatabase(getDatabase(), museum.id, museum.coverPhotoId)}
            />
            <MuseumSlugForm
              key={`slug-${museum.id}`}
              museumId={museum.id}
              currentSlug={museum.slug}
            />
            <Link
              href={`/account/invites?museumId=${encodeURIComponent(museum.id)}`}
              prefetch={false}
            >
              管理本馆邀请
            </Link>
          </>
        ) : (
          <p>你可以在馆内整理照片、创建和编辑记忆；邀请、分享与永久删除由馆长管理。</p>
        )}
        <Link href={`/account/museums/${encodeURIComponent(museum.id)}/audit`} prefetch={false}>
          查看操作审计
        </Link>
        <Link href={`/account/museums/${encodeURIComponent(museum.id)}/activity`} prefetch={false}>
          查看协作动态
        </Link>
        <Link
          href={`/account/museums/${encodeURIComponent(museum.id)}/collaborators`}
          prefetch={false}
        >
          {access.role === "owner" ? "管理本馆成员" : "成员与退出"}
        </Link>
        <UserLogoutButton />
        {museum.museumType === "shared" ? (
          <Link
            href={`/account/museums/${encodeURIComponent(museum.id)}/transfer`}
            prefetch={false}
          >
            馆长转让
          </Link>
        ) : null}
        <Link href="/account/settings" prefetch={false}>
          账号管理
        </Link>
        <Link href="/account/deletion" prefetch={false}>
          账号与宫殿保留说明
        </Link>
        {access.role === "owner" ? (
          <Link
            href={`/account/museums/${encodeURIComponent(museum.id)}/deletion`}
            prefetch={false}
          >
            查看本馆状态
          </Link>
        ) : null}
        {isPlatformAdminInDatabase(getDatabase(), user.id) ? (
          <Link href="/admin" prefetch={false}>
            平台管理
          </Link>
        ) : null}
      </div>
    </section>
  );
}
