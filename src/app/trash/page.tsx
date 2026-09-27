import { PageIntro } from "@/components/page-intro";
import { copy } from "@/i18n/zh-CN";
import { listScopedStages } from "@/data/scoped-stage";
import { memoryPageScope } from "@/memory-page-scope";
import { getDatabase } from "@/data/database";
import { listScopedMemories } from "@/data/scoped-memory";
import { TrashManager } from "@/components/trash-manager";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<{ museumId?: string }>;
}) {
  let scope;
  try {
    scope = await memoryPageScope((await searchParams).museumId);
  } catch {
    notFound();
  }
  if (!scope) notFound();
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.trash.title} description={copy.trash.description} />
      <TrashManager
        memories={listScopedMemories(getDatabase(), scope, true)}
        stages={listScopedStages(getDatabase(), scope, true)}
        canDeleteMemoriesPermanently={scope.role === "owner"}
        canDeleteStagesPermanently={scope.role === "owner"}
      />
    </section>
  );
}
