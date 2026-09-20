"use client";

import { useCallback, useEffect, useState } from "react";

const CONTROL_HIDE_DELAY = 2800;

type ViewerControlState = {
  isOpen: boolean;
  isMobile: boolean;
  isInteracting: boolean;
  autoHidePaused: boolean;
};

export function shouldAutoHideViewerControls({
  isOpen,
  isMobile,
  isInteracting,
  autoHidePaused,
}: ViewerControlState): boolean {
  return isOpen && isMobile && !isInteracting && !autoHidePaused;
}

export function useViewerControls({
  isOpen,
  isInteracting,
  autoHidePaused,
}: Omit<ViewerControlState, "isMobile">) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activityVersion, setActivityVersion] = useState(0);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    setActivityVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    if (!shouldAutoHideViewerControls({ isOpen, isMobile, isInteracting, autoHidePaused })) {
      return;
    }
    const timer = window.setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY);
    return () => window.clearTimeout(timer);
  }, [activityVersion, autoHidePaused, isInteracting, isOpen]);

  return { controlsVisible, revealControls };
}
