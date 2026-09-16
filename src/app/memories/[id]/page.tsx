import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MemoryCard } from "@/components/memory-card";
import { findMemoryDetails } from "@/data/memory-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { listActiveMemories } from "@/data/memory-repository";
import { MemoryManagement } from "@/components/memory-management";
import { ShareManager } from "@/components/share-manager";
import { isOwner } from "@/auth";

export const dynamic = "force-dynamic";

export default async function MemoryExhibitionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) redirect("/login");
  const { id } = await params;
  const memory = findMemoryDetails(id);
  if (!memory) notFound();
  const imagePath = memory.coverKey ? imageStorage.resolve(memory.coverKey).publicPath : null;

  return (
    <article className="exhibition">
      <header className="exhibition-opening section-shell">
        <div className="exhibition-title-block">
          <p className="eyebrow">{copy.exhibition.label}</p>
          <p className="exhibition-stage">{memory.stageTitle ?? copy.common.uncategorized}</p>
          <h1>{memory.title}</h1>
        </div>
        {imagePath ? <figure className="exhibition-hero"><img className="exhibition-image" src={imagePath} alt="" /><figcaption>ARCHIVE · {memory.createdAt.slice(0, 10)}</figcaption></figure> : null}
      </header>
      <section className="story-hall section-shell">
        <div className="story-label"><span>01</span><h2>{copy.exhibition.story}</h2></div>
        <p>{memory.story}</p>
      </section>
      {memory.images.length > 0 ? <section className="exhibition-section exhibition-gallery-section section-shell">
        <div className="exhibition-section-heading"><span>02</span><h2>{copy.exhibition.gallery}</h2><p>{copy.common.imageCount(memory.images.length)}</p></div>
        <div className="exhibition-gallery">{memory.images.map((image, index) => (
          <figure key={image.id}>
            <img loading="lazy" src={imageStorage.resolve(image.storageKey).publicPath} alt={image.altText} />
            <figcaption>{copy.exhibition.imageNumber(index + 1)}</figcaption>
          </figure>
        ))}</div>
      </section> : null}
      <section className="exhibition-section later-notes-hall section-shell">
        <div className="exhibition-section-heading"><span>03</span><h2>{copy.exhibition.laterNotes}</h2></div>
        {memory.laterNotes.length > 0 ? <div className="later-notes-list">{memory.laterNotes.map((note) => (
          <article className="later-note" key={note.id}><time>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date(note.createdAt))}</time><p>{note.content}</p></article>
        ))}</div> : <p className="quiet-empty">{copy.exhibition.noLaterNotes}</p>}
      </section>
      {memory.relatedMemories.length > 0 ? <section className="exhibition-section">
        <div className="section-shell"><div className="exhibition-section-heading"><span>04</span><h2>{copy.exhibition.related}</h2></div>
        <div className="memory-grid related-memory-grid">{memory.relatedMemories.map((related) => (
          <MemoryCard key={related.id} memory={related} />
        ))}</div></div>
      </section> : null}
      <footer className="exhibition-stage-hall">
        <div className="section-shell"><p>{copy.exhibition.stage}</p>
          {memory.stageId ? <Link href={`/stages/${memory.stageId}`}>{memory.stageTitle} <span>→</span></Link>
            : <strong>{copy.common.uncategorized}</strong>}
        </div>
      </footer>
      {await isOwner() ? <section className="section-shell exhibition-management"><MemoryManagement memory={memory} candidates={listActiveMemories()} /><ShareManager memoryId={memory.id} /></section> : null}
    </article>
  );
}
