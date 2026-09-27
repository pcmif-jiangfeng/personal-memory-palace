import { PageIntro } from "@/components/page-intro";
import { PhotoWorkspace } from "@/components/photo-workspace";
import { queryWorkspacePhotoCatalog } from "@/data/photo-repository";
import { listActiveStages } from "@/data/memory-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { memoryPageScope } from "@/memory-page-scope";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PhotoWorkspacePage({
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
  let source: "recent" | "library" = "recent";
  let page = queryWorkspacePhotoCatalog({ source, limit: 24 }, scope.museumId);
  if (page.items.length === 0) {
    source = "library";
    page = queryWorkspacePhotoCatalog({ source, limit: 24 }, scope.museumId);
  }
  const photos = page.items.map((photo) => ({
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
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.workspace.title} description={copy.workspace.description} />
      <PhotoWorkspace
        key={`${scope.museumId}:${source}:${photos[0]?.id ?? "empty"}:${photos.length}`}
        initialPhotos={photos}
        initialSource={source}
        initialNextCursor={page.nextCursor}
        museumId={scope.museumId}
        canDeletePhotos={scope.role === "owner"}
        stages={listActiveStages(false, scope.museumId).map((stage) => ({
          id: stage.id,
          title: stage.title,
        }))}
      />
    </section>
  );
}
