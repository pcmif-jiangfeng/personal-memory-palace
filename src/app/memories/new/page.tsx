import { MemoryEditor } from "@/components/memory-editor";
import { PageIntro } from "@/components/page-intro";
import { listActiveMemories, listActiveStages } from "@/data/memory-repository";
import { listUploadedPhotosByIds } from "@/data/photo-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { isOwner } from "@/auth";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MemoryEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ photos?: string | string[] }>;
}) {
  if (!(await isOwner())) notFound();
  const params = await searchParams;
  const rawPhotoIds = Array.isArray(params.photos)
    ? params.photos.join(",")
    : (params.photos ?? "");
  const selectedIds = rawPhotoIds.split(",").filter(Boolean);
  const photos = listUploadedPhotosByIds(selectedIds).map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    src: imageStorage.resolve(photo.optimizedStorageKey).publicPath,
  }));
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.editor.title} description={copy.editor.description} />
      <MemoryEditor photos={photos} stages={listActiveStages()} memories={listActiveMemories()} />
    </section>
  );
}
