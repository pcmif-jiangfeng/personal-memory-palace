import { MemoryEditor } from "@/components/memory-editor";
import { PageIntro } from "@/components/page-intro";
import { listActiveStages } from "@/data/memory-repository";
import { listScopedMemories } from "@/data/scoped-memory";
import { getDatabase } from "@/data/database";
import { memoryPageScope } from "@/memory-page-scope";
import { listUploadedPhotosByIds } from "@/data/photo-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { unstable_rethrow, notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MemoryEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ photos?: string | string[]; museumId?: string }>;
}) {
  const params = await searchParams;
  let scope;
  try {
    scope = await memoryPageScope(params.museumId);
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
  if (!scope) notFound();
  const rawPhotoIds = Array.isArray(params.photos)
    ? params.photos.join(",")
    : (params.photos ?? "");
  const selectedIds = rawPhotoIds.split(",").filter(Boolean);
  const photos = listUploadedPhotosByIds(selectedIds, scope.museumId).map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    src: imageStorage.resolve(photo.optimizedStorageKey).publicPath,
  }));
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.editor.title} description={copy.editor.description} />
      <MemoryEditor
        museumId={scope.museumId}
        photos={photos}
        stages={listActiveStages(false, scope.museumId)}
        memories={listScopedMemories(getDatabase(), scope)}
      />
    </section>
  );
}
