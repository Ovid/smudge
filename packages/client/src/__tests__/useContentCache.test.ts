import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import {
  getCachedContent,
  setCachedContent,
  clearCachedContent,
  clearAllCachedContent,
} from "../hooks/useContentCache";

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
  let warnSpy: MockInstance;

  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    // Reset implementations in case a test overrode them
    mockLocalStorage.getItem.mockImplementation((key: string) => store.get(key) ?? null);
    mockLocalStorage.setItem.mockImplementation((key: string, value: string) =>
      store.set(key, value),
    );
    mockLocalStorage.removeItem.mockImplementation((key: string) => store.delete(key));
  });

  describe("getCachedContent", () => {
    it("returns parsed content when key exists", () => {
      const content = { type: "doc", content: [{ type: "paragraph" }] };
      store.set("smudge:draft:ch-1", JSON.stringify(content));

      const result = getCachedContent("ch-1");

      expect(result).toEqual(content);
    });

    it("returns null when key doesn't exist", () => {
      const result = getCachedContent("nonexistent");

      expect(result).toBeNull();
    });

    it("returns null and warns when localStorage.getItem throws", () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error("unavailable");
      });

      const result = getCachedContent("ch-1");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "[useContentCache] getCachedContent failed:",
        expect.any(Error),
      );
    });

    it("returns null when stored value is invalid JSON", () => {
      store.set("smudge:draft:ch-1", "not valid json {{{");

      const result = getCachedContent("ch-1");

      expect(result).toBeNull();
    });
  });

  describe("setCachedContent", () => {
    it("stores stringified content and returns true", () => {
      const content = { type: "doc", content: [{ type: "paragraph" }] };

      const result = setCachedContent("ch-2", content);

      expect(result).toBe(true);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "smudge:draft:ch-2",
        JSON.stringify(content),
      );
      expect(store.get("smudge:draft:ch-2")).toBe(JSON.stringify(content));
    });

    it("returns false and warns when localStorage.setItem throws", () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      const result = setCachedContent("ch-2", { type: "doc" });

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        "[useContentCache] setCachedContent failed:",
        expect.any(Error),
      );
    });
  });

  describe("clearAllCachedContent", () => {
    it("removes every smudge:draft:* key and leaves unrelated keys in place", () => {
      store.set("smudge:draft:ch-a", "{}");
      store.set("smudge:draft:ch-b", "{}");
      store.set("smudge:other", "keep-me");

      clearAllCachedContent();

      expect(store.has("smudge:draft:ch-a")).toBe(false);
      expect(store.has("smudge:draft:ch-b")).toBe(false);
      expect(store.has("smudge:other")).toBe(true);
    });

    it("warns when localStorage throws during iteration", () => {
      mockLocalStorage.key.mockImplementation(() => {
        throw new Error("unavailable");
      });
      store.set("smudge:draft:ch-a", "{}");

      expect(() => {
        clearAllCachedContent();
      }).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        "[useContentCache] clearAllCachedContent failed:",
        expect.any(Error),
      );
    });
  });

  describe("clearCachedContent", () => {
    it("removes the key", () => {
      store.set("smudge:draft:ch-3", '{"type":"doc"}');

      clearCachedContent("ch-3");

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith("smudge:draft:ch-3");
      expect(store.has("smudge:draft:ch-3")).toBe(false);
    });

    it("warns when localStorage.removeItem throws", () => {
      mockLocalStorage.removeItem.mockImplementation(() => {
        throw new Error("unavailable");
      });

      expect(() => {
        clearCachedContent("ch-3");
      }).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        "[useContentCache] clearCachedContent failed:",
        expect.any(Error),
      );
    });
  });
});
