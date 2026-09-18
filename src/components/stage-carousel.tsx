"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  adjacentStageIndex,
  carouselBoundaryState,
  closestStageIndex,
  normalizeStageOffsets,
  type CarouselBoundaryState,
} from "./stage-carousel-geometry";
import { copy } from "@/i18n/zh-CN";

const initialBoundaryState: CarouselBoundaryState = {
  canScroll: false,
  atStart: true,
  atEnd: true,
};

export function StageCarousel({ children, itemCount }: { children: ReactNode; itemCount: number }) {
  const shelfRef = useRef<HTMLDivElement>(null);
  const pendingIndexRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [boundary, setBoundary] = useState(initialBoundaryState);

  useEffect(() => {
    const shelfElement = shelfRef.current;
    if (!shelfElement) return;
    const shelf: HTMLDivElement = shelfElement;

    function stageCards() {
      return [...shelf.querySelectorAll<HTMLElement>("[data-stage-card]")];
    }

    function updateBoundary() {
      const cards = stageCards();
      const lastCard = cards.at(-1);
      const paddingRight = Number.parseFloat(getComputedStyle(shelf).paddingRight) || 0;
      const naturalContentWidth = lastCard
        ? lastCard.offsetLeft + lastCard.offsetWidth + paddingRight
        : 0;
      const naturalOverflow = naturalContentWidth > shelf.clientWidth + 2;
      const measured = carouselBoundaryState(
        shelf.scrollLeft,
        shelf.clientWidth,
        shelf.scrollWidth,
      );
      const next = {
        ...measured,
        canScroll: naturalOverflow,
        atEnd: naturalOverflow ? measured.atEnd : true,
      };
      setBoundary((current) =>
        current.canScroll === next.canScroll &&
        current.atStart === next.atStart &&
        current.atEnd === next.atEnd
          ? current
          : next,
      );
    }

    function finishScrolling() {
      const offsets = normalizeStageOffsets(stageCards().map((card) => card.offsetLeft));
      pendingIndexRef.current = closestStageIndex(offsets, shelf.scrollLeft);
      updateBoundary();
    }

    function handleScroll() {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(updateBoundary);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(finishScrolling, 160);
    }

    function clearPendingTarget() {
      pendingIndexRef.current = null;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    }

    function handleWheel(event: WheelEvent) {
      clearPendingTarget();
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const state = carouselBoundaryState(shelf.scrollLeft, shelf.clientWidth, shelf.scrollWidth);
      const canMove = event.deltaY < 0 ? !state.atStart : !state.atEnd;
      if (!canMove) return;
      event.preventDefault();
      shelf.scrollLeft += event.deltaY;
    }

    const resizeObserver = new ResizeObserver(updateBoundary);
    resizeObserver.observe(shelf);
    stageCards().forEach((card) => resizeObserver.observe(card));
    shelf.addEventListener("scroll", handleScroll, { passive: true });
    shelf.addEventListener("wheel", handleWheel, { passive: false });
    shelf.addEventListener("pointerdown", clearPendingTarget, { passive: true });
    window.addEventListener("resize", updateBoundary);
    updateBoundary();

    return () => {
      resizeObserver.disconnect();
      shelf.removeEventListener("scroll", handleScroll);
      shelf.removeEventListener("wheel", handleWheel);
      shelf.removeEventListener("pointerdown", clearPendingTarget);
      window.removeEventListener("resize", updateBoundary);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [itemCount]);

  function move(direction: -1 | 1) {
    const shelf = shelfRef.current;
    if (!shelf) return;
    const cards = [...shelf.querySelectorAll<HTMLElement>("[data-stage-card]")];
    const offsets = normalizeStageOffsets(cards.map((card) => card.offsetLeft));
    const nextIndex = adjacentStageIndex(
      offsets,
      shelf.scrollLeft,
      direction,
      pendingIndexRef.current,
    );
    if (nextIndex < 0) return;
    pendingIndexRef.current = nextIndex;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    shelf.scrollTo({
      left: offsets[nextIndex],
      behavior: reducedMotion ? "auto" : "smooth",
    });
    setBoundary((current) => ({
      ...current,
      atStart: nextIndex === 0,
      atEnd: nextIndex === offsets.length - 1,
    }));
  }

  return (
    <div className="stage-carousel">
      {boundary.canScroll ? (
        <div className="stage-carousel-controls">
          <button
            type="button"
            className="stage-carousel-control stage-carousel-previous"
            aria-label={copy.gallery.previousStage}
            disabled={boundary.atStart}
            onClick={() => move(-1)}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            className="stage-carousel-control stage-carousel-next"
            aria-label={copy.gallery.nextStage}
            disabled={boundary.atEnd}
            onClick={() => move(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
      <div ref={shelfRef} className={`stage-shelf${boundary.canScroll ? " is-scrollable" : ""}`}>
        {children}
      </div>
    </div>
  );
}
