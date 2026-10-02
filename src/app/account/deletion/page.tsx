import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { checkAccountDeletionPreconditionsInDatabase } from "@/data/account-deletion-preconditions";
import { readAccountDeletionPage } from "@/http/account-deletion-preconditions";
import { ApiError } from "@/http/errors";

export const dynamic = "force-dynamic";

export default async function AccountDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const query = await searchParams;
  if (Object.keys(query).some((key) => key !== "page")) notFound();
  let page;
  try {
    page = readAccountDeletionPage(query.page);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) notFound();
    throw error;
  }
  const result = checkAccountDeletionPreconditionsInDatabase(getDatabase(), user.id, page);
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <h1>账号删除前置检查</h1>
        <p>检查当前账号名下所有博物馆，不限于当前选中的馆。</p>
        {result.canEnterDeletionFlow ? (
          <p role="status">
            前置检查通过：名下博物馆没有有效协作者，可进入后续博物馆与账号删除流程。
          </p>
        ) : (
          <p role="status">
            暂不能进入删除流程：有 {result.blockedMuseumCount}{" "}
            座博物馆仍保留历史协作记录，需要在数据迁移检查中处理。
          </p>
        )}
        <p>
          本页仅提供前置检查；本次不会发起待删除，也不会删除账号、博物馆或内容。可进入单馆删除管理；账号永久删除尚未开放。
        </p>
        <p>名下共 {result.ownedMuseumCount} 座博物馆。</p>
        <ul className="audit-list">
          {result.museums.map((museum) => (
            <li key={museum.id}>
              <h2>{museum.name}</h2>
              <p>
                馆址：{museum.slug} · 有效协作者：{museum.collaboratorCount} 人
              </p>
              {museum.collaboratorCount > 0 ? (
                <>
                  <p>协作和馆长转移已停用；历史记录保留，当前不会发起账号删除。</p>
                </>
              ) : (
                <p>本馆无有效协作者。</p>
              )}
              {museum.status === "active" ? (
                <Link href={`/account?museumId=${encodeURIComponent(museum.id)}`}>
                  查看本馆设置
                </Link>
              ) : null}
              <Link
                href={`/account/museums/${encodeURIComponent(museum.id)}/deletion`}
                prefetch={false}
              >
                管理本馆删除状态
              </Link>
            </li>
          ))}
        </ul>
        {result.ownedMuseumCount === 0 ? (
          <p>你当前没有自有博物馆；作为协作者加入的馆不属于你的删除范围。</p>
        ) : null}
        <nav className="audit-pagination" aria-label="自有博物馆分页">
          {page > 1 ? (
            <Link href={`/account/deletion?page=${page - 1}`} prefetch={false}>
              上一页
            </Link>
          ) : null}
          <span>第 {page} 页</span>
          {page * result.pageSize < result.ownedMuseumCount ? (
            <Link href={`/account/deletion?page=${page + 1}`} prefetch={false}>
              下一页
            </Link>
          ) : null}
        </nav>
        <Link href="/account">返回账号</Link>
      </div>
    </section>
  );
}
