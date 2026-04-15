import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => store.set(key, value)),
  removeItem: vi.fn((key: string) => store.delete(key)),
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

describe("useReferencePanelState", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    mockLocalStorage.getItem.mockImplementation((key: string) => store.get(key) ?? null);
    mockLocalStorage.setItem.mockImplementation((key: string, value: string) =>
      store.set(key, value),
    );
  });

  async function loadHook() {
    return await import("../hooks/useReferencePanelState");
  }

  describe("default state", () => {
    it("starts closed with width 320", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelOpen).toBe(false);
      expect(result.current.panelWidth).toBe(320);
    });
  });

  describe("togglePanel", () => {
    it("toggles open and closed", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelOpen).toBe(false);

      act(() => {
        result.current.togglePanel();
      });
      expect(result.current.panelOpen).toBe(true);

      act(() => {
        result.current.togglePanel();
      });
      expect(result.current.panelOpen).toBe(false);
    });

    it("persists state to localStorage", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      act(() => {
        result.current.togglePanel();
      });

      expect(store.get("smudge:ref-panel-open")).toBe("true");

      act(() => {
        result.current.togglePanel();
      });

      expect(store.get("smudge:ref-panel-open")).toBe("false");
    });
  });

  describe("setPanelOpen", () => {
    it("sets panel open state directly", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      act(() => {
        result.current.setPanelOpen(true);
      });
      expect(result.current.panelOpen).toBe(true);
      expect(store.get("smudge:ref-panel-open")).toBe("true");

      act(() => {
        result.current.setPanelOpen(false);
      });
      expect(result.current.panelOpen).toBe(false);
      expect(store.get("smudge:ref-panel-open")).toBe("false");
    });
  });

  describe("handlePanelResize", () => {
    it("updates width and persists to localStorage", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      act(() => {
        result.current.handlePanelResize(400);
      });

      expect(result.current.panelWidth).toBe(400);
      expect(store.get("smudge:ref-panel-width")).toBe("400");
    });

    it("clamps width below minimum to 240", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      act(() => {
        result.current.handlePanelResize(100);
      });

      expect(result.current.panelWidth).toBe(240);
      expect(store.get("smudge:ref-panel-width")).toBe("240");
    });

    it("clamps width above maximum to 480", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      act(() => {
        result.current.handlePanelResize(600);
      });

      expect(result.current.panelWidth).toBe(480);
      expect(store.get("smudge:ref-panel-width")).toBe("480");
    });
  });

  describe("reads initial state from localStorage", () => {
    it("reads saved width", async () => {
      store.set("smudge:ref-panel-width", "350");
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelWidth).toBe(350);
    });

    it("reads saved open state", async () => {
      store.set("smudge:ref-panel-open", "true");
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelOpen).toBe(true);
    });
  });

  describe("handles invalid localStorage values gracefully", () => {
    it("falls back to default width for NaN", async () => {
      store.set("smudge:ref-panel-width", "not-a-number");
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelWidth).toBe(320);
    });

    it("falls back to default width for out-of-range value", async () => {
      store.set("smudge:ref-panel-width", "50");
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelWidth).toBe(320);
    });

    it("falls back to default open state for non-boolean", async () => {
      store.set("smudge:ref-panel-open", "garbage");
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelOpen).toBe(false);
    });

    it("falls back to defaults when localStorage throws", async () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error("unavailable");
      });
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      expect(result.current.panelWidth).toBe(320);
      expect(result.current.panelOpen).toBe(false);
    });

    it("handles localStorage.setItem throwing on resize", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      act(() => {
        result.current.handlePanelResize(400);
      });

      // State still updates even if persistence fails
      expect(result.current.panelWidth).toBe(400);
    });

    it("handles localStorage.setItem throwing on toggle", async () => {
      const { useReferencePanelState } = await loadHook();
      const { result } = renderHook(() => useReferencePanelState());

      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      act(() => {
        result.current.togglePanel();
      });

      // State still updates even if persistence fails
      expect(result.current.panelOpen).toBe(true);
    });
  });

  describe("exported constants", () => {
    it("exports PANEL_MIN_WIDTH as 240", async () => {
      const { PANEL_MIN_WIDTH } = await loadHook();
      expect(PANEL_MIN_WIDTH).toBe(240);
    });

    it("exports PANEL_MAX_WIDTH as 480", async () => {
      const { PANEL_MAX_WIDTH } = await loadHook();
      expect(PANEL_MAX_WIDTH).toBe(480);
    });
  });
});
