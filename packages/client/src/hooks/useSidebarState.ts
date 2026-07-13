import { useState, useCallback } from "react";
import { numberInRange, usePersistedState } from "./usePersistedState";

const SIDEBAR_DEFAULT_WIDTH = 260;
// Exported: Sidebar.tsx imports these for its drag clamp, its keyboard clamps,
// AND its aria-valuemin/aria-valuemax on the resize separator. Do not inline
// them into the codec call.
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_KEY = "smudge:sidebar-width";

const SIDEBAR_WIDTH_CODEC = numberInRange(
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
);

export function useSidebarState() {
  const [sidebarWidth, handleSidebarResize] = usePersistedState(
    SIDEBAR_WIDTH_KEY,
    SIDEBAR_WIDTH_CODEC,
  );
  // Session-only by design: the sidebar reopens on every load. Persisting it is
  // a product change, not a storage one.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  return { sidebarWidth, sidebarOpen, setSidebarOpen, handleSidebarResize, toggleSidebar };
}
