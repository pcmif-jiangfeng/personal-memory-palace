import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireVerifiedPageUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { requireMuseumAccessInDatabase } from "@/data/museum-access";
import { findMuseumByIdInDatabase } from "@/data/museum-repository";
import { readOwnerTransferRequestInDatabase } from "@/data/owner-transfer-requests";
import { listMuseumCollaboratorsInDatabase } from "@/data/museum-collaborators";
import { readAuditLogQuery } from "@/http/audit-log-query";
import { ApiError } from "@/http/errors";
import { OwnerTransferControls } from "@/components/owner-transfer-controls";

export const dynamic = "force-dynamic";
export default async function MuseumTransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requireVerifiedPageUser();
  const { id } = await params;
  const db = getDatabase();
  const base = `/account/museums/${encodeURIComponent(id)}/transfer`;
  let access, museum, pending;
  try {
    access = requireMuseumAccessInDatabase(db, user.id, id);
    museum = findMuseumByIdInDatabase(db, id);
    if (access.status !== "active" || museum?.museumType !== "shared") notFound();
    pending = readOwnerTransferRequestInDatabase(db, user.id, id);
  } catch (error) {
    if (error instanceof ApiError && [403, 404, 410].includes(error.status)) notFound();
    throw error;
  }
  let page;
  try {
    page = readAuditLogQuery({ page: (await searchParams).page }).page;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) redirect(base);
    throw error;
  }
  const members =
    access.role === "owner" && !pending
      ? listMuseumCollaboratorsInDatabase(db, user.id, id, page)
      : null;
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">SHARED PALACE</p>
        <h1>馆长转让</h1>
        <p>
          {museum.name} · {access.role === "owner" ? "当前馆长" : "协作者"}
        </p>
        <OwnerTransferControls
          museumId={id}
          version={museum.version}
          role={access.role}
          pending={pending}
          targets={members?.entries ?? []}
        />
        {members ? (
          <nav aria-label="接任协作者分页">
            {page > 1 ? <Link href={`${base}?page=${page - 1}`}>上一页</Link> : null}
            <span>第 {page} 页</span>
            {page * members.pageSize < members.total ? (
              <Link href={`${base}?page=${page + 1}`}>下一页</Link>
            ) : null}
          </nav>
        ) : null}
        <Link href={`/account?museumId=${encodeURIComponent(id)}`}>返回宫殿设置</Link>
      </div>
    </section>
  );
}
