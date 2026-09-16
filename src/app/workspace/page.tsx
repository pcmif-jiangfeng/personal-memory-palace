import { PageIntro } from "@/components/page-intro";
import { PhotoWorkspace } from "@/components/photo-workspace";
import { listWorkspacePhotos } from "@/data/photo-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { isOwner } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PhotoWorkspacePage() {
  if (!(await isOwner())) redirect("/login");
  const photos = listWorkspacePhotos().map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    src: imageStorage.resolve(photo.optimizedStorageKey).publicPath,
    hasOriginal: Boolean(photo.originalStorageKey),
  }));
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.workspace.title} description={copy.workspace.description} />
      <PhotoWorkspace initialPhotos={photos} />
    </section>
  );
}
