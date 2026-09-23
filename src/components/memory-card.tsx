import Link from "next/link";
import type { MemorySummary } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";
import { imageVariantUrl } from "@/components/image-variant-url";

export function MemoryCard({ memory }: { memory: MemorySummary }) {
  const imagePath = memory.coverKey ? imageStorage.resolve(memory.coverKey).publicPath : null;

  return (
    <Link className="memory-card" href={`/memories/${memory.id}`}>
      <div className="memory-card-image">
        {imagePath ? (
          <img src={imageVariantUrl(imagePath)} alt="" loading="lazy" />
        ) : (
          <span>Memory</span>
        )}
      </div>
      <div className="memory-card-copy">
        <p className="memory-card-stage">{memory.stageTitle ?? copy.common.uncategorized}</p>
        <h3>{memory.title}</h3>
        <p className="memory-card-story">{memory.story}</p>
        <div className="memory-card-footer">
          <span>{copy.common.imageCount(memory.imageCount)}</span>
          <span>{copy.gallery.enterMemory} →</span>
        </div>
      </div>
    </Link>
  );
}
