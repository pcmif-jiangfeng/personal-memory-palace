import { PageIntro } from "@/components/page-intro";
import { StageManager } from "@/components/stage-manager";
import { listActiveStages } from "@/data/memory-repository";
import { listAllUploadedPhotos } from "@/data/photo-repository";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { isOwner } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function StagesPage() {
  if (!(await isOwner())) redirect("/login");
  const photos = listAllUploadedPhotos().map((photo) => ({
    id: photo.id,
    name: photo.originalName,
    storageKey: photo.optimizedStorageKey,
    src: imageStorage.resolve(photo.optimizedStorageKey).publicPath,
  }));
  return (
    <section className="section-shell skeleton-page">
      <PageIntro title={copy.stage.manageTitle} description={copy.stage.manageDescription} />
      <StageManager stages={listActiveStages()} photos={photos} />
    </section>
  );
}
