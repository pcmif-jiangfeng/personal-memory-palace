import { notFound } from "next/navigation";
import Link from "next/link";
import { requireVerifiedPageUser } from "@/user-auth";
import { getDatabase } from "@/data/database";
import { listEmailInvitesInDatabase } from "@/data/email-invites";
import { readEmailInviteInboxInDatabase } from "@/data/email-invite-inbox";
import { InviteManagement } from "@/components/invite-management";
import { AcceptInviteForm } from "@/components/accept-invite-form";
import { readMuseumSelection } from "@/http/museum-selection";
import { readInvitePage } from "@/http/invite-management";
import { ApiError } from "@/http/errors";

export const dynamic = "force-dynamic";
type InvitationQuery = {
  museumId?: string | string[];
  inviteId?: string | string[];
  page?: string | string[];
};

function readInvitationView(userId: string, query: InvitationQuery) {
  try {
    const museumId = readMuseumSelection(query.museumId);
    const inviteId = readMuseumSelection(query.inviteId);
    if ((museumId && inviteId) || Array.isArray(query.page)) notFound();
    const page = readInvitePage(query.page ?? null);
    if (museumId)
      return {
        kind: "owner" as const,
        museumId,
        inviteId,
        page,
        result: listEmailInvitesInDatabase(getDatabase(), userId, museumId, page),
      };
    const result = readEmailInviteInboxInDatabase(getDatabase(), userId, page, inviteId);
    if (inviteId && result.total === 0) notFound();
    return { kind: "recipient" as const, museumId, inviteId, page, result };
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }
}

export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<InvitationQuery>;
}) {
  const user = await requireVerifiedPageUser();
  const view = readInvitationView(user.id, await searchParams);
  const pageLink = (page: number) =>
    "/account/invites?page=" +
    page +
    (view.museumId ? "&museumId=" + encodeURIComponent(view.museumId) : "") +
    (view.inviteId ? "&inviteId=" + encodeURIComponent(view.inviteId) : "");
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <h1>{view.kind === "owner" ? "管理本馆邀请" : "收到的邀请"}</h1>
        {view.kind === "owner" ? (
          <InviteManagement museumId={view.museumId} invites={view.result.invites} />
        ) : (
          <>
            <p>仅显示发给当前已验证邮箱的邀请。查看或持有链接不会自动加入。</p>
            {!view.result.total ? (
              <p>暂无邀请。</p>
            ) : (
              <ul className="invitation-list">
                {view.result.invites.map((invite) => (
                  <li key={invite.id}>
                    <h2>{invite.museum.name}</h2>
                    <p>
                      {invite.museum.museumType === "private" ? "私人宫殿" : "共同宫殿"} ·{" "}
                      {
                        {
                          pending: "待接受",
                          accepted: "已接受",
                          revoked: "已撤销",
                          expired: "已过期",
                        }[invite.status]
                      }
                    </p>
                    <p>
                      截止：<time dateTime={invite.expiresAt}>{invite.expiresAt}</time>
                    </p>
                    {invite.status === "pending" ? (
                      <AcceptInviteForm key={invite.id} inviteId={invite.id} />
                    ) : null}
                    {invite.status === "expired" || invite.status === "revoked" ? (
                      <p>如仍需加入，请联系馆长重新邀请。</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <nav aria-label="邀请分页">
          {view.page > 1 ? <Link href={pageLink(view.page - 1)}>上一页</Link> : null}{" "}
          {view.page * view.result.pageSize < view.result.total ? (
            <Link href={pageLink(view.page + 1)}>下一页</Link>
          ) : null}
        </nav>
        <Link href="/account">返回宫殿设置</Link>
      </div>
    </section>
  );
}
