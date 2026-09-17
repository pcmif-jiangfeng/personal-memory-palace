import Link from "next/link";
import type { StageShelfItem } from "@/domain/models";
import { copy } from "@/i18n/zh-CN";
import { imageStorage } from "@/storage/local-image-storage";

export function StageCard({ stage, index }: { stage: StageShelfItem; index: number }) {
  const coverKey = stage.coverKey ?? stage.previewImageKeys[0] ?? null;
  const coverPath = coverKey ? imageStorage.resolve(coverKey).publicPath : null;
  return (
    <article className={`stage-volume stage-tone-${index % 3}`}>
      <div className="stage-preview-stack" aria-hidden="true">
        {stage.previewImageKeys.map((key, previewIndex) => (
          <div className={`stage-preview stage-preview-${previewIndex + 1}`} key={key}>
            <img src={imageStorage.resolve(key).publicPath} alt="" />
          </div>
        ))}
      </div>
      <Link
        className={`stage-book${coverPath ? " stage-book-with-cover" : ""}`}
        href={`/stages/${stage.id}`}
      >
        {coverPath ? <img className="stage-book-cover" src={coverPath} alt="" /> : null}
        <span className="stage-book-shade" />
        <div className="stage-book-copy">
          <span className="stage-book-index">CHAPTER {String(index + 1).padStart(2, "0")}</span>
          <h3>{stage.title}</h3>
          <p>{stage.description}</p>
          <div className="stage-book-footer">
            <span>{copy.stage.memoryCount(stage.memoryCount)}</span>
            <span>{copy.stage.enter} →</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
