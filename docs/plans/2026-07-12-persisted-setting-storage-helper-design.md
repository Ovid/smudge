# Phase 4b.18: Persisted-Setting Storage Helper — Design

**Date:** 2026-07-12
**Phase:** 4b.18 (roadmap `docs/roadmap.md`)
**Status:** Designed
**Origin:** Suggestion raised in the Phase 4c.0 code review
(`paad/code-reviews/ovid-4c0-reference-panel-tabs-2026-07-12-14-55-59-3f7822c.md`),
split out per CLAUDE.md §Pull Request Scope (one-feature rule).

---

## Goal

Four hooks read a UI setting out of `localStorage`, and each hand-rolls the same
`try { getItem } catch {}` skeleton with a different validator bolted on. Five
more blocks hand-roll the matching `try { setItem } catch {}` write. Replace all
nine with a single `usePersistedState` hook whose codec is the one validator for
both directions.

## Current State

| Setting          | File                              | Validation on read                       |
| ---------------- | --------------------------------- | ---------------------------------------- |
| ref-panel width  | `useReferencePanelState.ts:11-24` | clamp to `[240, 480]`, else default 320  |
| ref-panel open   | `useReferencePanelState.ts:26-34` | strict `stored === "true"`, else `false`  |
| ref-panel tab    | `useReferencePanelState.ts:36-44` | **none** — raw string returned verbatim   |
| sidebar width    | `useSidebarState.ts:8-21`         | clamp to `[180, 480]`, else default 260  |

Write sites: `handlePanelResize`, `setPanelOpen`, `togglePanel`, `setActiveTab`
(all `useReferencePanelState.ts`), and `handleSidebarResize`
(`useSidebarState.ts`). All five are an identical
`try { localStorage.setItem(…) } catch { /* localStorage unavailable */ }`.

### The latent asymmetry

`handlePanelResize` clamps to `[MIN, MAX]` **before** persisting.
`handleSidebarResize` does **not**. Nothing forces the two to agree.

This is **not** a live defect. Every caller of `onResize` already clamps at the
call site — `Sidebar.tsx:481-484` (drag), `Sidebar.tsx:501,505` (keyboard),
`ReferencePanel.tsx:62-66` (drag), `ReferencePanel.tsx:83,87` (keyboard) — so an
out-of-range width never reaches either hook through the UI. The hook-level clamp
in `useReferencePanelState` is defense-in-depth; its absence in `useSidebarState`
is an unforced gap, reachable only via hand-edited storage.

It is nonetheless the same *character* of gap as the finding that spawned this
phase: 4c.0 review item **[I1]** (unvalidated `activeTabId`) was also explicitly
"not reachable by a normal user today", reachable only via corrupted storage or a
future tab rename. Closing latent-but-unforced validation gaps is what this phase
is for. A shared validator makes the gap unrepresentable rather than merely
absent.

## Design

### The helper

New file: `packages/client/src/utils/persistedSetting.ts`, joining `abortable.ts`
and `editorSafeOps.ts` in the established `utils/` home for cross-cutting
helpers.

```ts
export interface SettingCodec<T> {
  /** Parse a raw storage string. Return undefined to reject it → fallback. */
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
  fallback: T;
}

export function usePersistedState<T>(
  key: string,
  codec: SettingCodec<T>,
): readonly [T, (next: T | ((prev: T) => T)) => void];
```

**Read** (once, at mount, via a lazy `useState` initializer): `getItem(key)`; if
non-null, run `parse`; if `parse` yields a value, use it; otherwise use
`fallback`. Any throw yields `fallback`.

**Write:** the setter normalizes through the codec before touching either state
or storage:

```ts
const normalized = codec.parse(codec.serialize(next)) ?? codec.fallback;
```

This round-trip is the load-bearing decision. **`parse` is the single validator,
and it governs both directions by construction** — the write path cannot drift
from the read path, because the write path *is* the read path. Whatever lands in
React state is guaranteed to be a fixed point of the storage round-trip: what the
user sees is exactly what a reload would give back. This is what makes the
asymmetry above unrepresentable, and it is the reason the hook shape was chosen
over free `readSetting`/`writeSetting` functions (see Alternatives).

The setter accepts the functional `(prev) => next` form, which `togglePanel`
needs. It resolves `prev` from an internal ref rather than from inside a
`setState` updater: a `setItem` side effect inside an updater fires twice under
React StrictMode's double-invoke. Setter identity is stable — `useCallback` on
`[key, codec]`, both module-level constants at every call site.

### Failure handling: deliberately silent

Storage failures are swallowed and the fallback is used. No `clientWarn`, no
console output. This preserves today's behavior exactly.

Rationale — and it is not "storage never fails":

- `localStorage` is *present* in every target runtime. Under Phase 7g the
  Electron renderer loads Smudge over `http://127.0.0.1:<port>`, an ordinary HTTP
  origin in Chromium. (The dicey Electron case is a `file://` opaque origin; that
  is not the architecture on the roadmap.)
- But `setItem` can still *fail*, on two reachable paths: **quota exhaustion**
  (localStorage is ~5–10MB per origin, and Smudge shares that origin between
  these setting keys and `useContentCache`, which stringifies whole chapter
  drafts into `smudge:draft:<id>`), and **storage blocked by policy** (Chrome
  "block all cookies", enterprise profiles, privacy extensions).
- On the quota path, **the failure that matters is already logged**:
  `useContentCache` fires `clientWarn` when a *draft* fails to cache. That is the
  data-loss signal. A settings write failing is the same root cause reported a
  second time in a lower-stakes voice — and, because `handlePanelResize` fires on
  every mousemove during a resize drag, it would be reported at *mousemove
  frequency*. That is precisely the "30 expected warnings so nobody reads the
  31st" failure CLAUDE.md §Testing Philosophy warns against.
- A failed panel-width persist is cosmetic and self-healing. No data loss — the
  only place CLAUDE.md instructs us not to be lazy about error handling.

The residual cost, stated honestly: a blocked-storage profile produces no signal
at mount, and this formalizes a second `localStorage` convention alongside
`useContentCache`'s logging one. Accepted.

### Codecs

Three factories ship alongside the hook:

```ts
numberInRange(min, max, fallback)  // Number(raw); finite → clamp to [min,max]; NaN → reject
flag(fallback)                     // "true" → true; "false" → false; else reject
text(fallback)                     // identity
```

`text()` is deliberately dumb — it does **not** validate the tab id. This is the
direct instruction from 4c.0 [I1]'s resolution: *"Validating in the hook is
worse: the hook does not know the tab set; the component does."* `ReferencePanel`
already degrades an unknown `activeTabId` to `tabs[0]`. The codec's job is
storage hygiene; domain validity stays with the component that owns the domain.

### Call sites

`useSidebarState.ts` (41 → ~15 lines):

```ts
const SIDEBAR_WIDTH_CODEC = numberInRange(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, 260);

export function useSidebarState() {
  const [sidebarWidth, handleSidebarResize] =
    usePersistedState("smudge:sidebar-width", SIDEBAR_WIDTH_CODEC);
  const [sidebarOpen, setSidebarOpen] = useState(true); // not persisted, unchanged
  const toggleSidebar = useCallback(() => setSidebarOpen((p) => !p), []);
  return { sidebarWidth, sidebarOpen, setSidebarOpen, handleSidebarResize, toggleSidebar };
}
```

`handleSidebarResize` *is* the setter; the clamp lives in the codec, so the
asymmetry is closed by construction rather than by a remembered `Math.min`.

`useReferencePanelState.ts` (100 → ~30 lines): three `usePersistedState` calls
plus `togglePanel = () => setPanelOpen((p) => !p)`.

Both hooks keep their **exact public API** — same returned member names, same
signatures. `EditorPage.tsx`, `Sidebar.tsx`, `ReferencePanel.tsx`, and
`EditorMainContent.tsx` are **not touched**.

## Behavior Deltas

Only two, both on the read path:

1. **Stale out-of-range stored width now clamps instead of resetting.** A stored
   `"600"` yields `480` (the max) rather than falling back to `260`/`320`.
   Today's readers *reject* out-of-range; the codec *clamps*, because clamping is
   what makes `parse` usable as the write-side normalizer. Reachable via
   hand-edited storage — or, realistically, the day someone narrows a `MAX_WIDTH`
   constant, where existing users get a graceful clamp instead of a surprise
   reset. Strictly better, but it is a change.
2. **Writes now normalize.** No user-visible effect today, since both resize
   components already clamp at the call site. Defense-in-depth, applied
   uniformly.

Everything else is identical: `"garbage"` still reads as `open: false`; the tab
id still passes through untouched; failures stay silent; all four defaults
unchanged.

## Testing

Red-green-refactor throughout, per CLAUDE.md §Testing Philosophy. Coverage floors
(95% statements / 85% branches / 90% functions / 95% lines) apply.

New `packages/client/src/utils/persistedSetting.test.ts` (colocated, following
the `utils/abortable.test.ts` precedent):

- **Read:** valid → parsed; absent → fallback; malformed → fallback;
  out-of-range → **clamped**; `getItem` throws → fallback.
- **Write:** persists the serialized value; out-of-range input → the same
  normalized value lands in state **and** storage (the fixed-point invariant);
  `setItem` throws → state still updates and no throw escapes.
- **Contract:** the functional updater sees the latest value across two rapid
  toggles; a StrictMode double-invoke produces exactly **one** `setItem` (pins
  the updater-side-effect trap); setter identity is stable across re-renders.
- **Silence:** no console output on any failure path. No `expectConsole()` is
  needed anywhere in this phase — that absence is itself the assertion that the
  silent-failure decision held.

The existing `useSidebarState.test.ts` (216 lines) and
`useReferencePanelState.test.ts` (291 lines) remain the regression net proving
the public APIs are unchanged. They are edited **only** where behavior delta 1
surfaces.

No e2e changes — nothing user-visible.

## Deliverables Beyond Code

1. **`docs/roadmap.md` gains a `## Phase 4b.18` body section.** The phase
   currently exists only as a row in the Phase Structure table; every other phase
   has a Goal / Scope / Out of Scope / Definition of Done / Dependencies section.
2. **CLAUDE.md §Key Architecture Decisions gains an entry** — "Persisted UI
   settings live in one hook" — recording that new persisted settings route
   through `usePersistedState` with a codec, that `parse` is the single validator
   for both directions, and that storage failures are deliberately silent (with
   the `useContentCache`-already-warns reasoning). Without this, the next setting
   gets hand-rolled and the phase was theatre.

## Non-Goals

- **`useContentCache` is not migrated.** JSON payloads, `clientWarn` logging, a
  `remove` operation, and it is a draft cache rather than a setting — a different
  shape with a different failure contract.
- **`sidebarOpen` is not persisted.** That would be a new feature.
- **The hook does not validate tab ids.** Owned by `ReferencePanel` per 4c.0
  [I1].
- **No ESLint rule banning raw `localStorage`.** A plausible future phase (the
  codebase has precedent in 4b.2, 4b.4, 4b.17), but adding it here breaks the
  one-feature rule.

## Alternatives Considered

**Free functions (`readSetting` / `writeSetting`).** Two plain functions in
`utils/`; each hook keeps its own `useState`/`useCallback`, and setters become
`setX(v); writeSetting(KEY, String(v))`. This is the smaller diff — the two hooks
keep their structure, so their ~500 lines of existing tests survive nearly
untouched — and it is callable outside a component.

Rejected because it dedups the `try/catch` boilerplate but **not** the read-vs-write
validation split. The author must still remember to clamp before calling
`writeSetting` — which is exactly the step `handleSidebarResize` omits today. It
removes the boilerplate and leaves the gap that produced the boilerplate's one
known defect class. It also leaves the `useState`-plus-persist pairing repeated
four times.

The decision was taken with the correctness argument explicitly retracted: an
early survey mistakenly reported the sidebar clamp gap as a *live* bug, and the
caller-side clamps (`Sidebar.tsx:481-484` et al.) disprove that. The hook was
chosen anyway, on dedup value plus the codebase's established "one hook owns the
pattern" convention (`useDialogLifecycle`, `useAbortableSequence`,
`useEditorMutation`, `useEditorMutationMachine`).

## Risks

- **Codec identity.** An inline codec literal at a call site would churn the
  setter's identity every render. Mitigated by convention (module-level `const`
  at all four sites) and by the `useCallback` deps being honest about it. Low
  risk: nothing outside these two hooks calls the helper.
- **Test churn.** Two working hooks' test files (~500 lines) get reworked. This
  is the acknowledged cost of the hook shape over free functions.

## PR Scope

One refactor, no feature. The two read-path behavior improvements ride along as
consequences of the shared validator and are documented above. Satisfies CLAUDE.md
§Pull Request Scope.

## Dependencies

- Phase 4c.0 (Reference Panel Multi-Tab Refactor) — introduced the third reader
  (`getSavedActiveTab`) and the review finding that spawned this phase.
