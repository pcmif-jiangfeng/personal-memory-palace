import Link from "next/link";
import { MuseumLeaveForm } from "@/components/museum-leave-form";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/data/database";
import { listSwitcherMuseumsInDatabase } from "@/data/museum-switcher";
import { findMuseumByIdInDatabase } from "@/data/museum-repository";
import { currentUser } from "@/user-auth";

export const dynamic = "force-dynamic";

export default async function JoinedMuseumPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/account/login");
  const { id } = await params;
  const database = getDatabase();
  const choice = listSwitcherMuseumsInDatabase(database, user.id).find(
    (museum) => museum.id === id,
  );
  if (!choice) notFound();
  if (choice.role === "owner") redirect(`/account?museumId=${encodeURIComponent(id)}`);
  const museum = findMuseumByIdInDatabase(database, id);
  if (!museum) notFound();
  return (
    <section className="section-shell skeleton-page">
      <div className="login-panel">
        <p className="eyebrow">PERSONAL MEMORY PALACE</p>
        <h1>{museum.name}</h1>
        <p>{museum.description || "一座保存人生经历的私人博物馆。"}</p>
        <p>当前身份：协作者</p>
        <p>
          <Link href={`/?museumId=${encodeURIComponent(id)}`}>进入这座 Museum 的 Memory 展览</Link>
        </p>
        <p>
          <Link href={`/trash?museumId=${encodeURIComponent(id)}`}>查看 Memory 回收站</Link>
          <Link href={`/workspace?museumId=${encodeURIComponent(id)}`}>进入照片整理台</Link>
        </p>
        <MuseumLeaveForm museumId={museum.id} museumName={museum.name} />
        <p>
          <Link href={`/account/museums/${encodeURIComponent(id)}/activity`} prefetch={false}>
            查看协作动态
          </Link>
        </p>
        <Link href="/account">返回自己的 Museum</Link>
      </div>
    </section>
  );
}
