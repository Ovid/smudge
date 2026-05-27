# Phase 4b.3d — Mapper Internals & CLAUDE.md Updates: Design

**Date:** 2026-05-27
**Phase:** 4b.3d (roadmap.md)
**Branch:** `mapper-internals-claude-md-updates`
**Companion plan:** `docs/plans/2026-05-27-mapper-internals-claude-md-updates-plan.md` (forthcoming)

## Goal

Close the Phase 4b.3 follow-up backlog. Two threads:

1. **Three small code refactors** (Cluster E [S6], [S13], [S14]) that tighten mapper-internal and consumer-side drift surfaced in the 4b.3 review (`paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`).
2. **CLAUDE.md documentation update** so the architecture that Phase 4b.3c established (`applyMappedError`, `ScopeExtras<S>`, `committedCodes`) is canonical for future contributors and `/paad:agentic-architecture` runs.

## Why Now

Without the CLAUDE.md update, the next contributor — or the next `/paad:agentic-architecture` run — rediscovers the consumer-ladder pattern that Phase 4b.3c just removed. The three code refactors are mechanically independent of 4b.3c's behavioural fixes, but they read most cleanly now that `applyMappedError` and `ScopeExtras<S>` are in place — and the [S13] sites diverged further during 4b.3c.3's round-2 review (2026-05-27, this morning), so the right extraction shape is now clearer than it was when the phase was originally scoped on 2026-05-26.

## Scope

### ~~[S6] Try/catch around `safeExtrasFrom` dev log~~ — **dropped 2026-05-27**

Dropped in pushback (Issue 1, 2026-05-27): the original 4b.3 review's hazard claim ("`import.meta.env?.DEV` access can throw in some test environments") was not paired with a reproduction. Verified against this repo's Vitest config (`packages/client/vitest.config.ts`) and setup (`packages/client/src/__tests__/setup.ts`): nothing intercepts `import.meta.env`. Vite provides `import.meta.env` as a plain object; `.DEV` is a plain property read that cannot throw absent an unusual Proxy / throwing-getter setup, neither of which is present.

Resolution: drop [S6] entirely. If a real reproduction surfaces later, file a follow-up. The proposed test ("mock `import.meta.env` to throw on access") was itself dependent on Vitest infrastructure that does not exist; keeping the defensive wrap with no covering test would have produced dead defensive code.

### [S13] Extract `refreshTrashList` from `useTrashManager.ts`

**File:** `packages/client/src/hooks/useTrashManager.ts:105-132` (`openTrash`) and `:357-386` (`confirmDeleteChapter`'s post-delete trash refresh).

**Why now (drift since 2026-05-26):** Both sites gained an `I2` drift-guard during 4b.3c.3's round-2 review (`startedForProjectId` capture + `isStaleProject()`). They now share ~80% of their shape but differ in state writes:

- `openTrash` sets `setTrashOpen(true)` on success; logs `console.error("Failed to load trash:", err)` in catch (only when `mapped.message !== null`).
- `confirmDeleteChapter` refresh sets neither.

A naive extract-everything helper would couple the divergent state writes and force the call sites to grow flag parameters. A discriminated-union return lets callers own their state writes while the helper owns the I2/abort/isStale/mapApiError pipeline once.

**New helper signature** — extracted to its own file `packages/client/src/hooks/useTrashManager.refresh.ts` so it can be imported directly by the unit test (pushback Issue 2, 2026-05-27). Exports `refreshTrashList` and `RefreshTrashResult`. Both `useTrashManager.ts` callers (`openTrash` and `confirmDeleteChapter`'s post-delete refresh) import from this file.

```ts
export type RefreshTrashResult =
  | { kind: "ok"; trashed: Chapter[] }
  | { kind: "aborted" }
  | { kind: "stale" }
  | { kind: "error"; mapped: MappedError<"trash.load"> };

export async function refreshTrashList(
  project: ProjectWithChapters,
  projectRef: React.RefObject<ProjectWithChapters | null>,
  trashOp: AbortableAsyncOperation,
): Promise<RefreshTrashResult> {
  const startedForProjectId = project.id;
  const isStaleProject = () =>
    startedForProjectId !== undefined &&
    projectRef.current?.id !== startedForProjectId;
  const { promise, signal } = trashOp.run((s) => api.projects.trash(project.slug, s));
  try {
    const trashed = await promise;
    if (signal.aborted) return { kind: "aborted" };
    if (isStaleProject()) return { kind: "stale" };
    return { kind: "ok", trashed };
  } catch (err) {
    if (signal.aborted) return { kind: "aborted" };
    if (isStaleProject()) return { kind: "stale" };
    return { kind: "error", mapped: mapApiError(err, "trash.load") };
  }
}
```

**Caller updates:**

```ts
// openTrash
const result = await refreshTrashList(project, projectRef, trashOp);
if (result.kind === "aborted" || result.kind === "stale") return;
if (result.kind === "ok") {
  setTrashedChapters(result.trashed);
  setTrashOpen(true);
  return;
}
// result.kind === "error"
if (result.mapped.message !== null) console.error("Failed to load trash:", /* original err — see note */);
applyMappedError(result.mapped, { onMessage: setActionError });
```

```ts
// confirmDeleteChapter's refresh
const result = await refreshTrashList(project, projectRef, trashOp);
if (result.kind === "aborted" || result.kind === "stale") return;
if (result.kind === "ok") {
  setTrashedChapters(result.trashed);
  return;
}
applyMappedError(result.mapped, { onMessage: setActionError });
```

**Note on the `console.error` original-err binding:** `openTrash`'s current code logs the raw `err`, not `mapped`. The helper does not return the raw `err` to keep its return shape narrow. Two options:

- **Option A (chosen):** drop the raw-err log; log a generic `"Failed to load trash"` plus `result.mapped.message` when non-null. The mapped message is more useful to a debugging contributor than the raw error and is consistent with the rest of the codebase's logging style.
- Option B: extend the helper's `error` variant to carry `{ mapped, raw: unknown }`. Adds a field most callers won't use. Rejected.

**Test:** new file `packages/client/src/hooks/useTrashManager.refresh.test.ts` directly imports `refreshTrashList` and exercises each of the four return-kind branches against fake `trashOp` and `projectRef` doubles. Existing `useTrashManager.ts` characterization tests for `openTrash` and `confirmDeleteChapter` continue to pass without modification (they exercise the helper via the hook's public surface).

### [S14] Hoist `chapterSeq.abort()` into `fetchSnapshots`; mount useEffect calls it

**File:** `packages/client/src/components/SnapshotPanel.tsx:133-150` (`fetchSnapshots`) and `:155-186` (mount useEffect).

**Current state:** `fetchSnapshots` and the mount useEffect both run the same `chapterSeq.capture()` → `fetchOp.run` → success/error pipeline, but the mount useEffect prepends `chapterSeq.abort()` before `capture()`. That abort is load-bearing on chapter switches: it bumps the sequence's epoch so the prior chapter's in-flight `.then`/`.catch` paths see `token.isStale() === true`. Without it, `capture()` would return a token at the same epoch as the prior chapter's still-outstanding token, and both would be considered current — the prior chapter's response could set state on the new chapter's panel.

**Target shape:** move the `chapterSeq.abort()` to the top of `fetchSnapshots`. Mount useEffect becomes:

```ts
useEffect(() => {
  if (!isOpen || !chapterId) return;
  void fetchSnapshots();
  return () => {
    fetchOp.abort();
  };
}, [isOpen, chapterId, fetchSnapshots, fetchOp]);
```

**Behavioural delta:** the imperative `refreshSnapshots` path (called post-create/post-delete via `useImperativeHandle`) also gains the defensive epoch bump. In practice no concurrent imperative refresh occurs on the same chapter (create + delete are user-triggered events), so this is no-op for normal flow — and harmless / arguably more correct if a future refactor introduces concurrent refreshes. Flagged in this design's "Risks / notes" section so the pushback pass notices.

**Test:** add a component-level chapter-switch test in `packages/client/src/__tests__/SnapshotPanel.test.tsx` that pins the post-hoist contract observably (pushback Issue 3, 2026-05-27). Matches the existing test pattern (cf. "aborts in-flight imperative fetchSnapshots on unmount" at line ~705, using `pendingUntilAbort`):

1. Render `SnapshotPanel` with `chapterId="ch-1"`; intercept `api.snapshots.list("ch-1", ...)` and hold the promise via `pendingUntilAbort` (do not resolve yet).
2. Rerender with `chapterId="ch-2"`; chapter B's mount-effect fires, hits the new `chapterSeq.abort()` at the top of `fetchSnapshots`, then `chapterSeq.capture()` returns a fresh-epoch token.
3. Resolve chapter A's still-held promise with a recognisable label (e.g. `[{ id: "snap-A", label: "A snapshot" }]`).
4. Assert: the panel does NOT render `"A snapshot"` — the stale response was discarded by `token.isStale()`.

Existing `SnapshotPanel` chapter-switch tests continue to pass without modification.

### [S2] CLAUDE.md updates

Three sections touched. Two are writes; one is a verify-only.

#### §Key Architecture Decisions — "Unified API error mapping" (expand existing paragraph)

The existing paragraph (CLAUDE.md lines 137-147) describes `mapApiError(err, scope)` as the single owner of API-error-to-UI-string translation. The expansion adds:

1. The mapper returns `MappedError<S>` (typed by scope `S` via a phantom parameter).
2. `ScopeExtras<S>` is the typed accessor for `extras` (compile-time tying of `onExtras` callbacks to their scope).
3. `committedCodes` is a scope-field extension of `possiblyCommitted` beyond the 2xx-BAD_JSON case — specific server codes (e.g. `UPDATE_READ_FAILURE`, `READ_AFTER_CREATE_FAILURE`, `RESTORE_READ_FAILURE`) where the write may or may not have landed.
4. Consumer call sites route through `applyMappedError(mapped, { onMessage, onTransient?, onCommitted?, onExtras? })` from `packages/client/src/errors/applyMappedError.ts`. Its `STOP` sentinel lets a callback short-circuit the rest of the chain. This is the canonical consumer pattern, parallel to `useEditorMutation` and `useAbortableSequence` (already referenced in §Save-pipeline invariants).

Single paragraph (matches the section's existing prose-only style); phrasing settled at plan-execution time using the draft below as the starting point.

**Draft text** (final wording finalized at plan-execution time):

> All client code that surfaces a user-visible message from an API error must route through `mapApiError(err, scope)` in `packages/client/src/errors/`. The mapper returns `MappedError<S> = { message, possiblyCommitted, transient, extras? }`; the `<S>` phantom parameter ties the `extras` shape to the scope, accessible via `ScopeExtras<S>`. The mapper is the single owner of code/status-to-string translation and of the cross-cutting rules (ABORTED is silent, 2xx BAD_JSON is `possiblyCommitted: true` when the scope declares `committed:` copy and `false` for read scopes that do not, NETWORK is `transient`). The `committedCodes` scope field extends `possiblyCommitted: true` beyond the 2xx-BAD_JSON case to specific server codes (e.g. `UPDATE_READ_FAILURE`, `READ_AFTER_CREATE_FAILURE`, `RESTORE_READ_FAILURE`) where the write may or may not have landed. Raw `err.message` must never reach the UI. New API surfaces add a scope entry to `scopes.ts`; they do not write ad-hoc ladders at call sites. Consumer call sites route through `applyMappedError(mapped, { onMessage, onTransient?, onCommitted?, onExtras? })` from `packages/client/src/errors/applyMappedError.ts` — its `STOP` sentinel lets a callback short-circuit the rest of the chain. This is the canonical consumer pattern, parallel with `useEditorMutation` and `useAbortableSequence`. This invariant will be enforced by ESLint in Phase 4b.4; until then, it is enforced by review.

#### §Save-Pipeline Invariants Rule 4 — four-file allowlist (verify-only)

Reading CLAUDE.md line 132: the allowlist already lists four files (HomePage.tsx, useProjectEditor.ts, useSnapshotState.ts, useTrashManager.ts — the last with `restoreRecoveryAbortRef` justification). The roadmap text describing this as deferred is stale; the update landed in 4b.3c.3 itself.

**Action:** verification step in the plan. Re-read the paragraph during plan-execution; if any drift is found (e.g. the count description still reading "three" anywhere), fix in-line. Otherwise no write.

#### §Pull Request Scope — bundling-exception acknowledgments

Current text (CLAUDE.md lines 203-213) describes the one-feature rule and notes a single recorded exception: the 2026-05-25 Phase 4b.3b decision log entry. Three additions (pushback Issue 7, 2026-05-27 — self-reference included so CLAUDE.md becomes a one-stop list of prior-art bundling exceptions):

1. Acknowledge the 2026-04-19 Phase 4b.3 bundling exception (sanitizer + CONTRIBUTING.md + Node-engines pin bundled with the unified error mapper migration), per Cluster F [I15] in the 4b.3 review.
2. Acknowledge the 2026-05-26 Phase 4b.3c three-way split (4b.3c.1/.2/.3) per the 2026-05-26 pushback decision.
3. Acknowledge the 2026-05-27 Phase 4b.3d bundling (three small refactors + docs in one PR), per this phase's decision-log entry.

**Shape:** append three sentences to the existing exception-tracking paragraph (line 213). The 4b.3b note stays in place as the first recorded exception; 4b.3, 4b.3c, and 4b.3d notes follow in chronological order. Each entry names the date and points to its decision-log entry by filename.

### [S22]/[S23] admin

Both items are `PlanAlignment` findings from the 4b.3 review:

- [S22] `vitest.config.ts` worker cap (maxForks/maxThreads: 4) — performance tuning unrelated to error mapping.
- [S23] ESLint sequence-rule test infra adjustments — adjacent fix called out for transparency.

The 4b.3 PR has already merged; retroactive splitting is impossible. The brainstorm decision (2026-05-27, Question 3): record these in this phase's decision-log entry as `accepted-as-is` under the same bundling-exception clause that covers [I15] — three independent findings ([I15] sanitizer/CONTRIBUTING/engines, [S22] vitest worker cap, [S23] ESLint test infra) all bundled in the same 4b.3 PR, all retroactively acknowledged by one exception umbrella. No PR comment, no code change.

## Out of Scope

- Re-running 4b.3c consumer migrations (already shipped).
- New CLAUDE.md sections beyond §Unified API error mapping / §Pull Request Scope additions.
- Amending merged 4b.3 commit history ([S22]/[S23] resolved via decision-log entry only).
- Phase Structure table updates for 4b.3c.2 / 4b.3c.3 / 4b.3d themselves (those land via /roadmap's step 5b as standard machinery, not as a design deliverable).

## PR Scope Decision (one-feature rule)

This phase bundles three small refactors ([S6], [S13], [S14]) plus documentation (CLAUDE.md updates) plus an admin acknowledgment ([S22]/[S23] decision-log entries). Strictly read, that is two work types (refactor + docs) — but the precedent of Phase 4b.3a (2026-04-25, "review follow-ups" bundling Clusters A/D/F) shows that thematic "review-cluster cleanup" bundles ship as one PR with an explicit decision-log entry.

This phase invokes the same exception, following the 4b.3a pattern. The 4b.3d decision-log entry will record:

- The bundling as `accepted-as-is` under the same one-feature-rule exception machinery as Phase 4b.3a / 4b.3b.
- [S22]/[S23] as `accepted-as-is` under the same bundling-exception clause that covers [I15] (no code change, decision-log evidence only).

The CLAUDE.md §Pull Request Scope addition (above) is itself the artifact that codifies "review-cluster cleanup" as a recognized exception pattern.

## Definition of Done

- CLAUDE.md §Unified API error mapping paragraph expanded.
- CLAUDE.md §Pull Request Scope addition lands (two sentences appended).
- CLAUDE.md §Save-Pipeline Invariants Rule 4 verified unchanged (no write).
- ~~[S6]~~ dropped in pushback; no work item.
- [S13] `refreshTrashList` helper extracted with discriminated-union return; `openTrash` and `confirmDeleteChapter` refresh both consume it; direct unit test for the four return-kind branches lands; existing characterization tests pass unchanged.
- [S14] `chapterSeq.abort()` hoisted into `fetchSnapshots`; mount useEffect shortened to `void fetchSnapshots()` + S4 cleanup; existing chapter-switch tests pass; new direct test for fetch-time epoch bump lands.
- `make all` green; coverage at or above CLAUDE.md §Testing Philosophy thresholds (95% statements, 85% branches, 90% functions, 95% lines).
- Zero test-output warnings (CLAUDE.md §Testing Philosophy zero-warnings rule).
- Decision-log entry written and INDEX.md updated, including [S22]/[S23] under the bundling-exception machinery.

## Dependencies

- **Phase 4b.3c.1** — introduces `applyMappedError`, `ScopeExtras<S>`, `MappedError<S>` phantom. The CLAUDE.md §Unified API error mapping expansion describes these primitives.
- **Phase 4b.3c.2** — merged 2026-05-26. The helper-consuming fixes ([I3], [S4], [S10], [S20], [I5]) are already in `main`.
- **Phase 4b.3c.3** — merged 2026-05-27. The `restoreRecoveryAbortRef` four-file allowlist entry is already in CLAUDE.md (verify-only); the I2 drift-guard sweep on `useTrashManager` is the reason [S13]'s extraction shape needs to be discriminated-union rather than naive-extract-all.

## Risks / Notes

- **[S13] discriminated-union shape preserves caller divergence.** If a future I2-like fix lands at one site only, the shape supports it without forcing a re-coupling. The cost is slightly more per-caller boilerplate vs. a callbacks-passing helper; that trade is intentional.
- **[S14] `chapterSeq.abort()` hoist changes imperative-refresh path semantics.** Each imperative refresh now bumps the sequence epoch. In practice the imperative path is post-create / post-delete, both on the same chapter as any prior in-flight fetchSnapshots, so the existing same-chapter-isStale check already handles concurrent refreshes correctly. Harmless and arguably more correct; surfaced here for pushback to evaluate.
- **CLAUDE.md §Unified API error mapping paragraph length.** Target ~230 words is long for a single paragraph but stays under the section's existing prose-only style. Split into two paragraphs only if review pushes back.
- **Roadmap Phase Structure table is stale on 4b.3c.2 / 4b.3c.3.** Both shipped (merge commits `8ae887e` and `1e440d2`) but show as "In Progress" in the table. The /roadmap step 5b machinery already covers this; not a design risk.

## Decision Log

Pushback findings and alignment findings are recorded in `docs/roadmap-decisions/2026-05-27-phase-4b-3d-mapper-internals-claude-md-updates.md` (forthcoming, written at /roadmap step 10).

### Brainstorming decisions (2026-05-27)

1. **[S13] shape:** discriminated-union return, callers do state writes. Rationale: divergent state writes between `openTrash` (sets `setTrashOpen`, logs to console) and `confirmDeleteChapter` refresh (does neither) make a callbacks-passing helper force flag parameters; the discriminated-union shape lets each caller diverge cleanly.
2. **[S14] approach:** hoist `chapterSeq.abort()` into `fetchSnapshots`. Rationale: mount and imperative paths get identical semantics; the behavioural delta on the imperative path is no-op in practice and arguably more correct.
3. **[S22]/[S23] handling:** record in this phase's decision log only — no merged-PR postscript comment, no history amend.
4. **CLAUDE.md §Unified API error mapping shape:** expand existing paragraph (~230 words, single paragraph). Matches the section's existing style.
