import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { StrictMode } from "react";
import { numberInRange, flag, text, usePersistedState } from "./usePersistedState";

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

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

// Individual tests swap in throwing implementations to simulate an unavailable
// or full localStorage. `vi.clearAllMocks()` clears call history but NOT
// implementations, so each one has to be put back or it leaks into the next test.
afterEach(() => {
  mockLocalStorage.getItem.mockImplementation((key: string) => store.get(key) ?? null);
  mockLocalStorage.setItem.mockImplementation((key: string, value: string) =>
    store.set(key, value),
  );
  mockLocalStorage.removeItem.mockImplementation((key: string) => store.delete(key));
});

const WIDTH = numberInRange(180, 480, 260);
const KEY = "smudge:test-width";
const OPEN = flag(false);
const OPEN_KEY = "smudge:test-open";

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

  // The hook requires `fallback` to be a fixed point of parse∘serialize. An
  // out-of-range fallback would otherwise make read() return 900 while any
  // write normalized to 480 — state and reload silently disagreeing.
  it("clamps an out-of-range fallback so it is a fixed point of its own parse", () => {
    const bad = numberInRange(180, 480, 900);
    expect(bad.fallback).toBe(480);
    expect(bad.parse(bad.serialize(bad.fallback))).toBe(bad.fallback);
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

  it("persists nothing on mount", () => {
    renderHook(() => usePersistedState(KEY, WIDTH));
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
  });
});

describe("usePersistedState — write", () => {
  it("updates state and persists the serialized value", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    act(() => result.current[1](300));
    expect(result.current[0]).toBe(300);
    expect(store.get(KEY)).toBe("300");
  });

  // THE fixed-point invariant: one validator governs both directions, so what
  // is in state is exactly what a reload would give back. This is the test that
  // proves the read and write paths cannot drift apart.
  it("normalizes an out-of-range write in BOTH state and storage", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    act(() => result.current[1](999));
    expect(result.current[0]).toBe(480);
    expect(store.get(KEY)).toBe("480");
  });

  // A fallback is a floor for absent/corrupt STORAGE, not a reset button for a
  // bad live write. A NaN from, say, a resize handler reading a torn-down rect
  // must be ignored — resetting to 260 here would silently wipe the user's real
  // 400px width, in state AND on disk.
  it("ignores an unrepresentable write, keeping the last known-good value", () => {
    store.set(KEY, "400");
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    act(() => result.current[1](NaN));
    expect(result.current[0]).toBe(400);
    expect(store.get(KEY)).toBe("400");
  });

  // "Ignored" has to mean ignored in STORAGE too. With nothing stored, the
  // last known-good value is the in-memory fallback — which the user never
  // chose. Persisting it would materialize today's default as if they had,
  // pinning it against a future change to SIDEBAR_DEFAULT_WIDTH. The test above
  // pre-seeds "400" and so cannot see this.
  it("persists nothing when an unrepresentable write hits empty storage", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    act(() => result.current[1](NaN));
    expect(result.current[0]).toBe(260);
    expect(store.has(KEY)).toBe(false);
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
  });

  it("keeps state updated when setItem throws", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    mockLocalStorage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => result.current[1](350));
    expect(result.current[0]).toBe(350);
  });

  it("supports the functional updater form across two rapid calls", () => {
    const { result } = renderHook(() => usePersistedState(OPEN_KEY, OPEN));
    act(() => {
      result.current[1]((prev) => !prev);
      result.current[1]((prev) => !prev);
    });
    // Both calls happen before a re-render — the second must see the first's
    // value. A stale closure over `value` would leave this at `true`.
    expect(result.current[0]).toBe(false);
    // `false` is also the initial value, so the state assertion alone would pass
    // against a no-op setter. Storage is the proof the writes actually happened.
    expect(store.get(OPEN_KEY)).toBe("false");
  });

  // Guards the trap the design calls out: a setItem side effect INSIDE a
  // setState updater fires twice under StrictMode's double-invoke. <StrictMode>
  // is enabled in main.tsx, so this is a live dev concern.
  it("persists exactly once per set under StrictMode", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH), { wrapper: StrictMode });
    mockLocalStorage.setItem.mockClear();
    act(() => result.current[1](300));
    expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
  });

  // Across a STATE CHANGE, not just a no-op rerender: a `value` in the dep list
  // — the exact regression the valueRef mirror exists to prevent — passes a bare
  // rerender() and only fails here.
  it("keeps a stable setter identity across a state change", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    const first = result.current[1];
    act(() => result.current[1](300));
    expect(result.current[0]).toBe(300);
    expect(result.current[1]).toBe(first);
  });

  // A codec built inline during render is a fresh object every render. With
  // `codec` in the setter's deps that churned the setter identity, and the churn
  // cascaded: togglePanel → EditorPage's useCallbacks → re-created props into
  // memoized editor children. The hook pins the mount-time codec instead, which
  // also matches the read path (the lazy initializer already parses with it and
  // never re-reads). Callers cannot destabilize the setter, so there is no
  // module-scope contract left to police.
  it("keeps a stable setter identity even when the codec is re-created each render", () => {
    const { result, rerender } = renderHook(() =>
      usePersistedState(KEY, numberInRange(180, 480, 260)),
    );
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
    // Still functional, not just stable: the pinned codec is a real codec.
    act(() => result.current[1](999));
    expect(result.current[0]).toBe(480);
    expect(store.get(KEY)).toBe("480");
  });
});
