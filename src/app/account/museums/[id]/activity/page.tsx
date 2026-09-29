import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/data/database";
import { listMuseumActivityInDatabase } from "@/data/museum-activity";
import { requireMuseumAccessInDatabase } from "@/data/museum-access";
import { findMuseumByIdInDatabase } from "@/data/museum-repository";
import { readAuditLogQuery } from "@/http/audit-log-query";
import { ApiError } from "@/http/errors";
import { currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function MuseumActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const { id } = await params;
  const database = getDatabase();
  let role: "owner" | "collaborator";
  try {
    const access = requireMuseumAccessInDatabase(database, user.id, id);
    if (access.status !== "active") notFound();
    role = access.role;
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const museum = findMuseumByIdInDatabase(database, id);
  if (!museum) notFound();
  const base = `/account/museums/${encodeURIComponent(id)}/activity`;
  let page: number;
  try {
    page = readAuditLogQuery({ page: (await searchParams).page }).page;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) redirect(base);
    throw error;
  }
  const result = listMuseumActivityInDatabase(database, user.id, id, page);
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <p className="eyebrow">MUSEUM ACTIVITY</p>
        <h1>协作动态</h1>
        <p>{museum.name} · 内容操作的简要记录</p>
        <p>仅展示已记录的内容活动，不包含完整变更摘要或安全管理记录。刷新页面可查看最新动态。</p>
        {result.entries.length === 0 ? (
          <p>当前页暂无内容活动。</p>
        ) : (
          <ol className="audit-list">
            {result.entries.map((entry) => (
              <li key={entry.id}>
                <p>
                  {entry.actorName ?? "已删除用户"} · {entry.summary}
                </p>
                <time dateTime={entry.timestamp}>
                  {entry.timestamp.replace("T", " ").replace("Z", " UTC")}
                </time>
              </li>
            ))}
          </ol>
        )}
        <nav className="audit-pagination" aria-label="协作动态分页">
          {page > 1 ? (
            <Link href={`${base}?page=${page - 1}`} prefetch={false}>
              上一页
            </Link>
          ) : null}
          <span>
            第 {page} 页 · 共 {result.total} 条内容活动
          </span>
          {page * result.pageSize < result.total ? (
            <Link href={`${base}?page=${page + 1}`} prefetch={false}>
              下一页
            </Link>
          ) : null}
        </nav>
        <Link href={role === "owner" ? "/account" : `/account/museums/${encodeURIComponent(id)}`}>
          返回博物馆
        </Link>
      </div>
    </section>
  );
}
