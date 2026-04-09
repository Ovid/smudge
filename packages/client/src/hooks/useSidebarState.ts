import { useState, useCallback } from "react";

const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_KEY = "smudge:sidebar-width";

function getSavedSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

export function useSidebarState() {
  const [sidebarWidth, setSidebarWidth] = useState(getSavedSidebarWidth);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleSidebarResize = useCallback((newWidth: number) => {
    setSidebarWidth(newWidth);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(newWidth));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  return { sidebarWidth, sidebarOpen, setSidebarOpen, handleSidebarResize, toggleSidebar };
}
