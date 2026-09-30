import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/data/database";
import { listMuseumAuditInDatabase, type AuditLogFilter } from "@/data/audit-log-reader";
import { findMuseumByIdInDatabase } from "@/data/museum-repository";
import { requireMuseumOwnerInDatabase } from "@/data/museum-access";
import { readAuditLogQuery } from "@/http/audit-log-query";
import { ApiError } from "@/http/errors";
import { currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

const actions: Record<string, string> = {
  "memory.create": "创建记忆",
  "memory.copy": "复制记忆",
  "memory.details": "修改记忆",
  "memory.publication": "修改记忆公开范围",
  "memory.trash": "移入记忆回收站",
  "memory.restore": "恢复记忆",
  "memory.permanent": "永久删除记忆",
  "memory.exhibitMetadata": "修改照片展陈",
  "memory.setCover": "修改记忆封面",
  "memory.reorderPhotos": "调整照片顺序",
  "memory.addPhotos": "添加记忆照片",
  "memory.removePhoto": "移除记忆照片",
  "stage.create": "创建 Stage",
  "stage.details": "修改 Stage",
  "stage.publication": "修改 Stage 公开范围",
  "stage.trash": "移入 Stage 回收站",
  "stage.restore": "恢复 Stage",
  "stage.permanent": "永久删除 Stage",
  "photo.upload": "上传照片",
  "photo.copy": "复制照片",
  "photo.archive": "归档照片",
  "photo.deleteQueued": "照片进入删除队列",
  "invite.create": "创建邀请",
  "invite.revoke": "撤销邀请",
  "membership.join": "加入博物馆",
  "membership.leave": "退出博物馆",
  "membership.remove": "馆长移除协作者",
  "museum.ownerTransfer": "转移馆长身份",
  "museum.deletionScheduled": "发起 30 天待删除",
  "museum.deletionCancelled": "取消待删除",
  "support.accessGranted": "签发临时支持访问",
  "support.accessRevoked": "撤销临时支持访问",
  "support.privateRead": "管理员读取授权记忆文本",
};

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
    requireMuseumOwnerInDatabase(database, user.id, id);
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
        <p>{museum.name} · 仅馆长可见 · 按最新操作排序</p>
        <p>记录从审计功能启用后开始；变更摘要不包含完整正文或照片内容，也不能作为备份恢复。</p>
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
              {["memory", "stage", "photo", "invite", "membership", "museum"].map((type) => (
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
                <h2>
                  {Object.hasOwn(actions, entry.action) ? actions[entry.action] : entry.action}
                </h2>
                <p>
                  <time dateTime={entry.timestamp}>
                    {entry.timestamp.replace("T", " ").replace("Z", " UTC")}
                  </time>
                </p>
                <p>
                  操作者：{entry.actorName ?? "已删除用户"}
                  {entry.actorUserId ? `（${entry.actorUserId}）` : ""}
                </p>
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
                  <summary>查看事件详情与变更摘要</summary>
                  <p>
                    事件：{entry.action} · 记录 ID：{entry.id}
                  </p>
                  {entry.diff === null ? <p>此事件未记录字段摘要。</p> : <pre>{entry.diff}</pre>}
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
