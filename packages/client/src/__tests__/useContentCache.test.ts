import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCachedContent, setCachedContent, clearCachedContent } from "../hooks/useContentCache";

// Vitest jsdom may not provide a fully standard localStorage.
// Replace it with a mock for predictable behavior.
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
      const content = { type: "doc", content: [{ type: "paragraph" }] };
      store.set("smudge:draft:ch-1", JSON.stringify(content));

      const result = getCachedContent("ch-1");

      expect(result).toEqual(content);
    });

    it("returns null when key doesn't exist", () => {
      const result = getCachedContent("nonexistent");

      expect(result).toBeNull();
    });

    it("returns null when localStorage.getItem throws", () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error("unavailable");
      });

      const result = getCachedContent("ch-1");

      expect(result).toBeNull();
    });

    it("returns null when stored value is invalid JSON", () => {
      store.set("smudge:draft:ch-1", "not valid json {{{");

      const result = getCachedContent("ch-1");

      expect(result).toBeNull();
    });
  });

  describe("setCachedContent", () => {
    it("stores stringified content", () => {
      const content = { type: "doc", content: [{ type: "paragraph" }] };

      setCachedContent("ch-2", content);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "smudge:draft:ch-2",
        JSON.stringify(content),
      );
      expect(store.get("smudge:draft:ch-2")).toBe(JSON.stringify(content));
    });

    it("silently handles localStorage.setItem throwing", () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      expect(() => {
        setCachedContent("ch-2", { type: "doc" });
      }).not.toThrow();
    });
  });

  describe("clearCachedContent", () => {
    it("removes the key", () => {
      store.set("smudge:draft:ch-3", '{"type":"doc"}');

      clearCachedContent("ch-3");

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith("smudge:draft:ch-3");
      expect(store.has("smudge:draft:ch-3")).toBe(false);
    });

    it("silently handles localStorage.removeItem throwing", () => {
      mockLocalStorage.removeItem.mockImplementation(() => {
        throw new Error("unavailable");
      });

      expect(() => {
        clearCachedContent("ch-3");
      }).not.toThrow();
    });
  });
});
