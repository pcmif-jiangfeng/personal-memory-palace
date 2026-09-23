"use client";

import Link from "next/link";
import { useState } from "react";
import { copy } from "@/i18n/zh-CN";
import { imageVariantUrl } from "@/components/image-variant-url";

export interface StageCoverPhotoOption {
  id: string;
  name: string;
  src: string;
  storageKey: string;
}

const candidatePageSize = 18;

export function StageCoverSelector({
  photos,
  initialPhotoId,
  currentCoverUnavailable = false,
  initiallyExpanded = false,
}: {
  photos: StageCoverPhotoOption[];
  initialPhotoId: string;
  currentCoverUnavailable?: boolean;
  initiallyExpanded?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(
    currentCoverUnavailable ? "__unavailable__" : initialPhotoId,
  );
  const [selectionChanged, setSelectionChanged] = useState(false);
  const [failedPhotoIds, setFailedPhotoIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [visibleCount, setVisibleCount] = useState(candidatePageSize);
  const selectedPhoto = photos.find((photo) => photo.id === selectedId);
  const initialPhoto = photos.find((photo) => photo.id === initialPhotoId);
  const selectedPhotoFailed = selectedPhoto ? failedPhotoIds.has(selectedPhoto.id) : false;
  const showUnavailable = selectedPhotoFailed || (currentCoverUnavailable && !selectionChanged);
  const orderedPhotos = initialPhoto
    ? [initialPhoto, ...photos.filter((photo) => photo.id !== initialPhoto.id)]
    : photos;
  const visiblePhotos = orderedPhotos.slice(0, visibleCount);
  const hasMorePhotos = visiblePhotos.length < orderedPhotos.length;

  function selectPhoto(photoId: string) {
    setSelectedId(photoId);
    setSelectionChanged(true);
  }

  function selectPhotoWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, photoId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectPhoto(photoId);
  }

  function recordImageFailure(photoId: string) {
    setFailedPhotoIds((current) => {
      const next = new Set(current);
      next.add(photoId);
      return next;
    });
  }

  return (
    <fieldset className="stage-cover-selector">
      <legend>{copy.stage.cover}</legend>
      <input type="hidden" name="coverPhotoId" value={selectedPhoto ? selectedPhoto.id : ""} />

      <div className="stage-cover-preview" aria-live="polite">
        {selectedPhoto && !selectedPhotoFailed ? (
          <img
            src={imageVariantUrl(selectedPhoto.src)}
            alt={copy.stage.previewAlt(selectedPhoto.name)}
            onError={() => recordImageFailure(selectedPhoto.id)}
          />
        ) : (
          <div className="stage-cover-preview-empty">
            <span aria-hidden="true">◇</span>
            <strong>
              {showUnavailable ? copy.stage.unavailableCover : copy.stage.noCoverPreview}
            </strong>
          </div>
        )}
      </div>

      {photos.length > 0 ? (
        <>
          <div className="stage-cover-browser-heading">
            <span>{copy.stage.candidateCount(photos.length)}</span>
            <button
              type="button"
              className="text-button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? copy.stage.hideCandidates : copy.stage.browseCandidates}
            </button>
          </div>
          {expanded ? (
            <div
              className="stage-cover-candidate-browser"
              role="group"
              aria-label={`${copy.stage.candidates}。${copy.stage.coverHint}`}
            >
              <div className="stage-cover-candidates">
                <button
                  type="button"
                  className={`stage-cover-option${selectedId === "" ? " is-selected" : ""}`}
                  aria-pressed={selectedId === ""}
                  onClick={() => selectPhoto("")}
                  onKeyDown={(event) => selectPhotoWithKeyboard(event, "")}
                >
                  <span className="stage-cover-none" aria-hidden="true">
                    —
                  </span>
                  <span className="stage-cover-option-state">
                    {selectedId === "" ? copy.stage.selected : copy.stage.noCover}
                  </span>
                </button>
                {visiblePhotos.map((photo) => {
                  const selected = selectedId === photo.id;
                  const failed = failedPhotoIds.has(photo.id);
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      className={`stage-cover-option${selected ? " is-selected" : ""}${failed ? " is-unavailable" : ""}`}
                      aria-label={copy.stage.coverOptionLabel(photo.name)}
                      aria-pressed={selected}
                      disabled={failed}
                      onClick={() => selectPhoto(photo.id)}
                      onKeyDown={(event) => selectPhotoWithKeyboard(event, photo.id)}
                    >
                      {failed ? (
                        <span className="stage-cover-none" aria-hidden="true">
                          ×
                        </span>
                      ) : (
                        <img
                          src={imageVariantUrl(photo.src)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={() => recordImageFailure(photo.id)}
                        />
                      )}
                      <span className="stage-cover-option-state">
                        {selected ? copy.stage.selected : copy.stage.chooseCover}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="stage-cover-pagination">
                <span>{copy.stage.shownCandidates(visiblePhotos.length, photos.length)}</span>
                {hasMorePhotos ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setVisibleCount((current) => current + candidatePageSize)}
                  >
                    {copy.stage.loadMoreCandidates}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="stage-cover-empty-state">
          <p>{copy.stage.noCandidates}</p>
          <Link className="text-link" href="/workspace">
            {copy.stage.addPhotos}
          </Link>
        </div>
      )}

      <div className="stage-cover-status">
        <span>{copy.stage.coverStatus}</span>
        <p>
          {selectedPhoto && !selectedPhotoFailed
            ? copy.stage.selectedCoverStatus
            : showUnavailable
              ? copy.stage.unavailableCoverHint
              : copy.stage.noCoverStatus}
        </p>
      </div>
    </fieldset>
  );
}
