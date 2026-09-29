import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { InviteManagement } from "@/components/invite-management";
import { getDatabase } from "@/data/database";
import { findMuseumByOwnerIdInDatabase } from "@/data/museum-repository";
import { listOwnInvitesInDatabase } from "@/data/invite-management";
import { readInvitePage } from "@/http/invite-management";
import { currentUser } from "@/user-auth";
import { selectOwnedMuseumInDatabase } from "@/data/museum-owner-selection";
import { readMuseumSelection } from "@/http/museum-selection";
import { ApiError } from "@/http/errors";

export const dynamic = "force-dynamic";

export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; museumId?: string | string[] }>;
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
      museum = selectOwnedMuseumInDatabase(getDatabase(), user.id, selectedId);
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
      throw error;
    }
  } else museum = findMuseumByOwnerIdInDatabase(getDatabase(), user.id);
  if (!museum)
    return (
      <section className="section-shell skeleton-page">
        <h1>邀请管理仅对馆长开放</h1>
        <Link href="/account">返回账户</Link>
      </section>
    );
  const selection = `museumId=${encodeURIComponent(museum.id)}`;
  let page = 1;
  try {
    page = readInvitePage(typeof query.page === "string" ? query.page : null);
  } catch {
    redirect(`/account/invites?${selection}`);
  }
  const result = listOwnInvitesInDatabase(getDatabase(), user.id, page, museum.id);
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>邀请管理</h1>
        <p>{museum.name} · 仅馆长可管理</p>
        <p>收到链接的用户须先验证邮箱并创建自己的 Museum，才能接受邀请。</p>
        <InviteManagement
          key={museum.id}
          museumId={museum.id}
          invites={result.invites}
          now={new Date().toISOString()}
        />
        <nav aria-label="邀请列表分页">
          {page > 1 ? (
            <Link href={`/account/invites?${selection}&page=${page - 1}`}>上一页</Link>
          ) : null}
          <p>
            第 {page} 页 · 共 {result.total} 条邀请
          </p>
          {page * result.pageSize < result.total ? (
            <Link href={`/account/invites?${selection}&page=${page + 1}`}>下一页</Link>
          ) : null}
        </nav>
        <Link href={`/account?${selection}`}>返回博物馆设置</Link>
      </div>
    </section>
  );
}
