import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCachedContent,
  setCachedContent,
  clearCachedContent,
  clearAllCachedContent,
} from "../hooks/useContentCache";
import { expectConsole } from "./expectConsole";

// Vitest jsdom may not provide a fully standard localStorage.
// Replace it with a mock for predictable behavior.
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => store.set(key, value)),
  removeItem: vi.fn((key: string) => store.delete(key)),
  get length() {
    return store.size;
  },
  key: vi.fn((i: number) => Array.from(store.keys())[i] ?? null),
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

describe("useContentCache", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset implementations in case a test overrode them
    mockLocalStorage.getItem.mockImplementation((key: string) => store.get(key) ?? null);
    mockLocalStorage.setItem.mockImplementation((key: string, value: string) =>
      store.set(key, value),
    );
    mockLocalStorage.removeItem.mockImplementation((key: string) => store.delete(key));
  });

  describe("getCachedContent", () => {
    it("returns parsed content when key exists", () => {
      const warn = expectConsole("warn");
      const content = { type: "doc", content: [{ type: "paragraph" }] };
      store.set("smudge:draft:ch-1", JSON.stringify(content));

      const result = getCachedContent("ch-1");

      expect(result).toEqual(content);
      warn.silent();
    });

    it("returns null when key doesn't exist", () => {
      const warn = expectConsole("warn");
      const result = getCachedContent("nonexistent");

      expect(result).toBeNull();
      warn.silent();
    });

    it("returns null and warns when localStorage.getItem throws", () => {
      const warn = expectConsole("warn");
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error("unavailable");
      });

      const result = getCachedContent("ch-1");

      expect(result).toBeNull();
      warn.calledWith("[useContentCache] getCachedContent failed:", expect.any(Error));
    });

    it("returns null when stored value is invalid JSON", () => {
      // JSON.parse throws inside getCachedContent's try, so the catch logs a
      // warning. The block suppressor previously swallowed it; pin it here.
      const warn = expectConsole("warn");
      store.set("smudge:draft:ch-1", "not valid json {{{");

      const result = getCachedContent("ch-1");

      expect(result).toBeNull();
      warn.calledWith("[useContentCache] getCachedContent failed:", expect.any(Error));
    });
  });

  describe("setCachedContent", () => {
    it("stores stringified content and returns true", () => {
      const warn = expectConsole("warn");
      const content = { type: "doc", content: [{ type: "paragraph" }] };

      const result = setCachedContent("ch-2", content);

      expect(result).toBe(true);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "smudge:draft:ch-2",
        JSON.stringify(content),
      );
      expect(store.get("smudge:draft:ch-2")).toBe(JSON.stringify(content));
      warn.silent();
    });

    it("returns false and warns when localStorage.setItem throws", () => {
      const warn = expectConsole("warn");
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      const result = setCachedContent("ch-2", { type: "doc" });

      expect(result).toBe(false);
      warn.calledWith("[useContentCache] setCachedContent failed:", expect.any(Error));
    });
  });

  describe("clearAllCachedContent", () => {
    it("removes only the supplied chapter IDs and leaves other drafts untouched (I2)", () => {
      const warn = expectConsole("warn");
      store.set("smudge:draft:ch-a", "{}");
      store.set("smudge:draft:ch-b", "{}");
      store.set("smudge:draft:ch-other-project", "{}");
      store.set("smudge:other", "keep-me");

      clearAllCachedContent(["ch-a", "ch-b"]);

      expect(store.has("smudge:draft:ch-a")).toBe(false);
      expect(store.has("smudge:draft:ch-b")).toBe(false);
      // Cross-project draft survives — previous flat-namespace implementation
      // would wipe it.
      expect(store.has("smudge:draft:ch-other-project")).toBe(true);
      expect(store.has("smudge:other")).toBe(true);
      warn.silent();
    });

    it("is a no-op for an empty list", () => {
      const warn = expectConsole("warn");
      store.set("smudge:draft:ch-a", "{}");
      clearAllCachedContent([]);
      expect(store.has("smudge:draft:ch-a")).toBe(true);
      warn.silent();
    });

    it("warns when localStorage throws during removal", () => {
      const warn = expectConsole("warn");
      mockLocalStorage.removeItem.mockImplementation(() => {
        throw new Error("unavailable");
      });

      expect(() => {
        clearAllCachedContent(["ch-a"]);
      }).not.toThrow();
      warn.calledWith("[useContentCache] clearAllCachedContent failed:", expect.any(Error));
    });
  });

  describe("clearCachedContent", () => {
    it("removes the key", () => {
      const warn = expectConsole("warn");
      store.set("smudge:draft:ch-3", '{"type":"doc"}');

      clearCachedContent("ch-3");

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith("smudge:draft:ch-3");
      expect(store.has("smudge:draft:ch-3")).toBe(false);
      warn.silent();
    });

    it("warns when localStorage.removeItem throws", () => {
      const warn = expectConsole("warn");
      mockLocalStorage.removeItem.mockImplementation(() => {
        throw new Error("unavailable");
      });

      expect(() => {
        clearCachedContent("ch-3");
      }).not.toThrow();
      warn.calledWith("[useContentCache] clearCachedContent failed:", expect.any(Error));
    });
  });
});
