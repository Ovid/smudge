# Persisted-Setting Storage Helper — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## ⚠️ EXECUTED AND SUPERSEDED IN PART — do not re-derive the hook from this

This plan has been executed. It is preserved as written so the decision log's
"the plan said X, we shipped Y" entries stay verifiable — which means **its code
blocks are not a template**. Four decisions changed during implementation and
review; the **code and CLAUDE.md are authoritative**.

| Below, the plan says…                                                        | What actually shipped                                                                                                                             | Recorded as    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Files live at `packages/client/src/utils/persistedSetting.{ts,test.ts}`      | `packages/client/src/hooks/usePersistedState.{ts,test.ts}` — a `utils/` home made the `git grep localStorage .../hooks/` audit structurally blind | `[I3]`         |
| Task 3's setter: `codec.parse(codec.serialize(requested)) ?? codec.fallback` | A rejected write is **dropped entirely** (early return) — it touches neither state nor storage, so both keep the last known-good value            | `[I1]`, `[I6]` |
| Task 1's `numberInRange` returns a plain `fallback,`                         | It **clamps its own fallback**, so `fallback` is a fixed point of `parse ∘ serialize`                                                             | `[I4]`         |
| Codecs **must** be constructed at module scope (an unenforced rule)          | The codec is **pinned at mount** in a ref; the contract is deleted, not policed                                                                   | `[I5]`         |

Copying Task 3's `?? codec.fallback` is the one that bites: it wipes the user's
real 400px width back to the default on one bad mousemove. Full reasoning:
`docs/roadmap-decisions/2026-07-12-phase-4b18-persisted-setting-storage-helper.md`.

---

**Goal:** Replace four hand-rolled `getSaved* + try/catch` localStorage readers and five matching `try { setItem } catch {}` writers with one `usePersistedState(key, codec)` hook whose `parse` is the single validator for both the read and the write path.

**Architecture:** A new `packages/client/src/utils/persistedSetting.ts` exports `usePersistedState<T>(key, codec)` plus three codec factories (`numberInRange`, `flag`, `text`). The setter normalizes every write through `parse(serialize(next))`, so React state is always a fixed point of the storage round-trip — the read and write paths cannot drift apart. `useReferencePanelState` and `useSidebarState` become thin consumers; their public APIs (returned members **and** exported `*_MIN_WIDTH` / `*_MAX_WIDTH` constants) are unchanged, so no component is touched.

**Tech Stack:** TypeScript, React 18 (`<StrictMode>` is enabled), Vitest + `@testing-library/react` (`renderHook`, `act`), jsdom.

**Design:** `docs/plans/2026-07-12-persisted-setting-storage-helper-design.md`
**Roadmap phase:** 4b.18 (single PR, one refactor — CLAUDE.md §Pull Request Scope)

---

## Already Done (do not redo)

The design names two deliverables beyond code. **The first is already complete** —
it landed while the design was being written, so there is no task for it:

- **`docs/roadmap.md` §Phase 4b.18 body section** — written and committed in
  `f23574d`. The phase previously existed only as a row in the Phase Structure
  table. That row's status is already flipped to **In Progress**, and the
  `<!-- plan: … -->` comment already points at the design. **Do not add a second
  section.**

The second deliverable (the CLAUDE.md entry) **is** outstanding and is Task 6.

## Ground Rules

- **RED-GREEN-REFACTOR is mandatory** (CLAUDE.md §Testing Philosophy). Every task writes the failing test first and runs it to watch it fail.
- **Zero warnings in test output.** This phase deliberately produces **no** console output on any path, so **no `expectConsole()` call should appear anywhere in it.** If you find yourself needing one, the silent-failure decision has been broken — stop and re-read the design's §"Failure handling: deliberately silent".
- Raw `vi.spyOn(console, …)` is **banned by ESLint**. Do not add one.
- Coverage floors: 95% statements / 85% branches / 90% functions / 95% lines.
- Run client tests with: `npm test -w packages/client`
- Single test file: `npm test -w packages/client -- persistedSetting`

**Where the REFACTOR step lives.** Tasks 1–3 write new code and each carries an
explicit REFACTOR step naming what to look for. Tasks 4–5 have none because they
**are** the refactor — the whole phase is one, and bolting "now refactor" onto a
refactor is ceremony. Tasks 6–7 are documentation and verification: no code, so
nothing to refactor. This omission is a decision, not an oversight.

---

## Task 1: Codec factories

Pure functions, no React. The `numberInRange` empty-string guard is the load-bearing bit — `Number("")` is `0`, not `NaN`.

**Files:**

- Create: `packages/client/src/utils/persistedSetting.ts`
- Create: `packages/client/src/utils/persistedSetting.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { numberInRange, flag, text } from "./persistedSetting";

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
  });

  it("carries its fallback", () => {
    expect(codec.fallback).toBe("images");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- persistedSetting`
Expected: FAIL — `Failed to resolve import "./persistedSetting"`.

**Step 3: Write the minimal implementation**

```ts
export interface SettingCodec<T> {
  /** Parse a raw storage string. Return undefined to reject it → fallback. */
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
  fallback: T;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * A number constrained to [min, max]. Out-of-range values CLAMP (rather than
 * reject) so that this same `parse` can normalize writes as well as reads —
 * see usePersistedState. Non-numbers reject and fall back.
 */
export function numberInRange(min: number, max: number, fallback: number): SettingCodec<number> {
  return {
    // Number("") === 0 and Number("   ") === 0 — both finite. Without this
    // guard an empty stored value would clamp to `min`, silently turning
    // garbage into a legitimate-looking width instead of falling back to the
    // default. Keep "is it a number at all?" separate from "is it in range?".
    parse: (raw) => {
      if (raw.trim() === "") return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? clamp(n, min, max) : undefined;
    },
    serialize: String,
    fallback,
  };
}

/** A strict boolean: only "true" and "false" parse; everything else falls back. */
export function flag(fallback: boolean): SettingCodec<boolean> {
  return {
    parse: (raw) => (raw === "true" ? true : raw === "false" ? false : undefined),
    serialize: String,
    fallback,
  };
}

/**
 * An opaque string. Deliberately does NOT validate domain membership — the
 * helper cannot know the caller's value set (e.g. which tab ids exist). The
 * component that owns the domain validates it (ReferencePanel degrades an
 * unknown activeTabId to tabs[0]). See 4c.0 review item [I1].
 */
export function text(fallback: string): SettingCodec<string> {
  return { parse: (raw) => raw, serialize: (value) => value, fallback };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- persistedSetting`
Expected: PASS (16 tests).

**Step 5: REFACTOR**

Look for, specifically:

- **The shared codec shape.** All three factories build the same
  `{ parse, serialize, fallback }` literal. Is that duplication worth extracting,
  or is three object literals the honest floor? (Likely the latter — do not
  invent a `makeCodec` factory-factory to save two lines.)
- **`serialize: String`** appears in both `numberInRange` and `flag`. Fine as-is;
  note it and move on.
- **Naming.** Does `flag` read better than `bool`? Is `text` clearly "opaque
  string, no domain validation"?

"Looked, found nothing worth changing" is a legitimate outcome — record it and
proceed. The point is the look, not a mandatory edit.

**Step 6: Commit**

```bash
git add packages/client/src/utils/persistedSetting.ts packages/client/src/utils/persistedSetting.test.ts
git commit -m "feat(4b.18): setting codecs — numberInRange, flag, text"
```

---

## Task 2: `usePersistedState` — the read path

**Files:**

- Modify: `packages/client/src/utils/persistedSetting.ts`
- Modify: `packages/client/src/utils/persistedSetting.test.ts`

**Step 1: Write the failing tests**

Append to the test file. Note the localStorage mock pattern — it matches the one already used in `packages/client/src/__tests__/useSidebarState.test.ts:4-15`.

```ts
import { renderHook, act } from "@testing-library/react";
import { StrictMode } from "react";
import { vi, beforeEach, afterEach } from "vitest";
import { usePersistedState } from "./persistedSetting";

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

const WIDTH = numberInRange(180, 480, 260);
const KEY = "smudge:test-width";

describe("usePersistedState — read", () => {
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- persistedSetting`
Expected: FAIL — `usePersistedState is not a function`.

**Step 3: Write the minimal implementation**

Add to `persistedSetting.ts`:

```ts
import { useState, useRef, useCallback } from "react";

function read<T>(key: string, codec: SettingCodec<T>): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = codec.parse(raw);
      if (parsed !== undefined) return parsed;
    }
  } catch {
    // Storage unavailable (blocked by policy, private mode). Deliberately
    // silent: the data-loss path (useContentCache, sharing this origin's
    // quota) already warns loudly. See the design's failure-handling section.
  }
  return codec.fallback;
}

export function usePersistedState<T>(key: string, codec: SettingCodec<T>) {
  const [value, setValue] = useState<T>(() => read(key, codec));
  return [value, setValue] as const; // write path lands in Task 3
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- persistedSetting`
Expected: PASS.

**Step 5: REFACTOR**

Look for, specifically:

- **Is `read()` a free function or should it be inline?** It is called from
  exactly one place (the `useState` initializer). Keeping it separate is
  justified only if Task 3's setter also needs it — check whether it does once
  you get there, and collapse it if not.
- **The empty `catch` block.** Confirm the comment explains _why_ it is empty
  (the deliberate-silence decision), not merely _that_ it is. A future reader
  must not "fix" it by adding a `clientWarn`.

**Step 6: Commit**

```bash
git add packages/client/src/utils/persistedSetting.ts packages/client/src/utils/persistedSetting.test.ts
git commit -m "feat(4b.18): usePersistedState read path — validate via codec, silent fallback"
```

---

## Task 3: `usePersistedState` — the write path

The heart of the design: the setter normalizes through `parse(serialize(next))`, making state a **fixed point of the storage round-trip**.

**Files:**

- Modify: `packages/client/src/utils/persistedSetting.ts`
- Modify: `packages/client/src/utils/persistedSetting.test.ts`

**Step 1: Write the failing tests**

```ts
describe("usePersistedState — write", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockLocalStorage.setItem.mockImplementation((key: string, value: string) =>
      store.set(key, value),
    );
  });

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

  it("keeps state updated when setItem throws", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH));
    mockLocalStorage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => result.current[1](350));
    expect(result.current[0]).toBe(350);
  });

  it("supports the functional updater form across two rapid calls", () => {
    const OPEN = flag(false);
    const { result } = renderHook(() => usePersistedState("smudge:test-open", OPEN));
    act(() => {
      result.current[1]((prev) => !prev);
      result.current[1]((prev) => !prev);
    });
    // Both calls happen before a re-render — the second must see the first's
    // value. A stale closure over `value` would leave this at `true`.
    expect(result.current[0]).toBe(false);
  });

  // Guards the trap the design calls out: a setItem side effect INSIDE a
  // setState updater fires twice under StrictMode's double-invoke. <StrictMode>
  // is enabled in main.tsx:14, so this is a live dev concern.
  it("persists exactly once per set under StrictMode", () => {
    const { result } = renderHook(() => usePersistedState(KEY, WIDTH), { wrapper: StrictMode });
    mockLocalStorage.setItem.mockClear();
    act(() => result.current[1](300));
    expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("keeps a stable setter identity across re-renders", () => {
    const { result, rerender } = renderHook(() => usePersistedState(KEY, WIDTH));
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- persistedSetting`
Expected: FAIL — the normalize test gets `999` (raw `setValue` from Task 2 does not normalize), and the StrictMode test may pass vacuously. Both go green in Step 3.

**Step 3: Write the implementation**

Replace the Task 2 stub:

```ts
/**
 * React state backed by a localStorage key, validated by a single codec.
 *
 * `codec.parse` is the ONLY validator, and it governs BOTH directions: the
 * setter normalizes via `parse(serialize(next))`, so state is always a fixed
 * point of the storage round-trip — what you see is exactly what a reload
 * gives back. This is what stops the read and write paths from drifting apart
 * (the asymmetry this helper was written to close: handlePanelResize clamped
 * before persisting, handleSidebarResize did not).
 *
 * Storage failures are deliberately SILENT (no clientWarn). The data-loss path
 * — useContentCache, which shares this origin's quota — already warns loudly,
 * and the resize path would otherwise warn at mousemove frequency.
 *
 * CONTRACT: `key` must be constant for the component's lifetime. The stored
 * value is read exactly once, at mount. A changing key would split-brain —
 * state holding the OLD key's value while writes land on the NEW key, with no
 * re-read. Derive per-entity settings by remounting (a `key` prop on the
 * component), not by varying this argument.
 */
export function usePersistedState<T>(
  key: string,
  codec: SettingCodec<T>,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, codec));

  // Mirrors `value` so the functional-updater form can resolve `prev` WITHOUT
  // running the setItem side effect inside a setState updater — React
  // StrictMode double-invokes updaters, which would persist twice.
  const valueRef = useRef(value);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const requested =
        typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next;

      // One validator, both directions.
      const normalized = codec.parse(codec.serialize(requested)) ?? codec.fallback;

      valueRef.current = normalized;
      try {
        localStorage.setItem(key, codec.serialize(normalized));
      } catch {
        // Silent — see the doc comment above. State still updates below, so the
        // setting works for this session even when it cannot be persisted.
      }
      setValue(normalized);
    },
    [key, codec],
  );

  return [value, set] as const;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- persistedSetting`
Expected: PASS (all read + write tests).

**Step 5: REFACTOR**

Look for, specifically:

- **The double `serialize` call.** The setter calls
  `codec.parse(codec.serialize(requested))` and then `codec.serialize(normalized)`
  — two serializations per write. Hoisting the second is possible only when
  `normalized === requested`, which is not the common case, so the "optimization"
  would add a branch to save a `String()` call on a mousemove. **Leave it.** Note
  the decision so the next reader doesn't re-derive it.
- **`read()` reuse.** Does the setter share anything with the read path now? If
  the only shared thing is `codec.parse`, `read()` stays where it is.
- **The doc comment.** It now carries three load-bearing facts (the fixed-point
  invariant, the deliberate silence, the constant-key contract). Confirm each is
  stated as a _reason_, not a restatement of the code.

**Step 6: Commit**

```bash
git add packages/client/src/utils/persistedSetting.ts packages/client/src/utils/persistedSetting.test.ts
git commit -m "feat(4b.18): usePersistedState write path — codec normalizes state and storage alike"
```

---

## Task 4: Migrate `useSidebarState`

**Files:**

- Modify: `packages/client/src/hooks/useSidebarState.ts` (whole file, 41 → ~17 lines)
- Modify: `packages/client/src/__tests__/useSidebarState.test.ts:157-171` (two cases)

**Step 1: Update the two tests that encode the old reject-on-read semantics (RED)**

These two currently assert that an out-of-range stored width **resets to the default**. Under the shared validator it **clamps** — behavior delta 1 in the design. Rewrite them:

```ts
// WAS: "falls back to default width for value below minimum" → expected 260
it("clamps a stored width below the minimum", async () => {
  store.set("smudge:sidebar-width", "50");
  const { useSidebarState } = await loadHook();
  const { result } = renderHook(() => useSidebarState());

  expect(result.current.sidebarWidth).toBe(180);
});

// WAS: "falls back to default width for value above maximum" → expected 260
it("clamps a stored width above the maximum", async () => {
  store.set("smudge:sidebar-width", "999");
  const { useSidebarState } = await loadHook();
  const { result } = renderHook(() => useSidebarState());

  expect(result.current.sidebarWidth).toBe(480);
});
```

Add one case pinning the empty-string guard at the hook level:

```ts
it("falls back to the default width for an empty stored value", async () => {
  store.set("smudge:sidebar-width", "");
  const { useSidebarState } = await loadHook();
  const { result } = renderHook(() => useSidebarState());

  expect(result.current.sidebarWidth).toBe(260);
});
```

**Leave every other test in this file untouched** — they are the regression net proving the public API is unchanged. In particular the "exported constants" block (`:45-55`) and the "return value shape" block (`:200-215`) must keep passing verbatim.

**Step 2: Run to verify the two rewritten tests fail**

Run: `npm test -w packages/client -- useSidebarState`
Expected: FAIL — the two clamp tests get `260` (old reject-on-read), the empty-string test passes already.

**Step 3: Rewrite the hook**

```ts
import { useState, useCallback } from "react";
import { numberInRange, usePersistedState } from "../utils/persistedSetting";

const SIDEBAR_DEFAULT_WIDTH = 260;
// Exported: Sidebar.tsx imports these for its drag clamp (:481-482), its
// keyboard clamps (:501,505), AND its aria-valuemin/aria-valuemax on the
// resize separator (:471-472). Do not inline them into the codec call.
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
  // Deliberately NOT persisted — same as before. Persisting it would be a
  // feature, not this refactor.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  return { sidebarWidth, sidebarOpen, setSidebarOpen, handleSidebarResize, toggleSidebar };
}
```

`handleSidebarResize` _is_ the setter now — the clamp lives in the codec, so the write path can no longer disagree with the read path.

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- useSidebarState`
Expected: PASS (all cases, including the untouched exported-constants and return-shape blocks).

**Step 5: Commit**

```bash
git add packages/client/src/hooks/useSidebarState.ts packages/client/src/__tests__/useSidebarState.test.ts
git commit -m "refactor(4b.18): useSidebarState reads and writes through usePersistedState"
```

---

## Task 5: Migrate `useReferencePanelState`

**Files:**

- Modify: `packages/client/src/hooks/useReferencePanelState.ts` (whole file, 100 → ~32 lines)
- Modify: `packages/client/src/__tests__/useReferencePanelState.test.ts:165-171` (one case)

**Step 1: Update the one test encoding the old reject-on-read semantics (RED)**

```ts
// WAS: "falls back to default width for out-of-range value" → expected 320
it("clamps a stored width below the minimum", async () => {
  store.set("smudge:ref-panel-width", "50");
  const { useReferencePanelState } = await loadHook();
  const { result } = renderHook(() => useReferencePanelState());

  expect(result.current.panelWidth).toBe(240);
});
```

Add one empty-string case, mirroring Task 4:

```ts
it("falls back to the default width for an empty stored value", async () => {
  store.set("smudge:ref-panel-width", "");
  const { useReferencePanelState } = await loadHook();
  const { result } = renderHook(() => useReferencePanelState());

  expect(result.current.panelWidth).toBe(320);
});
```

Everything else stays. Note especially that the existing write-clamp tests (`:113-134`, "clamps width below minimum to 240" / "above maximum to 480") already assert the clamping-on-write behavior and **must keep passing unchanged** — they now pass because of the codec rather than a hand-written `Math.min`, which is the whole point. The `"garbage"` → `open: false` case (`:173-178`) must also keep passing verbatim: `flag()` rejects it and falls back to `false`, exactly as the old `stored === "true"` did.

**Step 2: Run to verify the rewritten test fails**

Run: `npm test -w packages/client -- useReferencePanelState`
Expected: FAIL — the clamp test gets `320` (old reject-on-read).

**Step 3: Rewrite the hook**

```ts
import { useCallback } from "react";
import { flag, numberInRange, text, usePersistedState } from "../utils/persistedSetting";

const PANEL_DEFAULT_WIDTH = 320;
// Exported: ReferencePanel.tsx imports these for its drag clamp (:62-64), its
// keyboard clamps (:83,87), AND its aria-valuemin/aria-valuemax. Do not inline
// them into the codec call.
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
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- useReferencePanelState`
Expected: PASS.

**Step 5: Verify no consumer broke**

Run: `npm test -w packages/client`
Expected: PASS — `ReferencePanel.test.tsx`, `EditorPageFeatures.test.tsx`, and `Editor.test.tsx` must all be green **without edits**. If any of them needed changing, the public API was not actually preserved — stop and fix the hook, not the test.

**Step 6: Commit**

```bash
git add packages/client/src/hooks/useReferencePanelState.ts packages/client/src/__tests__/useReferencePanelState.test.ts
git commit -m "refactor(4b.18): useReferencePanelState reads and writes through usePersistedState"
```

---

## Task 6: Document the invariant in CLAUDE.md

Not an afterthought — without this the next setting gets hand-rolled and the phase was theatre.

**Files:**

- Modify: `CLAUDE.md` (§Key Architecture Decisions)

**Step 1: Add the entry**

Insert immediately **after** the "**Dialog lifecycle lives in one hook.**" entry (the entry it parallels) and before "## Accepted Architectural Trade-offs". Use the text approved during the design review — it is reproduced verbatim in the design doc's §"Deliverables Beyond Code", item 2. Copy it from there.

**Step 2: Verify the audit surface still holds**

Run: `git grep -n "usePersistedState" CLAUDE.md packages/client/src | head`
Expected: the CLAUDE.md entry, the helper, and the two consuming hooks.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(4b.18): CLAUDE.md — persisted UI settings live in one hook"
```

---

## Task 7: Full verification

**Step 1: Confirm no hand-rolled storage access survives in the two hooks**

Run: `git grep -n "localStorage" packages/client/src/hooks/`
Expected: `usePersistedState.ts` (the sanctioned owner — it now lives here, per `[I3]`) and `useContentCache.ts` (deliberately out of scope — a draft cache with JSON payloads and its own `clientWarn` logging). **Nothing else.** If `useSidebarState.ts` or `useReferencePanelState.ts` appear, the migration is incomplete.

**Step 2: Confirm the phase added no console noise**

Run: `git grep -n "expectConsole" packages/client/src/utils/ packages/client/src/__tests__/useSidebarState.test.ts packages/client/src/__tests__/useReferencePanelState.test.ts`
Expected: **no matches.** This phase is silent by design; an `expectConsole()` here means the silent-failure decision was broken.

**Step 3: Full local CI pass**

Run: `make all`
Expected: lint + format + typecheck + coverage + e2e all green. Coverage must stay above 95/85/90/95 — the new helper is small and fully covered by Tasks 1–3, so coverage should rise, not fall.

**Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "style(4b.18): prettier formatting"   # only if `make all` changed files
```

---

## Definition of Done (from the design)

- [x] `docs/roadmap.md` §Phase 4b.18 body section written — **done in `f23574d`**, see §Already Done.
- [ ] One helper owns every settings read and write; no `try/catch` around `localStorage` survives in the two hooks.
- [ ] `parse` is provably the validator for both directions — the fixed-point test (Task 3) shows an out-of-range write landing normalized in state **and** storage.
- [ ] The empty-string guard is pinned by test (`Number("") === 0` cannot silently become `min`).
- [ ] Both hooks' public APIs unchanged — returned members **and** the exported `*_MIN_WIDTH` / `*_MAX_WIDTH` constants that feed the components' clamps and ARIA bounds. No consumer component touched.
- [ ] Existing hook test suites still pass, edited only at the three cases carrying behavior delta 1.
- [ ] No console output on any failure path; no `expectConsole()` added.
- [ ] CLAUDE.md §Key Architecture Decisions updated.
- [ ] `make all` green.
