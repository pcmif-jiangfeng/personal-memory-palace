import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MuseumDeletionForm } from "@/components/museum-deletion-form";
import { getDatabase } from "@/data/database";
import { readMuseumDeletionInDatabase } from "@/data/museum-deletion";
import { checkAccountDeletionPreconditionsInDatabase } from "@/data/account-deletion-preconditions";
import { ApiError } from "@/http/errors";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function MuseumDeletionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const database = getDatabase();
  let museum;
  try {
    museum = readMuseumDeletionInDatabase(database, user.id, id);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const pending = museum.status === "pending_deletion";
  const allowed =
    pending || checkAccountDeletionPreconditionsInDatabase(database, user.id).canEnterDeletionFlow;
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <h1>博物馆删除管理</h1>
        <h2>{museum.name}</h2>
        {pending ? (
          <>
            <p role="status">
              本馆已进入待删除，协作者不可见，也不能访问内容。馆长仅保留状态管理和审计权限。
            </p>
            {museum.deletionScheduledAt ? (
              <p>
                计划删除时间（UTC）：
                <time dateTime={museum.deletionScheduledAt}>{museum.deletionScheduledAt}</time>
              </p>
            ) : (
              <p>旧待删除状态没有记录期限，请先取消后重新发起。</p>
            )}
          </>
        ) : (
          <p>发起后暂停访问，30 天后进入可永久清理的期限；发起前会重新检查名下所有馆的协作者。</p>
        )}
        <p>当前阶段只记录期限，不会自动永久删除账号、记忆或物理照片。到期清理将在后续单独实现。</p>
        {allowed ? (
          <MuseumDeletionForm
            key={`${museum.museumId}:${museum.version}`}
            museumId={id}
            version={museum.version}
            pending={pending}
          />
        ) : (
          <p role="status">名下博物馆仍有有效协作者，须先转移对应馆长身份，暂不能发起待删除。</p>
        )}
        <Link href="/account/deletion" prefetch={false}>
          查看所有馆的删除条件
        </Link>
        <Link href={`/account/museums/${encodeURIComponent(id)}/audit`} prefetch={false}>
          查看操作审计
        </Link>
        {!pending ? (
          <Link href={`/account?museumId=${encodeURIComponent(id)}`}>返回本馆设置</Link>
        ) : null}
      </div>
    </section>
  );
}
