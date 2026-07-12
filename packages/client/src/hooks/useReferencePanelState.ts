import { useCallback } from "react";
import { flag, numberInRange, text, usePersistedState } from "../utils/persistedSetting";

const PANEL_DEFAULT_WIDTH = 320;
// Exported: ReferencePanel.tsx imports these for its drag clamp, its keyboard
// clamps, AND its aria-valuemin/aria-valuemax. Do not inline them into the
// codec call.
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 480;

const PANEL_WIDTH_KEY = "smudge:ref-panel-width";
const PANEL_OPEN_KEY = "smudge:ref-panel-open";
const PANEL_ACTIVE_TAB_KEY = "smudge:ref-panel-active-tab";
const PANEL_DEFAULT_ACTIVE_TAB = "images";

const PANEL_WIDTH_CODEC = numberInRange(PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, PANEL_DEFAULT_WIDTH);
const PANEL_OPEN_CODEC = flag(false);
// text(), not a validating codec: this hook does not know the tab set. An
// unknown id is degraded to tabs[0] by ReferencePanel, which does. (4c.0 [I1])
const PANEL_TAB_CODEC = text(PANEL_DEFAULT_ACTIVE_TAB);

export function useReferencePanelState() {
  const [panelWidth, handlePanelResize] = usePersistedState(PANEL_WIDTH_KEY, PANEL_WIDTH_CODEC);
  const [panelOpen, setPanelOpen] = usePersistedState(PANEL_OPEN_KEY, PANEL_OPEN_CODEC);
  const [activeTabId, setActiveTab] = usePersistedState(PANEL_ACTIVE_TAB_KEY, PANEL_TAB_CODEC);

  const togglePanel = useCallback(() => setPanelOpen((prev) => !prev), [setPanelOpen]);

  return {
    panelWidth,
    panelOpen,
    setPanelOpen,
    handlePanelResize,
    togglePanel,
    activeTabId,
    setActiveTab,
  };
}
