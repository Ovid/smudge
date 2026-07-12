import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { numberInRange, flag, text, usePersistedState } from "./persistedSetting";

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

describe("numberInRange", () => {
  const codec = numberInRange(180, 480, 260);

  it("parses an in-range number", () => {
    expect(codec.parse("300")).toBe(300);
  });

  it("clamps a value below the minimum", () => {
    expect(codec.parse("50")).toBe(180);
  });

  it("clamps a value above the maximum", () => {
    expect(codec.parse("999")).toBe(480);
  });

  it("rejects a non-numeric value", () => {
    expect(codec.parse("not-a-number")).toBeUndefined();
  });

  // Number("") === 0, which is finite — without an explicit guard this would
  // clamp to the minimum (180) and silently turn garbage into a plausible width.
  it("rejects an empty string rather than clamping it to the minimum", () => {
    expect(codec.parse("")).toBeUndefined();
  });

  it("rejects a whitespace-only string", () => {
    expect(codec.parse("   ")).toBeUndefined();
  });

  it("rejects Infinity", () => {
    expect(codec.parse("Infinity")).toBeUndefined();
  });

  it("serializes to a plain string", () => {
    expect(codec.serialize(300)).toBe("300");
  });

  it("carries its fallback", () => {
    expect(codec.fallback).toBe(260);
  });
});

describe("flag", () => {
  const codec = flag(false);

  it('parses "true"', () => {
    expect(codec.parse("true")).toBe(true);
  });

  it('parses "false"', () => {
    expect(codec.parse("false")).toBe(false);
  });

  it("rejects anything else", () => {
    expect(codec.parse("garbage")).toBeUndefined();
  });

  it("round-trips", () => {
    expect(codec.serialize(true)).toBe("true");
    expect(codec.parse(codec.serialize(true))).toBe(true);
  });
});

describe("text", () => {
  const codec = text("images");

  it("passes any string through untouched", () => {
    // Domain validity (is this a real tab id?) is NOT this codec's job — the
    // hook does not know the tab set. ReferencePanel owns that and degrades an
    // unknown id to tabs[0]. See 4c.0 review item [I1].
    expect(codec.parse("notes")).toBe("notes");
    expect(codec.parse("a-tab-that-no-longer-exists")).toBe("a-tab-that-no-longer-exists");
    // Unlike numberInRange, an empty string is a legitimate value here, not garbage.
    expect(codec.parse("")).toBe("");
  });

  it("serializes a string unchanged", () => {
    expect(codec.serialize("notes")).toBe("notes");
  });

  it("carries its fallback", () => {
    expect(codec.fallback).toBe("images");
  });
});

describe("usePersistedState — read", () => {
  const WIDTH = numberInRange(180, 480, 260);
  const KEY = "smudge:test-width";

  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockLocalStorage.getItem.mockImplementation((key: string) => store.get(key) ?? null);
    mockLocalStorage.setItem.mockImplementation((key: string, value: string) =>
      store.set(key, value),
    );
  });

  it("returns the fallback when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    expect(result.current[0]).toBe(260);
  });

  it("returns a valid stored value", () => {
    store.set(KEY, "300");
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    expect(result.current[0]).toBe(300);
  });

  it("clamps an out-of-range stored value", () => {
    store.set(KEY, "999");
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    expect(result.current[0]).toBe(480);
  });

  it("falls back when the stored value is not a number", () => {
    store.set(KEY, "not-a-number");
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    expect(result.current[0]).toBe(260);
  });

  it("falls back when the stored value is empty (not clamped to min)", () => {
    store.set(KEY, "");
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    expect(result.current[0]).toBe(260);
  });

  it("falls back when getItem throws", () => {
    mockLocalStorage.getItem.mockImplementation(() => {
      throw new Error("unavailable");
    });
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    expect(result.current[0]).toBe(260);
  });
});
