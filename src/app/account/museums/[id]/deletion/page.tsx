import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/data/database";
import { readMuseumDeletionInDatabase } from "@/data/museum-deletion";
import { ApiError } from "@/http/errors";
import { requireVerifiedPageUser as currentUser } from "@/user-auth";
import { MuseumDeletionForm } from "@/components/museum-deletion-form";

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
  const knownDeadline =
    museum.deletionScheduledAt !== null && Number.isFinite(Date.parse(museum.deletionScheduledAt));
  const canCancel = museum.canCancel;
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel audit-panel">
        <h1>宫殿状态</h1>
        <h2>{museum.name}</h2>
        {pending ? (
          <>
            <p role="status">
              本馆处于待删除状态，所有成员的业务内容、邀请、转让和分享均暂停访问。
            </p>
            {museum.deletionScheduledAt ? (
              <p>
                计划删除时间（UTC）：
                <time dateTime={museum.deletionScheduledAt}>{museum.deletionScheduledAt}</time>
              </p>
            ) : (
              <p>历史待删除状态没有记录期限，需要在迁移检查中明确处理。</p>
            )}
          </>
        ) : (
          <p>本馆处于正常使用状态。</p>
        )}
        <p role="status">
          {museum.museumType === "private"
            ? "私人宫殿不提供整馆删除。"
            : pending
              ? !knownDeadline
                ? "历史删除期限未知，需要核对数据，不能自动撤销。"
                : canCancel
                  ? "截止时间前可由馆长取消；取消后恢复原有效成员与分享，不恢复已关闭分享或失效转让。"
                  : museum.cleanupFailed
                    ? "后台清理失败，宫殿保持冻结；备份和重试信息已保留，请由维护人员检查后重试。"
                    : "删除截止时间已到或清理已开始，不能撤销；等待维护任务完成清理。"
              : "共同宫殿可进入30×24小时待删除期，存在协作者不影响排期。截止前可撤销，截止后不能恢复访问。"}
        </p>
        {pending && museum.cleanupAttempts > 0 ? (
          <p>
            清理尝试次数：{museum.cleanupAttempts}。
            {museum.cleanupNextAttemptAt ? (
              <>
                下次可重试时间（UTC）：
                <time dateTime={museum.cleanupNextAttemptAt}>{museum.cleanupNextAttemptAt}</time>
              </>
            ) : null}
          </p>
        ) : null}
        {museum.museumType === "shared" && (!pending || canCancel) ? (
          <MuseumDeletionForm museumId={id} version={museum.version} pending={pending} />
        ) : null}
        <Link href="/account/deletion" prefetch={false}>
          查看账号与宫殿保留说明
        </Link>
        {!pending ? (
          <Link href={`/account/museums/${encodeURIComponent(id)}/audit`} prefetch={false}>
            查看操作审计
          </Link>
        ) : null}
        {!pending ? (
          <Link href={`/account?museumId=${encodeURIComponent(id)}`}>返回本馆设置</Link>
        ) : null}
      </div>
    </section>
  );
}
