import { PageIntro } from "@/components/page-intro";
import { copy } from "@/i18n/zh-CN";
import { listTrashedMemories, listTrashedStages } from "@/data/memory-repository";
import { TrashManager } from "@/components/trash-manager";
import { isOwner } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function TrashPage() {
  if (!(await isOwner())) redirect("/login");
  return <section className="section-shell skeleton-page"><PageIntro title={copy.trash.title} description={copy.trash.description} /><TrashManager memories={listTrashedMemories()} stages={listTrashedStages()} /></section>;
}
