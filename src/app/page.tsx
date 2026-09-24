import { MemoryCard } from "@/components/memory-card";
import { PageIntro } from "@/components/page-intro";
import { StageCard } from "@/components/stage-card";
import { StageCarousel } from "@/components/stage-carousel";
import { getDataset } from "@/data/database";
import { listActiveMemories, listStageShelfItems } from "@/data/memory-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { TimeGear } from "@/components/time-gear";
import { isOwner } from "@/auth";

export const dynamic = "force-dynamic";

export default async function LifeGalleryPage() {
  const owner = await isOwner();
  const stages = listStageShelfItems(!owner);
  const memories = listActiveMemories(!owner);
  const featured = memories.find((memory) => memory.coverKey) ?? null;

  return (
    <>
      <section className="museum-hero section-shell">
        <div className="museum-hero-copy">
          {getDataset() === "demo" ? <span className="demo-badge">{copy.common.demo}</span> : null}
          <PageIntro
            eyebrow={copy.gallery.eyebrow}
            title={copy.gallery.title}
            description={copy.gallery.intro}
          />
          <div className="archive-mark">
            <span>EST.</span>
            <strong>V1</strong>
            <span>{owner ? "PRIVATE ARCHIVE" : "PUBLIC EXHIBITION"}</span>
          </div>
        </div>
        {featured?.coverKey ? (
          <a className="museum-hero-art" href={`/memories/${featured.id}`}>
            <img src={imageStorage.resolve(featured.coverKey).publicPath} alt="" />
            <span>
              <small>NOW EXHIBITING</small>
              {featured.title}
            </span>
          </a>
        ) : (
          <div className="museum-hero-art museum-hero-art-empty" />
        )}
      </section>
      <section className="recall-section section-shell">
        <div>
          <p className="eyebrow">{copy.recall.eyebrow}</p>
          <h2>{copy.recall.title}</h2>
          <p>{copy.recall.description}</p>
        </div>
        <TimeGear owner={owner} />
      </section>
      <section className="stage-gallery section-shell" id="stage-shelf">
        <header className="section-heading">
          <div>
            <p>{copy.gallery.stagesKicker}</p>
            <h2>{copy.gallery.stages}</h2>
          </div>
          <p>{copy.gallery.stagesIntro}</p>
        </header>
        <StageCarousel itemCount={stages.length}>
          {stages.map((stage, index) => (
            <StageCard key={stage.id} stage={stage} index={index} owner={owner} />
          ))}
        </StageCarousel>
      </section>
      <section className="section-shell collection-section">
        <header className="section-heading">
          <div>
            <p>{copy.gallery.memoriesKicker}</p>
            <h2>{copy.gallery.memories}</h2>
          </div>
          <p>{copy.gallery.memoriesIntro}</p>
        </header>
        <div className="memory-grid">
          {memories.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} />
          ))}
        </div>
      </section>
    </>
  );
}
