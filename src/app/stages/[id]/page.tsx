import { notFound } from "next/navigation";
import { MemoryCard } from "@/components/memory-card";
import { PageIntro } from "@/components/page-intro";
import { StageDeleteAction } from "@/components/stage-delete-action";
import { findStageById, listMemoriesByStage } from "@/data/memory-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { isOwner } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function StageViewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) redirect("/login");
  const { id } = await params;
  const stage = findStageById(id);
  if (!stage) notFound();
  const memories = listMemoriesByStage(id);
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
          <div className="stage-view-actions">
            <StageDeleteAction stageId={stage.id} stageTitle={stage.title} redirectTo="/" />
          </div>
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
            <MemoryCard key={memory.id} memory={memory} />
          ))}
        </div>
      ) : (
        <div className="empty-state">{copy.stage.empty}</div>
      )}
    </section>
  );
}
