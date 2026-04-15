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

describe("useSidebarState", () => {
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
    return await import("../hooks/useSidebarState");
  }

  describe("default state", () => {
    it("starts open with default width 260", async () => {
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarOpen).toBe(true);
      expect(result.current.sidebarWidth).toBe(260);
    });
  });

  describe("exported constants", () => {
    it("exports SIDEBAR_MIN_WIDTH as 180", async () => {
      const { SIDEBAR_MIN_WIDTH } = await loadHook();
      expect(SIDEBAR_MIN_WIDTH).toBe(180);
    });

    it("exports SIDEBAR_MAX_WIDTH as 480", async () => {
      const { SIDEBAR_MAX_WIDTH } = await loadHook();
      expect(SIDEBAR_MAX_WIDTH).toBe(480);
    });
  });

  describe("toggleSidebar", () => {
    it("toggles open and closed", async () => {
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarOpen).toBe(true);

      act(() => {
        result.current.toggleSidebar();
      });
      expect(result.current.sidebarOpen).toBe(false);

      act(() => {
        result.current.toggleSidebar();
      });
      expect(result.current.sidebarOpen).toBe(true);
    });
  });

  describe("setSidebarOpen", () => {
    it("sets sidebar open state directly", async () => {
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      act(() => {
        result.current.setSidebarOpen(false);
      });
      expect(result.current.sidebarOpen).toBe(false);

      act(() => {
        result.current.setSidebarOpen(true);
      });
      expect(result.current.sidebarOpen).toBe(true);
    });
  });

  describe("handleSidebarResize", () => {
    it("updates width and persists to localStorage", async () => {
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      act(() => {
        result.current.handleSidebarResize(300);
      });

      expect(result.current.sidebarWidth).toBe(300);
      expect(store.get("smudge:sidebar-width")).toBe("300");
    });

    it("persists width on every resize call", async () => {
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      act(() => {
        result.current.handleSidebarResize(200);
      });
      expect(store.get("smudge:sidebar-width")).toBe("200");

      act(() => {
        result.current.handleSidebarResize(350);
      });
      expect(store.get("smudge:sidebar-width")).toBe("350");
    });
  });

  describe("reads initial width from localStorage", () => {
    it("reads a valid saved width", async () => {
      store.set("smudge:sidebar-width", "300");
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarWidth).toBe(300);
    });

    it("reads saved width at minimum boundary", async () => {
      store.set("smudge:sidebar-width", "180");
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarWidth).toBe(180);
    });

    it("reads saved width at maximum boundary", async () => {
      store.set("smudge:sidebar-width", "480");
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarWidth).toBe(480);
    });
  });

  describe("handles invalid localStorage values gracefully", () => {
    it("falls back to default width for NaN", async () => {
      store.set("smudge:sidebar-width", "not-a-number");
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarWidth).toBe(260);
    });

    it("falls back to default width for value below minimum", async () => {
      store.set("smudge:sidebar-width", "50");
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarWidth).toBe(260);
    });

    it("falls back to default width for value above maximum", async () => {
      store.set("smudge:sidebar-width", "999");
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarWidth).toBe(260);
    });

    it("falls back to default when localStorage.getItem throws", async () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error("unavailable");
      });
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current.sidebarWidth).toBe(260);
    });

    it("handles localStorage.setItem throwing on resize", async () => {
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      act(() => {
        result.current.handleSidebarResize(350);
      });

      // State still updates even if persistence fails
      expect(result.current.sidebarWidth).toBe(350);
    });
  });

  describe("return value shape", () => {
    it("returns all expected properties", async () => {
      const { useSidebarState } = await loadHook();
      const { result } = renderHook(() => useSidebarState());

      expect(result.current).toEqual(
        expect.objectContaining({
          sidebarWidth: expect.any(Number),
          sidebarOpen: expect.any(Boolean),
          setSidebarOpen: expect.any(Function),
          handleSidebarResize: expect.any(Function),
          toggleSidebar: expect.any(Function),
        }),
      );
    });
  });
});
