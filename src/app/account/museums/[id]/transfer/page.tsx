import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { listMuseumCollaboratorsInDatabase } from "@/data/museum-collaborators";
import { selectOwnedMuseumInDatabase } from "@/data/museum-owner-selection";
import { MuseumOwnerTransferForm } from "@/components/museum-owner-transfer-form";
import { ApiError } from "@/http/errors";

export const dynamic = "force-dynamic";

export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const { id } = await params;
  const query = await searchParams;
  const pageValue = query.page ?? "1";
  if (typeof pageValue !== "string" || !/^[1-9]\d{0,5}$/.test(pageValue)) notFound();
  const page = Number(pageValue);
  let museum, result;
  try {
    museum = selectOwnedMuseumInDatabase(getDatabase(), user.id, id);
    result = listMuseumCollaboratorsInDatabase(getDatabase(), user.id, id, page);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const href = (value: number) =>
    `/account/museums/${encodeURIComponent(id)}/transfer?page=${value}`;
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <h1>转移馆长身份</h1>
        <p>「{museum.name}」· 请选择一位当前协作者，完成两步确认。</p>
        <ul className="audit-list">
          {result.entries.map((target) => (
            <li key={target.id}>
              <h2>{target.displayName}</h2>
              <p>{target.email}</p>
              <MuseumOwnerTransferForm
                key={`${museum.id}:${museum.version}:${target.id}`}
                museumId={id}
                museumName={museum.name}
                version={museum.version}
                target={target}
              />
            </li>
          ))}
        </ul>
        {result.entries.length === 0 ? (
          <p>本页没有可选择的协作者。请先邀请接收方加入本馆。</p>
        ) : null}
        <nav className="audit-pagination" aria-label="接收方分页">
          {page > 1 ? (
            <Link href={href(page - 1)} prefetch={false}>
              上一页
            </Link>
          ) : null}
          <span>第 {page} 页</span>
          {page * result.pageSize < result.total ? (
            <Link href={href(page + 1)} prefetch={false}>
              下一页
            </Link>
          ) : null}
        </nav>
        <Link href={`/account?museumId=${encodeURIComponent(id)}`}>返回博物馆设置</Link>
      </div>
    </section>
  );
}
