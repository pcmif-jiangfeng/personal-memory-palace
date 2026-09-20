import assert from "node:assert/strict";
import test from "node:test";
import { shouldAutoHideViewerControls } from "../src/components/use-viewer-controls.ts";

test("auto-hides viewer controls only for an idle open mobile viewer", () => {
  assert.equal(
    shouldAutoHideViewerControls({
      isOpen: true,
      isMobile: true,
      isInteracting: false,
      autoHidePaused: false,
    }),
    true,
  );
  assert.equal(
    shouldAutoHideViewerControls({
      isOpen: false,
      isMobile: true,
      isInteracting: false,
      autoHidePaused: false,
    }),
    false,
  );
  assert.equal(
    shouldAutoHideViewerControls({
      isOpen: true,
      isMobile: false,
      isInteracting: false,
      autoHidePaused: false,
    }),
    false,
  );
  assert.equal(
    shouldAutoHideViewerControls({
      isOpen: true,
      isMobile: true,
      isInteracting: true,
      autoHidePaused: false,
    }),
    false,
  );
  assert.equal(
    shouldAutoHideViewerControls({
      isOpen: true,
      isMobile: true,
      isInteracting: false,
      autoHidePaused: true,
    }),
    false,
  );
});
