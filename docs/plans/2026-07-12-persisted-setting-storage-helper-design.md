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
React StrictMode's double-invoke, and `<StrictMode>` **is** enabled
(`packages/client/src/main.tsx:14`), so this is a live concern in dev, not a
hypothetical. Setter identity is stable — `useCallback` on `[key, codec]`, both
module-level constants at every call site.

**Contract: `key` must be constant for the component's lifetime.** The stored
value is read exactly once, in the lazy `useState` initializer, but the setter's
deps include `key`. A `key` that changed between renders would split-brain —
state still holding the value read from the *old* key while writes land on the
*new* one — with no re-read and no reset, which would present as "the setting
didn't load" while quietly persisting correctly. Unreachable today (all four keys
are module-level string literals), but the hook is advertised as the way to add
future settings, and a per-project key (`smudge:panel-width:${projectId}`, a
plausible Phase 8a want) is the obvious trap. **Derive per-entity settings by
remounting** — put a `key` prop on the component — **not by varying this
argument.** This constraint goes in the hook's doc comment and in the CLAUDE.md
entry. Supporting a changing `key` (re-read on change) is deliberately not built:
it is speculative machinery for a caller that does not exist, and it raises
questions with no obviously right answer (does the old key get cleaned up? if the
new key is absent, fall back or keep the current value?).

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
numberInRange(min, max, fallback)
// parse: (raw) => {
//   if (raw.trim() === "") return undefined;   // "" and "   " are NOT numbers
//   const n = Number(raw);
//   return Number.isFinite(n) ? clamp(n, min, max) : undefined;
// }

flag(fallback)   // "true" → true; "false" → false; anything else → reject
text(fallback)   // identity
```

**The empty-string guard is load-bearing, not defensive noise.** `Number("")` is
`0`, not `NaN` — and `0` is finite, so without the `trim()` check an empty or
whitespace-only stored value would take the *clamp* branch and silently become
`min` (180px / 240px) instead of falling back to the sensible default. An empty
string is exactly what a partially-failed write or a storage-clearing extension
leaves behind, so it is not an exotic input. Turning garbage into a
plausible-looking legitimate value is precisely the bug class of 4c.0 [I1], which
this phase exists to generalize; shipping it inside the fix would be an unhappy
irony. The guard keeps "is this a number at all?" and "is this number in range?"
as two distinct questions.

(`Number` has other coercion quirks the guard does not address — `"0x10"` → 16,
`"1e3"` → 1000 — but those produce *honest* numbers that then clamp safely, so
they degrade correctly. `""` is the only one that degrades to a wrong-but-valid
value.)

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

**The frozen surface includes the module-level constants, not just the returned
members.** Both hooks export their bounds, and components import them directly:
`Sidebar.tsx:2` takes `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` for its drag
clamp (`:481-482`), its keyboard clamps (`:501,505`), and — importantly — the
`aria-valuemin` / `aria-valuemax` it announces on the resize separator
(`:471-472`); `ReferencePanel.tsx` does the same with `PANEL_MIN_WIDTH` /
`PANEL_MAX_WIDTH`. Under this refactor those bounds also become arguments to a
codec factory, and the tempting tidy-up is to inline them there and drop the
exports. **Do not.** That silently breaks the components' clamps and their ARIA
bounds. (TypeScript catches the deletion, which is why this is a footnote and not
a risk — but the a11y coupling deserves to be named rather than rediscovered by
`tsc`.)

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
unchanged. In particular an **empty stored width still falls back to the default**
(260/320) rather than clamping to `min` — see the `Number("") === 0` guard in
§Codecs. That the delta list stays at two, and does not quietly grow a third, is
the point of that guard.

## Testing

Red-green-refactor throughout, per CLAUDE.md §Testing Philosophy. Coverage floors
(95% statements / 85% branches / 90% functions / 95% lines) apply.

New `packages/client/src/utils/persistedSetting.test.ts` (colocated, following
the `utils/abortable.test.ts` precedent):

- **Read:** valid → parsed; absent → fallback; malformed (`"abc"`) → fallback;
  **empty / whitespace-only (`""`, `"   "`) → fallback, NOT clamped to `min`**
  (pins the `Number("") === 0` guard); out-of-range → **clamped**; `getItem`
  throws → fallback.
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
2. **CLAUDE.md §Key Architecture Decisions gains an entry**, placed immediately
   after the "Dialog lifecycle lives in one hook" entry it parallels. Without it,
   the next setting gets hand-rolled and the phase was theatre. Approved text:

   > **Persisted UI settings live in one hook.** Every `localStorage`-backed UI
   > setting (panel width, panel open, active tab, sidebar width) routes through
   > `usePersistedState(key, codec)`
   > (`packages/client/src/utils/persistedSetting.ts`) rather than a hand-rolled
   > `getSaved* + try/catch` reader. The codec's `parse` is the **single
   > validator for both directions** — the setter normalizes via
   > `parse(serialize(next))`, so React state is always a fixed point of the
   > storage round-trip and the read and write paths cannot drift apart. Codec
   > factories: `numberInRange` (note its empty-string guard — `Number("")` is
   > `0`, not `NaN`), `flag`, `text`. Two deliberate constraints: (1) **storage
   > failures are silent** — no `clientWarn` — because the data-loss path
   > (`useContentCache`, sharing the same origin quota) already warns loudly, and
   > the resize path would otherwise warn at mousemove frequency; (2) **`key`
   > must be constant for a component's lifetime** — derive per-entity settings
   > by remounting, not by varying the key. The hook does **not** validate domain
   > values it cannot know (e.g. tab ids); that stays with the component that
   > owns the domain (`ReferencePanel` degrades an unknown tab to `tabs[0]`).
   > `useContentCache` is deliberately *not* a client of this hook — it is a
   > draft cache with JSON payloads, its own logging, and a different failure
   > contract.

### CLAUDE.md review (all other sections)

Checked and **no change needed**: §API Design (no endpoints/codes/envelopes —
`localStorage` is client-only), §Data Model (no tables/columns), §Testing
Philosophy (the phase *conforms* to the zero-warnings rule rather than extending
it — the silent-failure decision means no `expectConsole()` is needed anywhere),
§Target Project Structure (`utils/` already exists and already hosts
`abortable.ts` / `editorSafeOps.ts`), §Accessibility (the `aria-valuemin` /
`aria-valuemax` coupling is a fact about these two hooks, documented at the call
site in §Call Sites, not a project-wide a11y primitive), §Visual Design (n/a), and
§Pull Request Scope (one refactor, no new hazard — this phase is itself an
instance of the existing split rule working).

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
