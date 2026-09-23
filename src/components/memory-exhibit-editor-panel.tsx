import type { ExhibitEditorController, ExhibitPhotoView } from "@/components/use-exhibit-editor";
import { copy } from "@/i18n/zh-CN";

export function MemoryExhibitEditorPanel({
  exhibits,
  editor,
  busy,
  onSelect,
  onSetCover,
}: {
  exhibits: ExhibitPhotoView[];
  editor: ExhibitEditorController;
  busy: boolean;
  onSelect: (photo: ExhibitPhotoView) => void;
  onSetCover: (photoId: string) => void;
}) {
  const {
    draft,
    moveSelected,
    removeSelected,
    saveMetadata,
    selectedPhoto: selected,
    updateDraft,
  } = editor;

  if (exhibits.length === 0) {
    return <p className="quiet-empty">{copy.exhibits.empty}</p>;
  }

  return (
    <>
      <div className="memory-exhibit-strip" aria-label={copy.exhibits.currentPhotos}>
        {exhibits.map((photo, index) => (
          <button
            type="button"
            key={photo.photoId}
            className={photo.photoId === selected?.photoId ? "is-selected" : ""}
            aria-pressed={photo.photoId === selected?.photoId}
            onClick={() => onSelect(photo)}
          >
            <img src={photo.src} alt={photo.name} />
            <span>{index + 1}</span>
            {photo.isCover ? <strong>{copy.exhibits.coverBadge}</strong> : null}
          </button>
        ))}
      </div>

      {selected ? (
        <section className="memory-exhibit-inspector">
          <img src={selected.src} alt={selected.name} />
          <div>
            <p>{selected.name}</p>
            <div className="memory-exhibit-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={busy || selected.isCover}
                onClick={() => onSetCover(selected.photoId)}
              >
                {selected.isCover ? copy.exhibits.currentCover : copy.exhibits.setCover}
              </button>
              <button
                type="button"
                disabled={busy || exhibits[0]?.photoId === selected.photoId}
                onClick={() => void moveSelected(-1)}
              >
                {copy.exhibits.moveEarlier}
              </button>
              <button
                type="button"
                disabled={busy || exhibits.at(-1)?.photoId === selected.photoId}
                onClick={() => void moveSelected(1)}
              >
                {copy.exhibits.moveLater}
              </button>
              <button
                type="button"
                className="text-button danger"
                disabled={busy}
                onClick={() => void removeSelected()}
              >
                {copy.exhibits.remove}
              </button>
            </div>
            <form
              className="memory-exhibit-metadata"
              onSubmit={(event) => {
                event.preventDefault();
                void saveMetadata();
              }}
            >
              <label className="form-field">
                <span>{copy.exhibits.exhibitTitle}</span>
                <input
                  name="exhibitTitle"
                  value={draft.title}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  maxLength={120}
                />
              </label>
              <label className="form-field">
                <span>{copy.exhibits.exhibitDescription}</span>
                <textarea
                  name="exhibitDescription"
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                  maxLength={2000}
                  rows={4}
                />
              </label>
              <button className="button-secondary" type="submit" disabled={busy}>
                {copy.exhibits.saveMetadata}
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </>
  );
}
