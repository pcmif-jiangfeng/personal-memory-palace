import { notFound } from "next/navigation";
import { MemoryCard } from "@/components/memory-card";
import { PageIntro } from "@/components/page-intro";
import { StageDeleteAction } from "@/components/stage-delete-action";
import { findStageById, listMemoriesByStage } from "@/data/memory-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { readScopedStage } from "@/data/scoped-stage";
import { memoryPageScope } from "@/memory-page-scope";
import { getDatabase } from "@/data/database";
import { listScopedMemories } from "@/data/scoped-memory";

export const dynamic = "force-dynamic";

export default async function StageViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ museumId?: string }>;
}) {
  const { id } = await params;
  let scope;
  let stage;
  try {
    scope = await memoryPageScope((await searchParams).museumId);
    stage = scope ? readScopedStage(getDatabase(), scope, id) : findStageById(id, true);
  } catch {
    notFound();
  }
  if (!stage) notFound();
  const owner = Boolean(scope);
  const memories = scope
    ? listScopedMemories(getDatabase(), scope).filter((memory) => memory.stageId === id)
    : listMemoriesByStage(id, true);
  const coverKey = stage.coverKey ?? memories.find((memory) => memory.coverKey)?.coverKey ?? null;

  return (
    <section className="stage-view section-shell">
      <header className="stage-view-header">
        <div className="stage-view-copy">
          <PageIntro
            eyebrow={copy.stage.label}
            title={stage.title}
            description={stage.description}
          />
          <p className="stage-view-count">{copy.stage.memoryCount(memories.length)}</p>
          {owner ? (
            <div className="stage-view-actions">
              <StageDeleteAction
                stageId={stage.id}
                stageTitle={stage.title}
                redirectTo={scope ? `/?museumId=${encodeURIComponent(scope.museumId)}` : "/"}
              />
            </div>
          ) : null}
        </div>
        {coverKey ? (
          <div className="stage-view-art">
            <img src={imageStorage.resolve(coverKey).publicPath} alt="" />
          </div>
        ) : null}
      </header>
      {memories.length > 0 ? (
        <div className="memory-grid stage-memory-grid">
          {memories.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} museumId={scope?.museumId} />
          ))}
        </div>
      ) : (
        <div className="empty-state">{copy.stage.empty}</div>
      )}
    </section>
  );
}
