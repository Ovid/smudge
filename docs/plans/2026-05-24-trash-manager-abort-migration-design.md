# Phase 4b.3a.3 — Trash Manager Abort Migration (Design)

**Date:** 2026-05-24
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.3a.3 (the second of three independent file-migrations consuming the Phase 4b.3a.1 hook; 4b.3a.2 — `useFindReplaceState` — already merged)
**Prerequisite phase:** 4b.3a.1 — `useAbortableAsyncOperation` (`docs/plans/2026-04-29-abortable-async-operation-hook-design.md`)
**Sibling phase already merged:** 4b.3a.2 — `useFindReplaceState` (`docs/plans/2026-05-01-find-replace-abort-migration-design.md`)
**Companion hooks:** `useAbortableAsyncOperation` (`packages/client/src/hooks/useAbortableAsyncOperation.ts`)
**Working branch:** `trash-manager-abort-migration`

---

## Goal

Migrate `useTrashManager`'s two `AbortController` refs (`trashAbortRef`, `restoreAbortRef`) to two side-by-side `useAbortableAsyncOperation` instances (`trashOp`, `restoreOp`), preserving the existing two-ref / three-operation concurrency model. `openTrash` and `confirmDeleteChapter`'s post-delete trash refresh share `trashOp` (mutually exclusive — calling one cancels the other in flight); `handleRestore` owns `restoreOp` independently (a restore in flight does not cancel a trash fetch and vice versa). Migration is purely structural: no user-visible behaviour change.

## Why now

Phase 4b.3a.1 shipped the `useAbortableAsyncOperation` primitive. Phase 4b.3a.2 (`useFindReplaceState`) gave it its first production-side validation against a one-instance, one-operation consumer. This phase validates the hook against a different shape: a **two-instance, three-operation** consumer with both *shared* (one ref, two call sites) and *independent* (two refs) semantics in the same hook. If the primitive can model both shapes cleanly, the consumer-recovery story for 4b.3b's per-site evaluation has a stronger precedent.

## Writer-impact framing

No user-facing change. The win is reviewer-facing: the next person to touch `useTrashManager` sees two well-named hook instances owning their abort lifecycles, instead of two bespoke refs plus a hand-rolled unmount cleanup effect plus manual `if (ref.current === controller) ref.current = null` housekeeping on every success and failure path. That review-residue is what motivated extracting the hook in 4b.3a.1; this phase realizes the payoff for the second consumer.

## Architecture

`useTrashManager` allocates **two** `useAbortableAsyncOperation` instances side-by-side, one per existing ref:

```
useTrashManager
├── const trashOp = useAbortableAsyncOperation()    → shared by openTrash + confirmDeleteChapter's refresh
└── const restoreOp = useAbortableAsyncOperation()  → owned by handleRestore
```

No `useAbortableSequence` pairing — unlike `useFindReplaceState.search`, this hook has no token-isStale arbitration layer. The per-call `signal.aborted` gate IS the staleness arbitration. Consequence: the sibling design's "two-gate belt-and-suspenders" (row 7 in 4b.3a.2) doesn't apply here — each await is followed by exactly one `if (signal.aborted) return` gate, not two.

The `seedConfirmedStatusRef` effect (lines 23–26 today) is untouched — it tracks the optional `seedConfirmedStatus` callback prop across renders and is orthogonal to the abort lifecycle. Only the combined abort-cleanup effect at lines 45–51 is removed; both hook instances handle their own auto-abort on unmount.

## Behaviour mapping (every touchpoint)

Each row maps a current-code touchpoint (line numbers as of HEAD on `main` at design time) to its post-migration form. **The design names changes by behaviour, not by line, so plan-execution is robust to line drift between design and implementation.**

| # | Current behaviour | Current location | Post-migration form |
|---|---|---|---|
| 1 | `trashAbortRef = useRef<AbortController \| null>(null)` | line 36 | Removed. New: `const trashOp = useAbortableAsyncOperation();` allocated alongside the existing state hooks. |
| 2 | `restoreAbortRef = useRef<AbortController \| null>(null)` | line 44 | Removed. New: `const restoreOp = useAbortableAsyncOperation();` allocated immediately after `trashOp`. |
| 3 | Combined unmount cleanup effect: `useEffect(() => () => { trashAbortRef.current?.abort(); restoreAbortRef.current?.abort(); }, [])` | lines 45–51 | Removed entirely. Subsumed by both hooks' auto-abort on unmount. The `seedConfirmedStatusRef` effect at lines 24–26 is **not** touched — it serves a different purpose (prop-tracking, not abort lifecycle). |
| 4 | `openTrash` body — abort-prior + new controller + thread signal: `trashAbortRef.current?.abort(); const controller = new AbortController(); trashAbortRef.current = controller; ... await api.projects.trash(project.slug, controller.signal)` | lines 55–59 | `const { promise, signal } = trashOp.run((s) => api.projects.trash(project.slug, s)); const trashed = await promise;`. The callback parameter is named `s` (not `signal`) to avoid shadowing the outer destructured `signal` binding used by the gates in row 5. |
| 5 | `openTrash` body — two `if (controller.signal.aborted) return` checks (one on success path before setState, one as first statement of catch) | lines 60, 64 | `if (signal.aborted) return` against the per-call destructured `signal`. Placement is preserved: success-path gate stays immediately after `await promise`; catch-path gate stays as the first statement inside `catch`. |
| 6 | `handleRestore` body — abort-prior + new controller + thread signal: `restoreAbortRef.current?.abort(); const controller = new AbortController(); restoreAbortRef.current = controller; ... await api.chapters.restore(chapterId, controller.signal)` | lines 80–84 | `const { promise, signal } = restoreOp.run((s) => api.chapters.restore(chapterId, s)); const restored = await promise;`. Same `s`-parameter convention as row 4. |
| 7 | `handleRestore` body — two `if (controller.signal.aborted) return` checks (one on success path before setState/seed, one as first statement of catch) | lines 85, 116 | `if (signal.aborted) return` against the per-call destructured `signal`. Placement preserved: success-path gate stays **before** the `seedConfirmedStatusRef.current?.(...)` call so an aborted restore does not seed stale cache data; catch-path gate stays as the first statement inside `catch`. |
| 8 | `handleRestore` body — manual ref nulling on success (`if (restoreAbortRef.current === controller) restoreAbortRef.current = null`) and failure (same pattern) | lines 86, 110 | Removed entirely. The hook owns the ref lifecycle; ref-nulling-on-settled is no longer the consumer's job. The `seedConfirmedStatusRef.current?.(...)` call (line 104 today) stays exactly where it is — orthogonal. |
| 9 | `confirmDeleteChapter`'s post-delete refresh — abort-prior + new controller + thread signal: `trashAbortRef.current?.abort(); const controller = new AbortController(); trashAbortRef.current = controller; ... await api.projects.trash(project.slug, controller.signal)` | lines 166–170 | `const { promise, signal } = trashOp.run((s) => api.projects.trash(project.slug, s)); const trashed = await promise;`. Same `trashOp` instance as `openTrash` — calling either while the other is in flight aborts the prior, by design (the pre-migration code's shared-ref behaviour). |
| 10 | `confirmDeleteChapter`'s refresh — two `if (controller.signal.aborted) return` checks | lines 171, 174 | `if (signal.aborted) return` against the per-call destructured `signal`. Placement preserved. |
| 11 | Inline review-callout comments referencing `trashAbortRef`/`restoreAbortRef` by name | lines 31–35, 37–43, 75–79 | **Within these three comment blocks only**: remove any token matching `\b(trash\|restore)AbortRef\b` and rephrase the surrounding sentence to refer to `trashOp`/`restoreOp` instead. Preserve the *why* — the zero-warnings invariant in 31–35, the mirror-the-pattern rationale in 37–43, the unmount-cleanup-can-sever-mid-flight rationale in 75–79. **Do not touch any other inline comment**, including: the C2 seed rationale (lines 100–104), the catch-silent-abort rationale (lines 111–115), the possiblyCommitted UX rationale (lines 122–133, also explicitly listed under §Out of scope), and the S4+S5 refresh rationale (lines 159–165). Those comment blocks are orthogonal to the abort lifecycle and never name the old refs — pruning them would damage rationale that the tests in this PR pin but cannot replace. |

### Why each `if (signal.aborted) return` gate stays put

The pre-migration code's gates exist for the zero-warnings invariant (CLAUDE.md §Testing Philosophy): a superseded or unmount-time abort must not fire `console.error` or call `setState` on a torn-down hook. Today the gates read `controller.signal.aborted`; post-migration they read the destructured `signal` returned by `trashOp.run` / `restoreOp.run`. Same object identity (the hook guarantees the signal it returns is the one passed to `fn` — see `useAbortableAsyncOperation` line 48 and the prerequisite design's behavioural-contract bullet #2), same behaviour, same test coverage.

The placement of the catch-path gate before `mapApiError(err, "trash.…")` is preserved exactly: aborted errors take the silent path; non-aborted errors flow through the mapper. The mapper itself returns `message: null` for ABORTED today, so the gate is belt-and-suspenders against a future change to that contract — same rationale as the sibling phase's row-7 gates.

### Cross-instance independence is structural, not gated

`handleRestore`'s `restoreOp.run(...)` allocates a fresh controller via the hook's internal `useRef`, distinct from `trashOp`'s internal `useRef`. They cannot collide. This is the load-bearing invariant the Out-of-Scope section warns against folding away — pinned by test #4 below, defended by both the architectural separation and the prose comment in §Out of Scope.

## Test plan

All test changes land in `packages/client/src/__tests__/useTrashManager.test.ts` (the existing 326-line file). Per the roadmap "characterization tests BEFORE migration" requirement, the new tests land *first*. They pass green against the pre-migration source (they pin behaviour the current code already provides) and continue to pass against the post-migration source (the migration must preserve it). This is the expected shape for a migration characterization test — see §Risks.

The existing `describe` block is mis-named (`"useTrashManager.handleRestore — I2 committed UX"`) for the breadth it covers (openTrash, handleRestore, the I5 unmount/abort tests, the C2 seed test). Restructuring the describe block is **out of scope** per the one-feature rule; new tests land inside the existing block.

### Five new tests

All use `pendingUntilAbort(signal)` from `__tests__/helpers/abortableMocks.ts` for never-resolving mocks (already in use by existing I5 tests at lines 144 and 185).

1. **`openTrash aborts the prior in-flight signal when called again rapidly`.** Mock `api.projects.trash` with `pendingUntilAbort(signal)`; capture each call's signal via `vi.mocked(api.projects.trash).mock.calls[N][1]`. Call `openTrash()` once (capture signal1, assert `!aborted`). Call `openTrash()` again (capture signal2). Assert `signal1.aborted === true` and `signal2.aborted === false`. Pins the abort-prior contract on `trashOp` via the `openTrash` path — not currently exercised at the API surface (existing tests touch it only via unmount).

2. **`handleRestore aborts the prior in-flight signal when called again rapidly`.** Same shape as test #1, but for `api.chapters.restore` and the `handleRestore` path. Captures signals via `vi.mocked(api.chapters.restore).mock.calls[N][1]`. Pins the abort-prior contract on `restoreOp`. Requires `openTrash` to be called first (to seed the trashed list so `handleRestore` has work to do); resolve that with a plain `mockResolvedValueOnce([chapter])` so it doesn't interfere with the in-flight assertion on the restore signals.

3. **`confirmDeleteChapter's post-delete trash refresh aborts on unmount and threads the signal`.** Mock `handleDeleteChapter` (the prop) to resolve `true`; set `trashOpen` so the refresh branch fires (call `openTrash` first to satisfy the `if (trashOpen && project)` guard, with `pendingUntilAbort` so the openTrash signal can be aborted by the refresh's abort-prior); set `deleteTarget` via `setDeleteTarget`; mock `api.projects.trash`'s **second** call with `pendingUntilAbort(signal)` (the post-delete refresh). Capture the refresh's signal. Call `unmount()`. Assert `refreshSignal.aborted === true`. Pins three things in one test: abort-on-unmount + signal-threading for the previously-unpinned refresh path, plus abort-prior on the shared `trashOp` (the openTrash signal is aborted at the moment the refresh fires — the test asserts this too via the captured openTrash signal).

4. **`trashOp and restoreOp use independent controllers (cross-ref independence)`.** Mock `api.projects.trash` with `pendingUntilAbort(signal)` (call 1, never resolves); mock `api.chapters.restore` with `pendingUntilAbort(signal)` (also never resolves). Call `openTrash()` (capture trashSignal); without awaiting, call `handleRestore("ch-x")` (capture restoreSignal). Assert `trashSignal.aborted === false` AND `restoreSignal.aborted === false` — the two are simultaneously in flight on different controllers. Then call `openTrash()` again; assert the first `trashSignal` is now aborted but `restoreSignal` is still **not** aborted (the new openTrash only touched `trashOp`). Then call `handleRestore("ch-y")`; assert `restoreSignal` is now aborted (the new restore only touched `restoreOp`). Pins the Out-of-Scope §"Folding `trashOp` and `restoreOp`" invariant — without this test, a future maintainer collapsing the two instances into one would silently regress the "user can be restoring while the trash list refreshes" concurrency model.

5. **`openTrash and confirmDeleteChapter's refresh share trashOp (shared-ref behaviour)`.** Mock `api.projects.trash` with `pendingUntilAbort(signal)` so the first call (openTrash) stays in flight. Call `openTrash()`; capture openTrashSignal; assert `!aborted`. Set up `confirmDeleteChapter` to fire (set `deleteTarget`, mock `handleDeleteChapter` to resolve `true`). The refresh inside `confirmDeleteChapter` will call `api.projects.trash` a second time. Capture refreshSignal. Assert `openTrashSignal.aborted === true` (the refresh's `trashOp.run` aborted it) and `refreshSignal.aborted === false`. Pins the shared-`trashOp` concurrency model that today depends on both call sites referencing the same `trashAbortRef`; post-migration depends on both calling `trashOp.run` on the same hook instance.

**Signal-capture pattern:** Use the same idiom as the existing I5 tests (lines 147–150 and 195–198):

```ts
let capturedSignal: AbortSignal | undefined;
vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
  capturedSignal = signal;
  return pendingUntilAbort(signal);
});
```

For tests that need multiple captures, use `mockImplementationOnce` chains and an array of captured signals:

```ts
const capturedSignals: AbortSignal[] = [];
vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
  if (signal) capturedSignals.push(signal);
  return pendingUntilAbort(signal);
});
```

The implementation plan picks the per-test idiom.

### Existing tests (no change)

All seven existing tests in the file stay green by construction:

| Existing test | Why it still passes post-migration |
|---|---|
| `on RESTORE_READ_FAILURE, removes the chapter from the trashed list and shows the committed message` (line 71) | The `possiblyCommitted` branch in the catch is untouched; the migration only changes how `controller`/`signal` are obtained. |
| `on 2xx BAD_JSON (possiblyCommitted), removes the chapter from trash and shows the committed message` (line 108) | Same as above. |
| `aborts in-flight trash fetch on unmount (I5)` (line 144) | The captured signal is now `trashOp`'s internal controller's signal; abort-on-unmount is provided by `useAbortableAsyncOperation`'s unmount cleanup at lines 31–35 of the hook. |
| `on ABORTED error, does not log to console.error (I5)` (line 167) | The `if (signal.aborted) return` gate at the top of the catch (preserved in row 5/7/10) skips the `console.error("Failed to load trash:", err)` line. |
| `aborts in-flight restore on unmount (User callout 2026-04-25)` (line 185) | Same as the I5 unmount test, but for `restoreOp`. |
| `on ABORTED restore error, does not log or surface state (User callout 2026-04-25)` (line 220) | Same as the ABORTED-silent test, but for `handleRestore`'s catch. |
| `seeds confirmed-status cache for the restored chapter (C2 2026-04-25)` (line 249) | The `seedConfirmedStatusRef.current?.(...)` call (line 104 today) is preserved exactly per row 8, after the new `if (signal.aborted) return` gate. |
| `on PROJECT_PURGED (non-committed failure), keeps the chapter in trash and shows error` (line 288) | The non-committed branch of the catch is untouched. |

### Structural check

Extend `packages/client/src/__tests__/migrationStructuralCheck.test.ts` by **appending** `resolve(clientSrcRoot, "hooks/useTrashManager.ts")` to the `migrated` arrays in two existing tests:

```ts
// Existing test at line 109 — extend the migrated array
it("useAbortableAsyncOperation is imported by every file that has been migrated to it", () => {
  const migrated = [
    resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
    resolve(clientSrcRoot, "hooks/useTrashManager.ts"),  // ← new
  ];
  // ...
});

// Existing test at line 122 — extend the migrated array
it("migrated files do not contain raw useRef<AbortController>", () => {
  const migrated = [
    resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
    resolve(clientSrcRoot, "hooks/useTrashManager.ts"),  // ← new
  ];
  // ...
});
```

The shared `USE_REF_ABORT_CONTROLLER_PATTERN` (line 20) and the `importPatternFor` helper (line 29) landed in 4b.3a.2's cleanup pass; this phase introduces no new regex. Update the inline comment at lines 110–113 to note that 4b.3a.3 has landed and only 4b.3a.4 (`ImageGallery`) remains before the per-file check can collapse to a global `packages/client/src` ban.

### Coverage & noise

Coverage thresholds (CLAUDE.md §Testing Philosophy: 95/85/90/95) are already met by the existing test file; the migration is a structural ref-replacement and adds no new branches the existing tests don't reach. The five new tests strictly *add* branch coverage by pinning behaviours that today have no dedicated assertion. Verify coverage holds via `make cover` and inspect the report for `useTrashManager.ts`; if it regresses on any axis, add a targeted test rather than relax thresholds.

Zero test warnings (CLAUDE.md §Testing Philosophy): no `console.warn`/`console.error` is expected. The existing `errorSpy` and `warnSpy` setup at lines 54–68 already covers the spy-and-restore discipline; new tests inherit it. No new warning-pin sites.

## Migration order & PR shape

**Commit ordering (one PR, multiple commits).** Per the roadmap "characterization tests BEFORE migration" requirement:

1. **Commit 1 — Characterization tests for `trashOp`.** Add new tests #1 (abort-prior on `openTrash`), #3 (refresh path: abort-on-unmount + signal-thread + abort-prior on shared `trashOp`), and #5 (shared-`trashOp` behaviour across `openTrash` and refresh). All pass green against pre-migration source.

2. **Commit 2 — Characterization tests for `restoreOp` and cross-ref independence.** Add new tests #2 (abort-prior on `handleRestore`) and #4 (cross-ref independence between `trashOp` and `restoreOp`). Both pass green against pre-migration source.

3. **Commit 3 — Migration source.** Apply the 11-row replacement from §Behaviour mapping to `packages/client/src/hooks/useTrashManager.ts`. All tests (existing 7 + new 5) stay green.

4. **Commit 4 — Structural check append.** Extend `migrationStructuralCheck.test.ts`'s two `migrated` arrays with `useTrashManager.ts`; update the inline comment per §Structural check. Both assertions pass green against the just-migrated `useTrashManager.ts`.

5. **Commit 5 — Cleanup (if needed).** Inspect the migrated `useTrashManager.ts` for residual cruft: stale comments referencing `trashAbortRef`/`restoreAbortRef` that survived row 11's pruning, unused imports (`useEffect` may stay — it's still needed for the `seedConfirmedStatusRef` effect — but `useRef` may become unused-for-AbortController; verify before removing since `seedConfirmedStatusRef` also uses `useRef`). Tidy. If nothing needs tidying, omit this commit; the order matters, not the count.

**This phase's tests are characterization tests — they pin behaviour the source change must preserve. They are not red-then-green tests in the strict sense, since the pre-migration code already satisfies them.** The commit ordering preserves the discipline (no source change without prior test); it does not pretend the test commits go red against the current source. Splitting commits this way keeps the diff scannable: the test commits prove the behaviour is pinned before the source change, and the migration commit isolates the source change from any test additions.

**One PR, one refactor.** Per CLAUDE.md §Pull Request Scope:
- One file's worth of migration only. Do not bundle 4b.3a.4 (`ImageGallery`) — independent migration, lives in its own PR.
- No unrelated cleanup. The mis-named `describe` block stays mis-named; restructuring is out of scope.
- No touching the `seedConfirmedStatusRef` effect, the `possiblyCommitted` UX logic, or the C2 cache-seeding wiring.
- The structural-check extension lands in this PR because it's the test that proves the migration; it is not a separate refactor.

**Branch.** Working branch `trash-manager-abort-migration` (already created off `main`). Merge handled by Ovid post-PR-approval; the implementation plan does not push or merge.

## Risks & mitigations

- **"Characterization tests don't go red against current code."** All five new tests pass green against the pre-migration source — that's the *expected* shape for a migration characterization test. This is **not** a TDD-violation flag for the reviewer. Call it out in the PR description so the reviewer doesn't read the green-green-green commit sequence as cargo-culted RED-GREEN-REFACTOR steps. Sibling phase 4b.3a.2 set the precedent; the reviewer is familiar with the shape.

- **`mock.calls[N][1]` signal capture is index-fragile.** If a future test reorders the args of `api.projects.trash` or `api.chapters.restore`, the index breaks silently. Mitigate by following the existing I5 test idiom (`mockImplementation((_slug, signal) => { capturedSignal = signal; ... })`) — the implementation captures via the destructured second parameter name, not by index. The implementation plan codifies this pattern for the new tests.

- **Cross-ref test (#4) is the load-bearing one — must not be deleted as "redundant."** A future maintainer who reads the cross-ref test and thinks "that's structural, the two hook instances obviously don't share state" would be right *for the implementation that exists today* and wrong about the contract the test documents. Mitigate with an explicit code comment at the test referencing the Out-of-Scope §"Folding `trashOp` and `restoreOp` into one instance" rationale: the test is the executable enforcement of the rule that the prose comment alone cannot enforce.

- **Shared-ref test (#5) and the `confirmDeleteChapter` refresh test (#3) both exercise the post-delete refresh path.** Test #3 asserts abort-on-unmount; test #5 asserts shared-`trashOp` abort-prior. They are orthogonal — one fails if unmount doesn't abort, the other fails if `openTrash` and the refresh stop sharing the same controller pool. Both deserve to exist; the dimensions they pin are distinct.

- **`seedConfirmedStatusRef` effect must not be touched.** Lines 23–26 set up a `useRef` for the optional `seedConfirmedStatus` callback and a `useEffect` that updates it on prop change. Both are orthogonal to the abort lifecycle. The migration touches **only** the lines listed in §Behaviour mapping (36, 44, 45–51, 55–64, 80–116, 166–174, and the inline review comments). Pinned by existing test "seeds confirmed-status cache for the restored chapter (C2 2026-04-25)" — it would fail if the seed effect were broken.

- **`useEffect` and `useRef` imports — careful with cleanup.** Today `useTrashManager` imports `useState, useCallback, useEffect, useRef` (line 1). Post-migration `useRef` is still needed (for `seedConfirmedStatusRef`) and `useEffect` is still needed (for the seed effect at lines 24–26). Do **not** auto-remove them in Commit 5; verify by reading the imports list against the post-migration file. The other unmount-cleanup `useEffect` block (lines 45–51) goes, but the `seedConfirmedStatusRef` effect stays.

- **`pendingUntilAbort`-based tests across multiple in-flight operations require careful resolution sequencing.** Tests #4 and #5 keep multiple operations in flight simultaneously. None of them should be awaited (or they hang the test); the assertions key on `signal.aborted` state, not on promise resolution. The existing I5 tests (lines 144, 185) demonstrate the pattern: `act(() => { void result.current.openTrash(); })` (note `void`, no await), then `await waitFor(() => expect(api...).toHaveBeenCalled())` to ensure the mock fired before asserting on signals. Implementation plan codifies this.

## Definition of Done

- `packages/client/src/hooks/useTrashManager.ts` no longer contains `useRef<AbortController>`; the only abort primitives are two `useAbortableAsyncOperation` instances. Verified by the structural check in `migrationStructuralCheck.test.ts`.
- The two new hook instances (`trashOp`, `restoreOp`) are allocated side-by-side; `trashOp` is shared by `openTrash` and `confirmDeleteChapter`'s post-delete refresh, `restoreOp` is owned by `handleRestore` — preserving the pre-migration concurrency model.
- The combined abort-cleanup `useEffect` at lines 45–51 is removed; both hook instances handle their own auto-abort. The `seedConfirmedStatusRef` effect at lines 24–26 is **untouched**.
- All `controller`-sourced `if (controller.signal.aborted) return` gates are replaced with `if (signal.aborted) return` against the per-call destructured `signal`. Placement preserved: gates stay immediately after each `await`, and stay above `mapApiError` calls in catch blocks.
- All seven existing tests in `__tests__/useTrashManager.test.ts` continue to pass.
- Five new tests added to `__tests__/useTrashManager.test.ts`: abort-prior on `openTrash`, abort-prior on `handleRestore`, `confirmDeleteChapter` refresh path (abort-on-unmount + signal-thread + abort-prior), cross-ref independence, and shared-`trashOp` behaviour across `openTrash` and refresh.
- `migrationStructuralCheck.test.ts` extended with `useTrashManager.ts` appended to both `migrated` arrays; inline comment updated to reflect that only 4b.3a.4 remains.
- `make all` green at PR close (lint, format, typecheck, coverage, e2e — e2e shouldn't change).
- Coverage on `useTrashManager.ts` holds at or above CLAUDE.md §Testing Philosophy thresholds (95/85/90/95).
- Zero test warnings.
- No user-visible behaviour change. No `CLAUDE.md` change required (rule 4 already documents `useAbortableAsyncOperation` as the canonical primitive for network-cancellation; the hook is not consumer-specific in the prose).
- The PR commit sequence honors the §Migration order ordering. Branch (`trash-manager-abort-migration`) ready for Ovid's handling at merge time.

## Out of scope (explicit)

- **Folding `trashOp` and `restoreOp` into one instance.** They serve different concurrency models — the user can be restoring a chapter while the trash list refreshes — and merging would silently break that. Pinned by test #4 (cross-ref independence). Out of scope to fold; explicit guard against future regression.
- **Restructuring the existing mis-named `describe` block** (`"useTrashManager.handleRestore — I2 committed UX"` covers far more than just handleRestore + I2). One-feature rule: not part of this migration. File a follow-up if it bothers you.
- **The C2 `seedConfirmedStatusRef` cache-seeding logic** (lines 23–26, 100–104). Orthogonal to abort lifecycle. Pinned by existing C2 test; do not touch.
- **The `possiblyCommitted` UX branch** (lines 122–137) — orthogonal to the abort migration. Pinned by existing RESTORE_READ_FAILURE and BAD_JSON tests.
- **Other consumers of `useAbortableAsyncOperation`** — Phase 4b.3a.4 (`ImageGallery`) is the remaining sibling migration. Lands in its own PR.
- **Global "no `useRef<AbortController>` in `packages/client/src`" ban.** Out of scope until 4b.3a.4 also lands. The per-file check this phase extends is the local enforcement; 4b.3a.4 (the last sibling) can collapse the array into a global ban.
- **CLAUDE.md edits.** The text under §Save-pipeline invariants rule 4 already documents `useAbortableAsyncOperation` as the canonical primitive for network cancellation; the prose is not consumer-specific. No edit is required.
- **Lint enforcement** of "no hand-rolled `useRef<AbortController>` outside the hook." Deferred per the prerequisite design.
- **`Editor.tsx` paste/drop image upload and the remaining client `AbortController` sites** — out of scope here; covered by Phase 4b.3b's per-site evaluation.

## Dependencies

- **Phase 4b.3a.1** — the `useAbortableAsyncOperation` hook must exist. Already shipped.
- **Phase 4b.3a.2** — the structural-check helpers (`USE_REF_ABORT_CONTROLLER_PATTERN`, `importPatternFor`) must exist. Already shipped on `main`.
- **Independent of Phase 4b.3a.4** — may land in any order relative to it.
- **Does not block any downstream phase.** Phase 4b.3b's per-site evaluation depends on the hook existing (4b.3a.1), not on this consumer migration.
