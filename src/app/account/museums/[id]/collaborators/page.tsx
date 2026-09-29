import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { listMuseumCollaboratorsInDatabase } from "@/data/museum-collaborators";
import { ApiError } from "@/http/errors";
import { MuseumRemoveCollaboratorForm } from "@/components/museum-remove-collaborator-form";

export const dynamic = "force-dynamic";

export default async function CollaboratorsPage({
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
  const value = query.page ?? "1";
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) notFound();
  const page = Number(value);
  let result;
  try {
    result = listMuseumCollaboratorsInDatabase(getDatabase(), user.id, id, page);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const href = (next: number) =>
    `/account/museums/${encodeURIComponent(id)}/collaborators?page=${next}`;
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <h1>管理协作者</h1>
        <p>仅馆长可见 · 当前有效协作者 {result.total} 人</p>
        <ul className="audit-list">
          {result.entries.map((entry) => (
            <li key={entry.id}>
              <h2>{entry.displayName}</h2>
              <p>{entry.email}</p>
              <MuseumRemoveCollaboratorForm
                museumId={id}
                userId={entry.id}
                displayName={entry.displayName}
              />
            </li>
          ))}
        </ul>
        {result.entries.length === 0 ? <p>本页没有有效协作者。</p> : null}
        <nav className="audit-pagination" aria-label="协作者分页">
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
        <Link href={`/account?museumId=${encodeURIComponent(id)}`}>返回账号</Link>
        <Link href={`/account/museums/${encodeURIComponent(id)}/audit`} prefetch={false}>
          查看操作审计
        </Link>
      </div>
    </section>
  );
}
