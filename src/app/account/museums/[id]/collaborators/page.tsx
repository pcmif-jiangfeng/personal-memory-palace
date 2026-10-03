import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVerifiedPageUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { requireMuseumAccessInDatabase } from "@/data/museum-access";
import { findMuseumByIdInDatabase } from "@/data/museum-repository";
import { listMuseumCollaboratorsInDatabase } from "@/data/museum-collaborators";
import { readAuditLogQuery } from "@/http/audit-log-query";
import { ApiError } from "@/http/errors";
import { MuseumLeaveForm } from "@/components/museum-leave-form";
import { MuseumRemoveCollaboratorForm } from "@/components/museum-remove-collaborator-form";

export const dynamic = "force-dynamic";
export default async function CollaboratorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requireVerifiedPageUser();
  const { id } = await params;
  const database = getDatabase();
  let access;
  let members;
  try {
    access = requireMuseumAccessInDatabase(database, user.id, id);
    if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
    const page = readAuditLogQuery({ page: (await searchParams).page }).page;
    members =
      access.role === "owner"
        ? listMuseumCollaboratorsInDatabase(database, user.id, id, page)
        : null;
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }
  const museum = findMuseumByIdInDatabase(database, id);
  if (!museum) notFound();
  const base = `/account/museums/${encodeURIComponent(id)}/collaborators`;
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel collaboration-members">
        <h1>{members ? "管理本馆成员" : "成员与退出"}</h1>
        <p>
          {museum.name} · 你的身份：{access.role === "owner" ? "馆长" : "协作者"}
        </p>
        <Link href={`/account?museumId=${encodeURIComponent(id)}`} prefetch={false}>
          返回宫殿设置
        </Link>
        {members ? (
          <>
            <p>移除成员仅终止访问权限，不会删除对方贡献的照片、记忆或 Note。</p>
            <Link href={`/account/invites?museumId=${encodeURIComponent(id)}`} prefetch={false}>
              邀请新成员
            </Link>
            {members.total === 0 ? (
              <p>这座宫殿还没有协作者。</p>
            ) : members.entries.length === 0 ? (
              <p>当前页没有协作者。</p>
            ) : (
              <ol className="invitation-list" aria-label="本馆协作者">
                {members.entries.map((member) => (
                  <li key={member.id}>
                    <h2>{member.displayName || "昵称未知"}</h2>
                    <MuseumRemoveCollaboratorForm
                      museumId={id}
                      userId={member.id}
                      displayName={member.displayName || "昵称未知"}
                    />
                  </li>
                ))}
              </ol>
            )}
            <nav className="audit-pagination" aria-label="成员分页">
              {members.page > 1 ? (
                <Link href={`${base}?page=${members.page - 1}`} prefetch={false}>
                  上一页
                </Link>
              ) : null}
              <span>
                第 {members.page} 页 · 共 {members.total} 位协作者
              </span>
              {members.page * members.pageSize < members.total ? (
                <Link href={`${base}?page=${members.page + 1}`} prefetch={false}>
                  下一页
                </Link>
              ) : null}
            </nav>
            <p>馆长不能通过退出功能离开自己的宫殿。</p>
          </>
        ) : (
          <MuseumLeaveForm museumId={id} museumName={museum.name} />
        )}
      </div>
    </section>
  );
}
