import { notFound, redirect } from "next/navigation";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { isPlatformAdminInDatabase } from "@/data/platform-admin";
import Link from "next/link";
import {
  listPlatformMetadataInDatabase,
  adminMetadataPageSize,
} from "@/data/platform-admin-metadata";
import { readPlatformAdminPage } from "@/http/platform-admin-query";
import { ApiError } from "@/http/errors";
import { AdminQuotaForm } from "@/components/admin-quota-form";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ usersPage?: string | string[]; museumsPage?: string | string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  if (!isPlatformAdminInDatabase(getDatabase(), user.id)) notFound();
  const query = await searchParams;
  let usersPage: number;
  let museumsPage: number;
  try {
    usersPage = readPlatformAdminPage(query.usersPage);
    museumsPage = readPlatformAdminPage(query.museumsPage);
  } catch (error) {
    if (error instanceof ApiError) notFound();
    throw error;
  }
  const metadata = listPlatformMetadataInDatabase(getDatabase(), user.id, usersPage, museumsPage);
  const href = (users: number, museums: number) =>
    `/admin?usersPage=${users}&museumsPage=${museums}`;
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel admin-dashboard">
        <h1>平台管理</h1>
        <p>仅管理用户和博物馆元数据、存储配额，不提供私人记忆、故事或照片浏览。</p>
        <section aria-labelledby="admin-users-heading">
          <h2 id="admin-users-heading">用户（{metadata.usersTotal}）</h2>
          {metadata.users.map((entry) => (
            <dl key={entry.email} className="admin-metadata-card">
              <dt>邮箱</dt>
              <dd>{entry.email}</dd>
              <dt>显示名称</dt>
              <dd>{entry.displayName}</dd>
              <dt>邮箱验证</dt>
              <dd>{entry.verified ? "已验证" : "未验证"}</dd>
              <dt>注册时间</dt>
              <dd>{entry.createdAt}</dd>
            </dl>
          ))}
          <nav aria-label="用户分页">
            {usersPage > 1 ? (
              <Link href={href(usersPage - 1, museumsPage)} prefetch={false}>
                上一页
              </Link>
            ) : null}
            <span>第 {usersPage} 页</span>
            {usersPage * adminMetadataPageSize < metadata.usersTotal ? (
              <Link href={href(usersPage + 1, museumsPage)} prefetch={false}>
                下一页
              </Link>
            ) : null}
          </nav>
        </section>
        <section aria-labelledby="admin-museums-heading">
          <h2 id="admin-museums-heading">博物馆（{metadata.museumsTotal}）</h2>
          {metadata.museums.map((entry) => (
            <div key={entry.id}>
              <dl className="admin-metadata-card">
                <dt>ID</dt>
                <dd>{entry.id}</dd>
                <dt>名称</dt>
                <dd>{entry.name}</dd>
                <dt>馆址</dt>
                <dd>{entry.slug}</dd>
                <dt>馆长</dt>
                <dd>
                  {entry.owner.displayName}（{entry.owner.id}）
                </dd>
                <dt>建立时间</dt>
                <dd>{entry.createdAt}</dd>
                <dt>本馆存储已用</dt>
                <dd>{entry.storageUsedBytes} 字节</dd>
                <dt>馆长账号总配额（全部自有宫殿共用）</dt>
                <dd>{entry.storageQuotaBytes} 字节</dd>
                <dt>状态</dt>
                <dd>{entry.status}</dd>
              </dl>
              <AdminQuotaForm
                key={`${entry.id}:${entry.owner.id}:${entry.storageQuotaBytes}`}
                museumId={entry.id}
                ownerId={entry.owner.id}
                quota={entry.storageQuotaBytes}
              />
            </div>
          ))}
          <nav aria-label="博物馆分页">
            {museumsPage > 1 ? (
              <Link href={href(usersPage, museumsPage - 1)} prefetch={false}>
                上一页
              </Link>
            ) : null}
            <span>第 {museumsPage} 页</span>
            {museumsPage * adminMetadataPageSize < metadata.museumsTotal ? (
              <Link href={href(usersPage, museumsPage + 1)} prefetch={false}>
                下一页
              </Link>
            ) : null}
          </nav>
        </section>
      </div>
    </section>
  );
}
