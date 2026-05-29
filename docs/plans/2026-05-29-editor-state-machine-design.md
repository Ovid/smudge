# Phase 4b.5: Editor State Machine — Design

**Date:** 2026-05-29
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.5 (`docs/roadmap.md`)
**Status:** Design — pending implementation plan

---

## Goal

Replace the scattered editor-state refs that are kept in sync by discipline with
a single state machine that owns the editor's operational state
`{ editable, locked, busy }`, driven by explicit events rather than independent
`setState`/`setEditable` calls. Add a `committed_but_unreloaded` mutation stage
for the cases where the server succeeded but the client cannot confirm what is on
screen.

This is a **refactor**. There is no new user-facing behavior on the happy path.
The one deliberate behavioral sharpening — modeling the genuine
supersession-with-raced-content case as an explicit stage — is described in
"Decided questions" below and preserves today's net outcome.

## Why now

Pattern analysis across the six `ovid/architecture` reviews (2026-04-19 to
2026-04-20) found three recurring Critical findings that all trace to one shape:
editor state lives in N separate refs/state kept in sync by hand. When any one
diverges — a stale `expectedChapterId` skip, a 2xx `BAD_JSON` on a replace/restore
response, a caller that forgets to clear the lock — the editor becomes editable
while the banner still says "read-only," and the next keystroke's auto-save
silently overwrites the committed server change. Phase 4b.1 centralized the
*flow* but not the *state*. Without this phase, Phases 4c / 5b / 7e will
rediscover the same data-loss race.

## Current state (what we are replacing)

The state that needs unifying spans three locations:

- **`EditorPage.tsx`**
  - `editorLockedMessage` (`useState`) + `editorLockedMessageRef` (mirrored in
    render at `editorLockedMessageRef.current = editorLockedMessage`).
  - The banner-clear `useEffect` keyed on `[activeChapter?.id, chapterReloadKey]`
    (~line 448) that clears the banner and re-asserts `editable` on remount.
  - TipTap's `editable`, toggled imperatively through `editorRef.setEditable`.
  - `actionBusyRef` (a *separate* busy source for non-mutating actions) and
    `isActionBusy = mutation.isBusy() || actionBusyRef.current`.
- **`useEditorMutation.ts`**
  - `inFlightRef` (mutation busy).
  - Run-local flags `reloadFailed` / `reloadSucceeded` / `reloadSuperseded` that
    decide the `finally`'s unlock behavior, plus the scattered
    `editor.setEditable(...)` calls at entry, finally, both re-lock blocks, and
    the S5 late-mount block.
- **Consumers** (`useSnapshotController.ts`, `useFindReplaceController.ts`)
  - Receive `editorLockedMessageRef` and compute their own `reloadFailed` to call
    `applyReloadFailedLock` (banner + `setEditable(false)` as a pair).

## Decided questions

These were settled during brainstorming and are load-bearing.

### 1. `committed_but_unreloaded` and supersession — **Hybrid (race-only)**

Today the hook treats supersession (an `expectedChapterId` skip) as benign
success: it sets `reloadSuperseded`, re-enables the editor, and returns `ok:true`,
*because* a lock banner would otherwise pin to an unrelated chapter the mutation
never touched (findings I1/I3/I5, 2026-04-20/21 reviews).

The new stage covers:

- 2xx `BAD_JSON` on replace/restore response bodies (the write may have landed).
- A genuine reload-GET failure (was `stage:"reload"`).
- Supersession **only when** the now-active chapter is in the mutation's
  `clearCacheFor` set **and** the follow-up second-reload fails — i.e. the
  genuine stale-content race that today's I3 second-reload already handles.

Plain supersession (now-active chapter *not* in `clearCacheFor`, or the
second-reload succeeds) stays benign success. Net user-visible outcome is
unchanged; the difference is that the race case is now a named, testable stage
instead of an implicit branch.

### 2. Scope of `busy` — **mutation-busy only**

The machine's `busy` replaces `inFlightRef` only. `actionBusyRef` (snapshot
view/create, find-replace search — non-content-mutating actions) **stays** as a
separate ref, and `isActionBusy` keeps composing `machine.busy ||
actionBusyRef.current`. This matches the roadmap DoD's explicit "no free-standing"
list (which names `inFlightRef` but omits `actionBusyRef`) and keeps the
machine's meaning crisp: it is the *mutation* state, and snapshot view is
deliberately outside `useEditorMutation`'s scope.

### 3. Architecture — **`useReducer` machine + render-mirrored ref + hybrid `editable` sync (synchronous lock-down, effect-driven re-enable)**

A pure reducer (idiomatic, unit-testable), state mirrored to a ref *in render*
(the existing house style, so synchronous gates survive), and a single effect
reconciling `editable` intent into TipTap **for the re-enable direction**.

The lock-DOWN transition stays synchronous and imperative, because it is the only
transition with a hard timing requirement. Two of today's guarantees execute
synchronously *before the first `await`* (`useEditorMutation.ts` lines 132/159)
and must not become effect-driven:

- **Input-blocking.** `editor.setEditable(false)` at `run()` entry blocks TipTap
  input before any `await` yields, so no keystroke is processed during
  flush/mutate/reload. If this moved to an effect, a keystroke landing between the
  `MUTATION_STARTED` dispatch and the effect's commit could dirty the editor
  *after* the run's `markClean()`, re-arming auto-save and PATCHing stale content
  over the server-committed change — the exact data-loss race this phase exists to
  close.
- **Re-entrancy latch.** `inFlightRef.current = true` at entry latches out a
  re-entrant `run()` synchronously. A render-mirrored `busy` would read stale
  `false` until the next commit, letting two mutations run concurrently.

Therefore the lock-down path (mutation entry, the post-mutate re-lock, the S5
late-mount re-lock) keeps a **synchronous `setEditable(false)` (via
`safeSetEditable`) and a synchronous re-entrancy latch** (`inFlightRef`). The
machine + sync-effect own only the `editable:true` reconciliation and the remount
re-assert, which have no timing-safety requirement (being one tick late merely
leaves the editor briefly read-only — harmless). This preserves today's guarantees
byte-for-byte while still unifying lock/unlock intent, the banner lifecycle, and
the re-enable path through the machine. The regression test (see Testing) verifies
this mechanism; it does not substitute for it.

## Design

### Component 1 — `useEditorMutationMachine`

New hook: `packages/client/src/hooks/useEditorMutationMachine.ts`.

State (flat record):

```ts
type EditorMutationState = {
  editable: boolean; // intent; the sync-effect pushes this into TipTap (re-enable)
  busy: boolean; // mutation-busy, drives UI gates; synchronous re-entrancy is
                 // guarded by a retained inFlightRef latch (Decided Q3)
  lock: { message: string } | null; // replaces editorLockedMessage; null = unlocked
};
```

Events (the reducer is a pure, exported function so it can be unit-tested in
isolation):

| Event                          | Transition                                              | Origin                                                              |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `MUTATION_STARTED`             | `busy:true, editable:false` (lock unchanged)            | `useEditorMutation.run()` entry                                     |
| `MUTATION_SETTLED_OK`          | `busy:false, editable:(lock === null)` (lock unchanged) | happy path — re-enables only when not locked                        |
| `MUTATION_SETTLED_SUPERSEDED`  | `busy:false, editable:true, lock:null`                  | benign supersession — clears a stale (prior-chapter) lock, mirroring today's `reloadSuperseded` bypass |
| `COMMITTED_UNRELOADED {msg}`   | `busy:false, editable:false, lock:{message}`            | the new stage (BAD_JSON, reload-GET failure, race-only supersession)|
| `RELOADED`                     | `busy:false, editable:true, lock:null`                  | successful `reloadActiveChapter` — fresh server content on screen   |
| `EDITOR_REMOUNTED`             | `editable:true, lock:null` (busy untouched)             | chapter switch or post-reload remount                               |
| `UNLOCK`                       | `lock:null`                                             | existing external dismiss paths                                     |

The hook mirrors state to a ref in render (`stateRef.current = state`) and
exposes `{ state, dispatch, isLocked(), isBusy(), getState() }`. The 10
synchronous `editorLockedMessageRef.current !== null` gates become
`isLocked()` (backed by `stateRef`), and external `mutation.isBusy()` reads
become the machine's `isBusy()` — no behavior change. The re-entrancy guard at
`run()` entry is the deliberate exception: it reads a synchronous latch (the
retained `inFlightRef`), not the render-mirrored `busy`, so a same-tick
re-entrant call is still latched out (Decided Q3).

**Key property — the lock lifecycle is derived from one event, not a
side-effect.** A remount (chapter switch *or* successful reload) dispatches
`EDITOR_REMOUNTED`, which clears the lock — mirroring today's
`[activeChapter?.id, chapterReloadKey]` clear-effect. `committed_but_unreloaded`
persists precisely *because no remount happens* (reload failed / BAD_JSON /
failed second-reload), so the lock survives until the user refreshes the page —
identical to today's outcome.

### Component 2 — the `editable` sync-effect (re-enable / reconcile direction)

A single effect in `EditorPage` reconciles `editable` intent → TipTap, reusing
the existing `safeSetEditable` helper (one wrapper, not a parallel `try/catch`):

```ts
useEffect(() => {
  safeSetEditable(editorRef, state.editable);
}, [state.editable, activeChapter?.id, chapterReloadKey]);
```

`safeSetEditable` already swallows the mid-remount synchronous throw and emits a
`clientWarn` (it backs today's `applyReloadFailedLock`); the effect reuses it so
both the imperative lock-down path and this reconcile path share one wrapper.

This **replaces**:

- the `editor.setEditable(true)` re-enable call inside `useEditorMutation` (the
  `finally` unlock); and
- the line-448 re-assert effect in `EditorPage`.

It does **not** replace the lock-DOWN `setEditable(false)` calls (entry,
post-mutate re-lock, S5 late-mount re-lock) — those stay synchronous and
imperative per Decided Q3, also via `safeSetEditable`. The effect is the
reconciler/re-assert; the synchronous calls guarantee input is blocked before any
`await` yields.

`activeChapter?.id` / `chapterReloadKey` remain in the dependency array so a
remounted TipTap instance (which defaults to `editable=true`) is re-asserted to
match intent.

### Component 3 — `committed_but_unreloaded` stage and `useEditorMutation`

`MutationResult`, in its **end state** (after the consumer migration lands — see
PR scope for the additive-then-subtractive sequencing):

```ts
export type MutationResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; stage: "flush" | "mutate"; error: unknown }
  | { ok: false; stage: "committed_but_unreloaded"; data: T }
  | { ok: false; stage: "busy" };
```

The previous `{ ok:false; stage:"reload"; data }` is **subsumed** by
`committed_but_unreloaded` (same semantic family: server committed, display
unconfirmed). To keep each PR independently compilable, `committed_but_unreloaded`
is added *alongside* a retained `stage:"reload"` in PR (A), and `stage:"reload"` is
removed only in PR (B) once consumers no longer reference it (see PR scope).
`useEditorMutation`:

- keeps `reloadFailed` / `reloadSucceeded` / `reloadSuperseded` as *internal
  computation* — transient `run()`-local `let`s, not the persistent hand-synced
  state this phase eliminates (see DoD) — but its outcomes now `dispatch` machine
  events instead of poking `editorRef` or returning bare flags;
- reclassifies the 2xx `BAD_JSON` thrown inside `mutate()` from `stage:"mutate"`
  to `stage:"committed_but_unreloaded"` (the write may have landed);
- maps the race-only supersession branch (now-active chapter ∈ `clearCacheFor`
  and second-reload fails) to `committed_but_unreloaded`, and plain (benign)
  supersession to `MUTATION_SETTLED_SUPERSEDED`;
- replaces the *external/UI* reads of `inFlightRef` with the machine's `busy`
  (driven by `MUTATION_STARTED` and the terminal dispatches `MUTATION_SETTLED_OK`
  / `MUTATION_SETTLED_SUPERSEDED` / `RELOADED` / `COMMITTED_UNRELOADED`), but
  **retains `inFlightRef` as the synchronous re-entrancy latch** read at `run()`
  entry (Decided Q3) — a render-mirrored `busy` cannot latch out a same-tick
  re-entrant call. The busy-latch ordering concern (clear busy before unlocking)
  is preserved by the reducer applying both fields in one transition, and the
  happy-path `MUTATION_SETTLED_OK` re-enables `editable` **only when `lock ===
  null`**, preserving today's `!reloadFailed && !lockedByCaller` guard so a
  successful run cannot re-enable typing under a persistent banner.

### Component 4 — consumer migration

`useSnapshotController` and `useFindReplaceController`:

- stop receiving `editorLockedMessageRef`;
- handle the `MutationResult` union exhaustively with a compile-time `: never`
  default;
- on `committed_but_unreloaded`, dispatch `COMMITTED_UNRELOADED { message }`
  carrying their own `strings.ts` copy. The existing `lockMessage` override and
  the stale-chapter-drift branch in `finalizeReplaceSuccess` are preserved as the
  *message they pass*; the banner+`setEditable` pairing of `applyReloadFailedLock`
  is now owned by the machine + sync-effect.

### Component 5 — `useProjectEditor`

`chapterReloadKey` stays (it is still the remount trigger emitted by
`reloadActiveChapter`). Only its banner-clear *consumer* (the line-448 effect)
moves into the machine's `EDITOR_REMOUNTED` event.

## Refactor surface (file-by-file)

- **New:** `packages/client/src/hooks/useEditorMutationMachine.ts` + unit test.
- **`EditorPage.tsx`:** delete `editorLockedMessage` `useState`, the
  `editorLockedMessageRef` mirror, and the line-448 clear-effect; wire the
  machine + the `editable` reconcile sync-effect (re-enable direction, via
  `safeSetEditable`); `isEditorLocked` / `isActionBusy` read the machine.
  `actionBusyRef` stays.
- **`useEditorMutation.ts`:** keep `inFlightRef` **only** as the synchronous
  re-entrancy latch (Decided Q3); keep the synchronous lock-down
  `setEditable(false)` calls (entry, post-mutate re-lock, S5 late-mount) via
  `safeSetEditable`; run-local flags become local computation that drives
  `dispatch`; the `finally`'s re-enable becomes a dispatch (the effect reconciles).
  `MutationResult`: add `committed_but_unreloaded` in PR (A) alongside the retained
  `stage:"reload"`; remove `stage:"reload"` in PR (B).
- **`useSnapshotController.ts` / `useFindReplaceController.ts`:** drop
  `editorLockedMessageRef` param; exhaustive stage handling; dispatch instead of
  ref-poke.
- **`useProjectEditor.ts`:** `chapterReloadKey` unchanged; banner-clear consumer
  moves.

## PR scope

This is a single refactor and may ship as one PR (CLAUDE.md §Pull Request Scope
permits a single refactor as one PR). It is large and sits on the most-reviewed
code in the repo (the snapshots/find-and-replace area took 16 review rounds).
The implementation plan **may** split it along the phase boundary, provided each
PR compiles and tests green on its own. Because the consumers reference
`MutationResult.stage`, the split must be **additive-then-subtractive** rather than
a clean cut:

- **(A)** machine hook + `useEditorMutation` migration + the `editable` reconcile
  sync-effect. `committed_but_unreloaded` is **added alongside** a retained
  `stage:"reload"`, and `useEditorMutation` begins emitting the new stage.
  Consumers still compile because `stage:"reload"` is unchanged.
- **(B)** consumer migration (`useSnapshotController`, `useFindReplaceController`)
  onto `committed_but_unreloaded` with the exhaustive `: never` default; **then**
  `stage:"reload"` is removed from the union.

A naive cut — removing `stage:"reload"` in (A) while (B) still references it —
does not typecheck, so it is not a legal split. Splitting a phase into multiple
PRs is explicitly allowed; the choice (and, if split, this ordering) is made at
plan time.

## Error handling

- The sync-effect wraps `setEditable` in `try/catch` (mid-remount throws) and
  emits a `clientWarn`; this single point replaces the multiple inline
  `try/catch` blocks in `useEditorMutation`.
- `flush` / `mutate` failures keep their existing `error`-carrying shape.
- `committed_but_unreloaded` carries `data` (no `error` field) and always routes
  to the persistent lock banner via `COMMITTED_UNRELOADED`.
- The conservative "treat unknown predicate state as locked" defaults that exist
  today become unnecessary: lock state is read from a single mirrored ref, not a
  caller-supplied throwing predicate.
- HTTP status codes are unchanged; no new server codes (CLAUDE.md §API Design,
  save-pipeline invariant 5).

## Testing

Per CLAUDE.md §Testing Philosophy (RED-GREEN-REFACTOR; 95/85/90/95 coverage
floors; zero warnings in test output).

1. **Three mandated regression tests** (2026-04-20 Criticals), each asserting the
   editor stays read-only *and* the lock banner stays visible:
   - stale-`expectedChapterId` skip (race-only branch),
   - 2xx `BAD_JSON` on a project-wide replace response,
   - 2xx `BAD_JSON` on a snapshot restore response.
2. **Pure reducer unit tests** — every event and transition (cheap, exhaustive).
3. **One-commit-tick window test** (guards the Decided-Q3 hybrid): simulate a
   keystroke arriving during a mutation and assert no stale PATCH escapes — the
   synchronous lock-down `setEditable(false)` blocked input before any `await`
   yielded (TipTap rejects the keystroke). Separately, assert a synchronous
   re-entrant `run()` returns `stage:"busy"` via the retained `inFlightRef` latch.
   The test verifies the mechanism; it does not substitute for it.
4. **Hybrid supersession tests:**
   - now-active chapter ∈ `clearCacheFor` + failed second-reload →
     `committed_but_unreloaded` (lock raised on the *current*, affected chapter);
   - plain supersession (chapter not affected, or second-reload succeeds) →
     benign `ok:true`, editor editable, no banner.
5. **Existing `useEditorMutation.test.tsx`** cases re-pointed to assert via
   machine state (and the resulting TipTap `editable`) rather than direct
   `editorRef.setEditable` spy counts.
6. **New `clientWarn` paths** are spied and asserted, then restored, so the
   zero-warning rule holds.

## Out of scope

- New user-facing behavior.
- Changes to the server-side save path or response envelope.
- Folding `actionBusyRef` / snapshot-action busy into the machine (decided:
  mutation-busy only).
- Folding `saveStatus` / `error` / panel-exclusivity into the machine.
- Codifying CLAUDE.md §Save-Pipeline Invariants as type constraints beyond the
  editor-mutation state itself.
- Migration of hand-composed flush sequences in external callers (covered by
  Phase 4b.1's DoD).

## Definition of Done

- A single source of truth for the editor's `{ editable, locked, busy }` state.
  No free-standing **persistent refs or React state** for `editorLockedMessage` /
  `editorLockedMessageRef` / `reloadFailed` / `reloadSucceeded` kept in sync by
  hand, and no separate banner-clear effect. Transient `run()`-local `let`
  variables that compute which machine event to dispatch are explicitly permitted
  — the elimination target is hand-synced persistent state, not local control
  flow. `inFlightRef` is retained for one purpose only: the synchronous
  re-entrancy latch at `run()` entry (Decided Q3); it no longer drives any UI read.
- `MutationResult` includes `committed_but_unreloaded`; every consumer handles it
  exhaustively (`: never` default); `stage:"reload"` is removed (after the consumer
  migration — see PR scope).
- The three Critical regression tests pass and assert read-only + banner-visible.
- No happy-path behavior change visible to the user. The lock-down
  `setEditable(false)` and the re-entrancy latch stay synchronous (Decided Q3), so
  this claim holds on the timing axis, not only the functional axis.
- `actionBusyRef` remains a separate busy source (mutation-busy-only decision).

## CLAUDE.md impact

To be confirmed during the `/roadmap` CLAUDE.md-review step. Candidate updates:

- **§Key Architecture Decisions / Save-Pipeline Invariants:** reference
  `useEditorMutationMachine` as the owner of `{ editable, locked, busy }`, so
  future content-mutating flows route through it rather than re-deriving lock
  bookkeeping; note the `committed_but_unreloaded` stage as the canonical
  "server committed, display unconfirmed" outcome.
- Note that `editorLockedMessage` / `inFlightRef` references in the existing
  invariant text are superseded by the machine.

## Dependencies

- Phase 4b.1 (Editor Orchestration Helper) — landed; this phase tightens the
  state surface that helper operates on.
- Should land before Phase 4c (Notes, Tags & Outtakes), which introduces a new
  class of content-mutating flow.
