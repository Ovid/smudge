import { useState, useCallback } from "react";

const PANEL_DEFAULT_WIDTH = 320;
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 480;
const PANEL_WIDTH_KEY = "smudge:ref-panel-width";
const PANEL_OPEN_KEY = "smudge:ref-panel-open";

function getSavedPanelWidth(): number {
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed >= PANEL_MIN_WIDTH && parsed <= PANEL_MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return PANEL_DEFAULT_WIDTH;
}

function getSavedPanelOpen(): boolean {
  try {
    const stored = localStorage.getItem(PANEL_OPEN_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // localStorage unavailable
  }
  return false;
}

export function useReferencePanelState() {
  const [panelWidth, setPanelWidth] = useState(getSavedPanelWidth);
  const [panelOpen, setPanelOpenState] = useState(getSavedPanelOpen);

  const handlePanelResize = useCallback((newWidth: number) => {
    const clamped = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, newWidth));
    setPanelWidth(clamped);
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenState(open);
    try {
      localStorage.setItem(PANEL_OPEN_KEY, String(open));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PANEL_OPEN_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  return { panelWidth, panelOpen, setPanelOpen, handlePanelResize, togglePanel };
}
