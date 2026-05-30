---
date: 2026-05-29
phase: "Phase 4b.5: Editor State Machine"
model: claude-opus-4-8
design_file: docs/plans/2026-05-29-editor-state-machine-design.md
plan_file: docs/plans/2026-05-29-editor-state-machine-plan.md
pushback:
  total: 4
  critical: 0
  important: 2
  minor: 2
alignment:
  total: 5
  critical: 0
  important: 2
  minor: 3
---

# Phase 4b.5: Editor State Machine — Decision Log

## Pushback Findings

### [1] Decided Q3's pure-effect approach trades away two synchronous guarantees
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The design moved both the lock-down `setEditable(false)` and the `inFlightRef` busy latch from synchronous-before-the-first-`await` into reducer state mirrored only in render. That opens a one-commit-tick window where (a) a keystroke can dirty the editor after the run's `markClean()` and re-arm auto-save — the exact data-loss race the phase exists to close — and (b) a re-entrant `run()` reads stale `busy:false` and runs concurrently. The design dismissed the window as "addressed by a regression test," but a test documents a window rather than closing it, and the design missed the busy-latch axis entirely.
- **Resolution:** fixed-in-design — adopted the Hybrid: lock-down `setEditable(false)` and the `inFlightRef` re-entrancy latch stay synchronous-imperative (the only timing-critical transitions); the machine + a single effect own only the `editable=true` reconcile/re-assert. Decided Q3 rewritten; preserves today's guarantees byte-for-byte.

### [2] The proposed A/B PR split is not independently shippable
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** Split (A) (machine + `useEditorMutation`) included removing `stage:"reload"` from `MutationResult`, but split (B)'s consumers still reference `stage:"reload"` — so (A) alone fails to typecheck. The split was presented as a free choice "made at plan time" but as drawn was illegal.
- **Resolution:** fixed-in-design — made the split additive-then-subtractive: (A) adds `committed_but_unreloaded` alongside a retained `stage:"reload"`; (B) migrates consumers then removes `stage:"reload"`. Each PR compiles and tests green on its own.

### [3] "No free-standing tracking" in the DoD is ambiguous
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The roadmap and design DoD said "no free-standing `reloadFailed`/`reloadSucceeded` tracking," yet the design deliberately keeps them as `run()`-local `let`s. A reviewer reading the DoD literally could block the PR — the exact ambiguity that fed this codebase's 16-round history.
- **Resolution:** fixed-in-design — tightened both the design DoD and the roadmap DoD to ban only persistent refs/React state kept in sync by hand, explicitly permitting transient `run()`-local control-flow variables.

### [4] Two accuracy/reuse nits
- **Severity:** Minor
- **Category:** Other
- **Summary:** The design claimed "~12" synchronous lock gates (actual count is 10), and Component 2's new effect re-inlined a `try/catch` that duplicates the existing `safeSetEditable` helper.
- **Resolution:** fixed-in-design — corrected "~12" to "10" and changed the sync-effect to reuse `safeSetEditable` (consistent with the Hybrid using it on both the lock-down and re-enable paths).

## Alignment Findings

### [1] Design says the hook reclassifies 2xx `BAD_JSON`; mapApiError owns it in the consumer
- **Severity:** Important
- **Category:** design-gap
- **Summary:** Design Component 3 stated the hook reclassifies a 2xx-`BAD_JSON` throw to `stage:"committed_but_unreloaded"`, but 2xx-`BAD_JSON` detection is owned by `mapApiError(...).possiblyCommitted` (a CLAUDE.md §Unified API error mapping invariant) and runs in the consumer. Implementing the design literally would duplicate that classification inside the scope-agnostic hook.
- **Resolution:** fixed-in-design — corrected Component 3, the Component 1 event table, and Decided Q1 to state the hook emits `committed_but_unreloaded` only for reload-GET failure + race-only supersession; 2xx `BAD_JSON` stays `stage:"mutate"` and the consumer routes its `possiblyCommitted` branch to the same `COMMITTED_UNRELOADED` machine event.

### [2] Event-table "origin" column implies the hook dispatches `COMMITTED_UNRELOADED`
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** Same root as [1]. The Component 1 event table listed `COMMITTED_UNRELOADED`'s origin as the hook's new stage, but the plan has the consumer dispatch it (via `applyReloadFailedLock`), since the hook cannot supply the scope-specific banner copy.
- **Resolution:** fixed-in-design — corrected the origin column to "consumer, via `applyReloadFailedLock`," with a note that the hook dispatches no terminal event on the committed path so `editable` stays `false` until the banner lands. Folded into the [1] edit.

### [3] Plan Task A5 deletes `editorLockedMessageRef` but re-points only 2 of ~10 gates
- **Severity:** Important
- **Category:** missing-coverage
- **Summary:** A5 deleted the `editorLockedMessageRef` mirror but only re-pointed `handleSaveLockGated` and `isEditorLocked`; the other ~8 synchronous lock gates (status change, rename, reorder, switch-to-view, create, delete, open-trash, flushSave shortcut) would reference a deleted symbol.
- **Resolution:** fixed-in-plan — added an explicit A5 step to re-point *every* `editorLockedMessageRef.current !== null` reader to `editorMachine.isLocked()`, with a `git grep editorLockedMessageRef` returning no matches as the completion gate.

### [4] The `UNLOCK` machine event has no production dispatcher
- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** Both docs include an `UNLOCK` event whose stated origin is "external dismiss paths," but the lock banner is deliberately non-dismissible — only `EDITOR_REMOUNTED` clears it in production. `UNLOCK` has no caller.
- **Resolution:** accepted-as-is — kept the event (unit-tested, no coverage gap) and documented it in both design and plan as reserved for a future dismissible-lock path with no current dispatcher.

### [5] Tasks are test-first but lack explicit REFACTOR steps
- **Severity:** Minor
- **Category:** tdd-format
- **Summary:** The plan follows the bite-sized write-failing-test → implement → commit cycle but omits the explicit REFACTOR beat the alignment skill calls out, on the three tasks (A4, B1, B2) that have genuine cleanup opportunities.
- **Resolution:** fixed-in-plan — added targeted REFACTOR steps to A4 (consolidate terminal returns; grep for dead `isLocked`/bare `setEditable`) and B1/B2 (confirm `: never` is the only new flow; grep for surviving `"reload"` literal).

## Summary

- Pushback raised 4 issues; all 4 resulted in design changes (`fixed-in-design`): the Decided-Q3 hybrid, the additive-then-subtractive split, the DoD wording, and the two nits. The most consequential — a reintroduced data-loss race hidden behind a "pure refactor" framing — was caught before any code was written.
- Alignment raised 5 issues; 2 resulted in design changes, 2 in plan changes, 1 accepted-as-is. The standout was a design↔plan contradiction over who classifies 2xx `BAD_JSON` (resolved in favor of the mapApiError single-owner invariant) and a plan task that deleted a ref while migrating only 2 of its 10 readers.
