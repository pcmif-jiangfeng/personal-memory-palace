import { notFound } from "next/navigation";
import Link from "next/link";
import { MemoryCard } from "@/components/memory-card";
import { findMemoryDetails, listActiveStages } from "@/data/memory-repository";
import { listUploadedPhotosByIds, queryWorkspacePhotoCatalog } from "@/data/photo-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { MemoryManagement } from "@/components/memory-management";
import { ShareManager } from "@/components/share-manager";
import { memoryPageScope } from "@/memory-page-scope";
import { requireMemoryAccessInDatabase } from "@/data/memory-access";
import { getDatabase } from "@/data/database";
import { listScopedMemories } from "@/data/scoped-memory";
import { PhotoViewer } from "@/components/photo-viewer";
import { MemoryExhibition } from "@/components/memory-exhibition";
import { MemoryAttribution } from "@/components/memory-attribution";
import { MuseumCopyForm } from "@/components/museum-copy-form";
import { listSwitcherMuseumsInDatabase } from "@/data/museum-switcher";

export const dynamic = "force-dynamic";

export default async function MemoryExhibitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ museumId?: string }>;
}) {
  const { id } = await params;
  let scope;
  try {
    scope = await memoryPageScope((await searchParams).museumId);
    if (scope)
      requireMemoryAccessInDatabase(getDatabase(), scope.userId, scope.museumId, id, "read");
  } catch {
    notFound();
  }
  const owner = Boolean(scope);
  const memory = findMemoryDetails(id, !owner, scope?.museumId);
  if (!memory) notFound();
  if (!owner) return <MemoryExhibition memory={memory} visitor />;
  const imagePath = memory.coverKey ? imageStorage.resolve(memory.coverKey).publicPath : null;
  const viewerImages = memory.images.map((image) => ({
    id: image.id,
    src: imageStorage.resolve(image.storageKey).publicPath,
    alt: image.altText,
    exhibitTitle: image.exhibitTitle,
    exhibitDescription: image.exhibitDescription,
  }));
  const stages = listActiveStages(false, scope!.museumId);
  const exhibitPhotos = listUploadedPhotosByIds(memory.images.map((image) => image.photoId));
  const catalogById = new Map(exhibitPhotos.map((photo) => [photo.id, photo]));
  const exhibits = memory.images.map((image) => ({
    photoId: image.photoId,
    name: catalogById.get(image.photoId)?.originalName ?? copy.exhibits.unnamed,
    src: imageStorage.resolve(image.storageKey).publicPath,
    isCover: image.isCover,
    exhibitTitle: image.exhibitTitle,
    exhibitDescription: image.exhibitDescription,
  }));
  const libraryPage = queryWorkspacePhotoCatalog({ source: "library", limit: 24 }, scope!.museumId);
  const libraryPhotos = libraryPage.items.map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    src: imageStorage.resolve(photo.optimizedStorageKey).publicPath,
    hasOriginal: Boolean(photo.originalStorageKey),
    libraryMember: photo.libraryMember,
    activeMemoryCount: photo.activeMemoryCount,
    memoryTitles: photo.memoryTitles,
    stageIds: photo.stageIds,
  }));

  return (
    <article className="exhibition">
      <header className="exhibition-opening section-shell">
        <div className="exhibition-title-block">
          <p className="eyebrow">{copy.exhibition.label}</p>
          <p className="exhibition-stage">{memory.stageTitle ?? copy.common.uncategorized}</p>
          <h1>{memory.title}</h1>
          <MemoryAttribution memory={memory} />
        </div>
        {imagePath ? (
          <figure className="exhibition-hero">
            <img className="exhibition-image" src={imagePath} alt={memory.title} />
            <figcaption>ARCHIVE · {memory.createdAt.slice(0, 10)}</figcaption>
          </figure>
        ) : null}
      </header>
      <section className="story-hall section-shell">
        <div className="story-label">
          <span>01</span>
          <h2>{copy.exhibition.story}</h2>
        </div>
        <p>{memory.story}</p>
      </section>
      {memory.images.length > 0 ? (
        <section className="exhibition-section exhibition-gallery-section section-shell">
          <div className="exhibition-section-heading">
            <span>02</span>
            <h2>{copy.exhibition.gallery}</h2>
            <p>{copy.common.imageCount(memory.images.length)}</p>
          </div>
          <div className="exhibition-gallery">
            {memory.images.map((image) => (
              <figure key={image.id}>
                <PhotoViewer
                  images={viewerImages}
                  initialImageId={image.id}
                  imageClassName="exhibition-gallery-image"
                  loading="lazy"
                />
                {image.exhibitTitle || image.exhibitDescription ? (
                  <figcaption>
                    {image.exhibitTitle ? <strong>{image.exhibitTitle}</strong> : null}
                    {image.exhibitDescription ? <p>{image.exhibitDescription}</p> : null}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      ) : null}
      <section className="exhibition-section later-notes-hall section-shell">
        <div className="exhibition-section-heading">
          <span>03</span>
          <h2>{copy.exhibition.laterNotes}</h2>
        </div>
        {memory.laterNotes.length > 0 ? (
          <div className="later-notes-list">
            {memory.laterNotes.map((note) => (
              <article className="later-note" key={note.id}>
                <time>
                  {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(
                    new Date(note.createdAt),
                  )}
                </time>
                <p>{note.content}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">{copy.exhibition.noLaterNotes}</p>
        )}
      </section>
      {memory.relatedMemories.length > 0 ? (
        <section className="exhibition-section">
          <div className="section-shell">
            <div className="exhibition-section-heading">
              <span>04</span>
              <h2>{copy.exhibition.related}</h2>
            </div>
            <div className="memory-grid related-memory-grid">
              {memory.relatedMemories.map((related) => (
                <MemoryCard key={related.id} memory={related} museumId={scope?.museumId} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
      <footer className="exhibition-stage-hall">
        <div className="section-shell">
          <p>{copy.exhibition.stage}</p>
          {memory.stageId ? (
            <Link href={`/stages/${memory.stageId}`}>
              {memory.stageTitle} <span>→</span>
            </Link>
          ) : (
            <strong>{copy.common.uncategorized}</strong>
          )}
        </div>
      </footer>
      <section className="section-shell exhibition-management">
        <details className="relation-editor">
          <summary>{copy.museumCopy.memory}</summary>
          <p className="field-help">{copy.museumCopy.memoryHint}</p>
          <MuseumCopyForm
            memoryId={memory.id}
            museumId={scope!.museumId}
            targets={listSwitcherMuseumsInDatabase(getDatabase(), scope!.userId).filter(
              (museum) =>
                museum.id !== scope!.museumId &&
                getDatabase().prepare("SELECT status FROM museums WHERE id=?").get(museum.id)
                  ?.status === "active",
            )}
          />
        </details>
        <MemoryManagement
          memory={memory}
          museumId={scope!.museumId}
          candidates={listScopedMemories(getDatabase(), scope!)}
          stages={stages}
          exhibits={exhibits}
          libraryPhotos={libraryPhotos}
          libraryNextCursor={libraryPage.nextCursor}
        />
        {scope?.role === "owner" ? (
          <ShareManager
            memoryId={memory.id}
            publiclyVisible={
              memory.isPublic &&
              (!memory.stageId ||
                stages.some((stage) => stage.id === memory.stageId && stage.isPublic))
            }
          />
        ) : null}
      </section>
    </article>
  );
}
