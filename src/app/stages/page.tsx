import { PageIntro } from "@/components/page-intro";
import { StageManager } from "@/components/stage-manager";
import { StageCard } from "@/components/stage-card";
import { StageCarousel } from "@/components/stage-carousel";
import { listStageShelfItems } from "@/data/memory-repository";
import { listAllUploadedPhotos } from "@/data/photo-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { memoryPageScope } from "@/memory-page-scope";
import { getDatabase } from "@/data/database";
import { listScopedStages } from "@/data/scoped-stage";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function StagesPage({
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
  if (!scope) {
    const stages = listStageShelfItems(true);
    return (
      <section className="section-shell skeleton-page">
        <PageIntro title={copy.gallery.stages} description={copy.gallery.stagesIntro} />
        <StageCarousel itemCount={stages.length}>
          {stages.map((stage, index) => (
            <StageCard key={stage.id} stage={stage} index={index} owner={false} />
          ))}
        </StageCarousel>
      </section>
    );
  }
  const photos = listAllUploadedPhotos(scope.museumId).map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    storageKey: photo.optimizedStorageKey,
    src: imageStorage.resolve(photo.optimizedStorageKey).publicPath,
  }));
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.stage.manageTitle} description={copy.stage.manageDescription} />
      <StageManager stages={listScopedStages(getDatabase(), scope)} photos={photos} />
    </section>
  );
}
