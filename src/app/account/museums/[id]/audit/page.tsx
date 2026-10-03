import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/data/database";
import { listMuseumAuditInDatabase, type AuditLogFilter } from "@/data/audit-log-reader";
import { findMuseumByIdInDatabase } from "@/data/museum-repository";
import { requireMuseumAccessInDatabase } from "@/data/museum-access";
import { museumActivityMessages } from "@/domain/museum-activity";
import { readAuditLogQuery } from "@/http/audit-log-query";
import { ApiError } from "@/http/errors";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

function auditHref(id: string, filter: AuditLogFilter) {
  const query = new URLSearchParams({ page: String(filter.page) });
  if (filter.objectType) query.set("objectType", filter.objectType);
  if (filter.objectId) query.set("objectId", filter.objectId);
  return `/account/museums/${encodeURIComponent(id)}/audit?${query}`;
}

export default async function OwnerAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string | string[];
    objectType?: string | string[];
    objectId?: string | string[];
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const { id } = await params;
  const database = getDatabase();
  try {
    const access = requireMuseumAccessInDatabase(database, user.id, id);
    if (access.status !== "active") notFound();
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const museum = findMuseumByIdInDatabase(database, id);
  if (!museum) notFound();
  let filter: AuditLogFilter;
  try {
    filter = readAuditLogQuery(await searchParams);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400)
      redirect(`/account/museums/${encodeURIComponent(id)}/audit`);
    throw error;
  }
  const result = listMuseumAuditInDatabase(database, user.id, id, filter);
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <p className="eyebrow">MUSEUM AUDIT LOG</p>
        <h1>操作审计</h1>
        <p>{museum.name} · 本馆有效成员可见 · 按最新操作排序</p>
        <p>
          展示内容操作的类别、目标、时间和当时昵称，不展示原始变更详情或安全管理记录，不能用于恢复内容。
        </p>
        <form
          action={`/account/museums/${encodeURIComponent(id)}/audit`}
          method="get"
          className="login-form"
        >
          <label className="form-field">
            <span>对象类型（留空查看全部）</span>
            <input
              name="objectType"
              defaultValue={filter.objectType}
              maxLength={80}
              list="audit-object-types"
              placeholder="例如 memory、stage、photo"
            />
            <datalist id="audit-object-types">
              {["memory", "stage", "photo", "laterNote"].map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </label>
          <label className="form-field">
            <span>对象 ID（留空查看该类全部对象）</span>
            <input name="objectId" defaultValue={filter.objectId} maxLength={160} />
          </label>
          <button type="submit" className="button button-primary">
            筛选记录
          </button>
          <Link href={`/account/museums/${encodeURIComponent(id)}/audit`} prefetch={false}>
            清除筛选 / 查看全部
          </Link>
        </form>
        {result.entries.length === 0 ? (
          <p>当前页没有符合条件的审计记录。</p>
        ) : (
          <ol className="audit-list">
            {result.entries.map((entry) => (
              <li key={entry.id}>
                <h2>{museumActivityMessages[entry.action]}</h2>
                <p>
                  <time dateTime={entry.timestamp}>
                    {entry.timestamp.replace("T", " ").replace("Z", " UTC")}
                  </time>
                </p>
                <p>操作者：{entry.actorName ?? "历史昵称未知"}</p>
                <p>
                  对象：
                  <Link
                    prefetch={false}
                    href={auditHref(id, {
                      page: 1,
                      objectType: entry.objectType,
                      objectId: entry.objectId,
                    })}
                  >
                    {entry.objectType} · {entry.objectId}
                  </Link>
                </p>
                <details>
                  <summary>查看操作记录标识</summary>
                  <p>
                    事件：{entry.action} · 记录 ID：{entry.id}
                  </p>
                </details>
              </li>
            ))}
          </ol>
        )}
        <nav className="audit-pagination" aria-label="审计记录分页">
          {filter.page > 1 ? (
            <Link prefetch={false} href={auditHref(id, { ...filter, page: filter.page - 1 })}>
              上一页
            </Link>
          ) : null}
          <span>
            第 {filter.page} 页 · 共 {result.total} 条
          </span>
          {filter.page * result.pageSize < result.total ? (
            <Link prefetch={false} href={auditHref(id, { ...filter, page: filter.page + 1 })}>
              下一页
            </Link>
          ) : null}
        </nav>
        <Link href={`/account?museumId=${encodeURIComponent(id)}`}>返回博物馆设置</Link>
      </div>
    </section>
  );
}
