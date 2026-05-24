# Phase 4b.3a.2 — Find/Replace Abort Migration (Design)

**Date:** 2026-05-01
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.3a.2 (one of three independent file-migrations consuming the Phase 4b.3a.1 hook)
**Prerequisite phase:** 4b.3a.1 — `useAbortableAsyncOperation` (`docs/plans/2026-04-29-abortable-async-operation-hook-design.md`)
**Companion hooks:** `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`), `useAbortableAsyncOperation` (`packages/client/src/hooks/useAbortableAsyncOperation.ts`)
**Working branch:** `find-replace-abort-migration`

---

## Goal

Migrate `useFindReplaceState.search`'s hand-rolled `searchAbortRef` to a single `useAbortableAsyncOperation` instance, allocated alongside the existing `searchSeq`. The two hooks remain orthogonal per CLAUDE.md §Save-pipeline invariants rule 4 and coexist on this one operation by design — `searchSeq` arbitrates response staleness via epoch tokens; `useAbortableAsyncOperation` cancels in-flight network requests via `AbortController`. Migration is purely structural: no user-visible behaviour change.

## Why now

Phase 4b.3a.1 shipped the `useAbortableAsyncOperation` primitive. This phase is one of three independent file-migrations that consume it (4b.3a.2 / 4b.3a.3 / 4b.3a.4). `useFindReplaceState` is the simplest of the three — a single in-flight operation, no shared-ref coupling — and gives the hook its first production-side validation. Whichever of the three migrations lands first carries that signal.

## Writer-impact framing

No user-facing change. The win is reviewer-facing: the next person to touch `useFindReplaceState` sees one well-named hook owning the abort lifecycle instead of a bespoke ref + cleanup-effect pattern that future reviewers would have to re-derive. That review-residue is the same smell that motivated extracting the hook in 4b.3a.1; this phase realizes the payoff.

## Architecture

`useFindReplaceState` already composes one `useAbortableSequence`. After this phase it composes two hooks side-by-side:

```
useFindReplaceState
├── useAbortableSequence (existing)   → response-staleness arbitration via tokens
└── useAbortableAsyncOperation (new)  → network cancellation via AbortController
```

Every existing call site that today does `searchAbortRef.current?.abort()` becomes `op.abort()`. Every site that today does `new AbortController()` + `searchAbortRef.current = controller` becomes a single `op.run(signal => api.search.find(...))` call. The unmount and project-change cleanup branches of the abort lifecycle move *into* the hook (auto-abort on unmount; explicit `op.abort()` on project-change). The `searchSeq` calls (`start`, `abort`, `token.isStale()`) are untouched. The two hooks live alongside each other, not nested.

## Behaviour mapping (every touchpoint)

Each row maps a current-code touchpoint (line numbers as of HEAD on `main` at design time) to its post-migration form. **The design names changes by behaviour, not by line, so plan-execution is robust to line drift between design and implementation.**

| # | Current behaviour | Current location | Post-migration form |
|---|---|---|---|
| 1 | `searchAbortRef = useRef<AbortController \| null>(null)` | line 78 | Removed. New: `const op = useAbortableAsyncOperation();` allocated alongside `const searchSeq = useAbortableSequence();`. |
| 2 | Unmount cleanup effect: `searchAbortRef.current?.abort(); searchAbortRef.current = null` | lines 99–104 | Removed entirely. Subsumed by the new hook's auto-abort on unmount. |
| 3 | Project-change cleanup: `searchAbortRef.current?.abort(); searchAbortRef.current = null` | lines 130–131 | Replaced with `op.abort();`. Surrounding sibling lines (`setQuery("")`, `setLoading(false)`, `searchSeq.abort()`, etc.) are untouched. |
| 4 | `closePanel`: `searchAbortRef.current?.abort(); searchAbortRef.current = null` | lines 168–169 | Replaced with `op.abort();`. The other `closePanel` actions (state clears, `searchSeq.abort()`, `clearTimeout(debounceRef.current)`) are untouched, including their relative ordering. |
| 5 | `search()` body: `searchAbortRef.current?.abort()` (early-bail prefix) | line 193 | Removed for the non-empty-query path (the abort-prior is now done by `op.run()` itself). **For the empty-query path** (the `if (!query)` early-bail at row 9), an explicit `op.abort()` is added at the top of that branch to preserve the pre-migration abort-prior behaviour — `op.run()` never fires when the query is empty, so without the explicit abort the prior in-flight search would continue running server-side until unmount/closePanel/project-change. The empty-query path is rarely hit in practice (the debounce effect early-returns when query is empty, so it's only reachable via external callers), but the preservation is faithful to the pre-migration design intent. |
| 6 | `search()` body: `const controller = new AbortController(); searchAbortRef.current = controller;` then `await api.search.find(slug, frozenQuery, frozenOptions, controller.signal)` | lines 212–213, 217 | Replaced with `const { promise, signal } = op.run((s) => api.search.find(slug, frozenQuery, frozenOptions, s)); const result = await promise;`. The callback parameter is named `s` (not `signal`) to avoid shadowing the outer destructured `signal` binding that the new gates in row 7 reference. |
| 7 | (does not exist today) | — | **NEW: `if (signal.aborted) return;` immediately after `await promise;` resolves on the success path,** before `setResults`/`setResultsQuery`/`setResultsOptions`. **NEW: `if (signal.aborted) return;` at the top of the `catch` block, before `mapApiError(err, ...)` and before `if (token.isStale()) return;`.** Belt-and-suspenders against (a) a future code path that calls `op.abort()` without bumping the seq, and (b) `mapApiError`'s ABORTED handling ever changing. The token-isStale check stays in place after both new gates as the response-staleness arbitration. |
| 8 | `finally`: `if (searchAbortRef.current === controller) searchAbortRef.current = null` | line 259 | Removed. The hook owns the ref lifecycle. The surrounding `if (!token.isStale()) setLoading(false)` stays exactly as-is. |
| 9 | Empty-query early-bail: `searchAbortRef.current = null` | line 195 | Removed. The hook owns the ref lifecycle; this branch never allocated a controller in the first place, so there is nothing to clear. |

### Row-7 placement detail

The success-path gate goes between `await promise` and `setResults(result)`:

```ts
const { promise, signal } = op.run((s) => api.search.find(slug, frozenQuery, frozenOptions, s));
const result = await promise;
// Belt-and-suspenders against a future op.abort() path that doesn't also bump
// searchSeq, and against mapApiError's ABORTED handling changing. The
// token.isStale() chain below also catches every abort path that exists
// today; this gate locally documents the per-call signal contract.
if (signal.aborted) return;
if (token.isStale()) return;
setResults(result);
// ...
```

The catch-path gate goes as the *first* statement inside `catch`, *above* the existing `if (token.isStale()) return` and *above* the `mapApiError` call:

```ts
} catch (err) {
  // See success-path comment above. Placed before mapApiError so an aborted
  // network error bypasses error mapping entirely — mapApiError's
  // ABORTED-message-null path is the unified contract today, but this gate
  // insulates useFindReplaceState from any future change to that contract.
  if (signal.aborted) return;
  if (token.isStale()) return;
  const { message } = mapApiError(err, "findReplace.search");
  // ...
}
```

The token-isStale guard stays after the signal gate in both places, as the response-staleness arbitration that the prerequisite design's "two-hook orthogonality" depends on.

### Cross-axis pairing remains explicit at every site

`closePanel`, project-change, and the new `search()` flow all keep the existing `searchSeq` calls unchanged (`searchSeq.abort()` for the cancellation paths, `searchSeq.start()` for the new-search path). The migration touches only the `searchAbortRef`-related lines.

## Test plan

All test changes land in `packages/client/src/__tests__/useFindReplaceState.test.ts` (the existing 688-line file). Per the roadmap "characterization tests BEFORE migration" requirement, the new tests and assertion-tightenings land *first*. They pass green against the pre-migration source (they pin behaviour the current code already provides) and continue to pass against the post-migration source (the migration must preserve it). This is the expected shape for a migration characterization test.

### Tightening existing tests (assertions added in place)

Add `expect(signal.aborted).toBe(true)` to the existing tests below. The signal is captured from `mockFind`'s call args (`mockFind.mock.calls[N][3]` is the `AbortSignal`). Use a small inline test helper — `function captureSignal(callIndex = 0): AbortSignal { return mockFind.mock.calls[callIndex][3] as AbortSignal; }` — at the top of the new tests block to absorb the index-fragility risk noted under §Risks. **Typing note:** the existing test file declares `mockFind` as `api.search.find as ReturnType<typeof vi.fn>`, which makes `mock.calls[N]` an `any[]`. The `as AbortSignal` cast in the helper is therefore a cast on an `any[]` element. If the project's lint config rejects that under a `no-unsafe-type-assertion`-style rule, type the mock at declaration site as `vi.fn<typeof api.search.find>()` instead; otherwise inline the cast as written. The implementation plan picks whichever approach the lint pass accepts.

| Existing test | Assertion change |
|---|---|
| `closePanel cancels a pending debounce timer` | No change — no signal exists yet at that point in the test; the debounce timer is cleared before any fetch fires. |
| `closePanel clears stale result state` | No change — the test resolves the fetch via `mockResolvedValue` *before* `closePanel()` runs; the pre-migration `search()` finally-block clears `searchAbortRef.current` on success, so the captured signal is NOT aborted pre-migration. The `signal.aborted === true` assertion would have failed pre-migration → not a characterization test. **The closePanel-aborts-in-flight contract is instead pinned by new test #4 below**, which uses a never-resolving mock to keep the search genuinely in flight at closePanel time. |
| `clears loading on project-change reset so the new panel is not stuck 'Searching…' (I2)` | After `rerender({ slug: 'second', id: 'proj-2' })`: capture the in-flight signal; assert `signal.aborted === true`. The existing test resolves the orphaned response; that part stays. |
| `search() silently swallows ABORTED errors` | No change — the test mocks `mockFind` to reject with an ABORTED error; the signal-state path isn't what's being exercised. |
| `debounced auto-search triggers after typing when panel is open` | No change — the existing `expect.any(AbortSignal)` arg-shape assertion is what this test is for. |

### Four pure-new tests (added at end of file)

1. **`search() aborts the prior in-flight signal when called again rapidly`.** Issue search1 against a never-resolving promise; capture signal1. Issue search2; capture signal2. Assert `signal1.aborted === true` and `signal2.aborted === false`. Pins the abort-prior contract that the hook's `op.run()` provides — not currently exercised at the API surface (existing tests touch it only via debounce indirection, which doesn't pin the explicit invariant).

2. **`search() in-flight signal aborts on hook unmount`.** Issue a search against a never-resolving promise; capture the signal. Call `unmount()`. Assert `signal.aborted === true`. Pins the auto-abort-on-unmount contract. Passes against pre-migration code (the unmount cleanup effect at lines 99–104 provides it); after migration it pins that the hook's auto-abort still honors it.

3. **`search() success-path setState is suppressed when the signal aborts between await and the next line`.** Issue a search whose `mockFind` returns a manually-controlled promise. Before resolving, abort via `closePanel()` (or directly via a follow-up `search()`). Resolve the promise. Assert `result.current.results` is unchanged. Pins that the success-path setState is suppressed when the prior search is aborted. **Limitation:** the design does not differentiate which of the two row-7 gates (`signal.aborted` vs. `token.isStale()`) does the suppression — production abort paths bump both, so the test cannot tell them apart, and a future maintainer who deletes the `signal.aborted` gate would not see this test fail. The code comment at the gate (per §Risks) is the design-time enforcement of the gate's intent; this test is a behavioural backstop covering the combined behaviour. Pinning the gates in isolation would require contrived production-impossible state (mocking `useAbortableAsyncOperation` directly) and is explicitly out of scope.

4. **`closePanel aborts an in-flight search signal`.** Issue a search against a never-resolving promise (so it stays in flight at closePanel time); capture the signal. Assert `signal.aborted === false` pre-closePanel. Call `closePanel()`. Assert `signal.aborted === true`. Pins the closePanel abort-of-in-flight contract — pre-migration via `searchAbortRef.current?.abort()`, post-migration via `op.abort()`. **Why this test exists:** the §Tightening table above had originally proposed adding a `signal.aborted` assertion to the existing `closePanel clears stale result state` test, but that test resolves the fetch before closePanel and the pre-migration finally-block nulls the controller ref on success — the assertion would have failed pre-migration. This dedicated test uses a never-resolving mock to keep an in-flight signal at closePanel time, making the assertion meaningful both pre- and post-migration.

### Structural check

Extend `packages/client/src/__tests__/migrationStructuralCheck.test.ts` with two new assertions, mirroring the existing `useAbortableSequence` migration block (lines 76–90):

```ts
it("useAbortableAsyncOperation is imported by every file that has been migrated to it", () => {
  const migrated = [
    resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
  ];
  for (const file of migrated) {
    const source = readFileSync(file, "utf-8");
    expect(source, `${file} should import useAbortableAsyncOperation`).toMatch(
      /useAbortableAsyncOperation/,
    );
  }
});

it("migrated files do not contain raw useRef<AbortController>", () => {
  const migrated = [
    resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
  ];
  const pattern = /useRef\s*<\s*AbortController\s*(?:\|\s*null\s*)?>/;
  for (const file of migrated) {
    const source = readFileSync(file, "utf-8");
    expect(source, `${file} should not contain useRef<AbortController>`).not.toMatch(pattern);
  }
});
```

The regex covers both `useRef<AbortController>` and `useRef<AbortController | null>` — every existing site in the codebase uses the `| null` form, so the narrow form would never catch the realistic drift case (a future change reverting the migration with `useRef<AbortController | null>(null)`).

Future migration phases (4b.3a.3 / 4b.3a.4) extend the `migrated` array by one entry each. Whichever lands last can collapse the per-file checks into a global ban (out of scope for this phase).

### Coverage & noise

Coverage thresholds (CLAUDE.md §Testing Philosophy: 95/85/90/95) are already met by the existing test file; the migration is a structural ref-replacement and adds no new branches the existing tests don't reach. The two new gates in row 7 add two new branches; both are exercised by new test #3 (success path) and the existing `search() silently swallows ABORTED errors` test (catch path — `mapApiError` returns `null` for ABORTED today, so the existing test indirectly covers the new gate's behaviour). Verify coverage holds via `make cover` and inspect the report for `useFindReplaceState.ts`; if it regresses on any axis, add a targeted test rather than relax thresholds.

Zero test warnings (CLAUDE.md §Testing Philosophy): no `console.warn`/`console.error` is expected. No new warning-pin sites.

## Migration order & PR shape

**Commit ordering (one PR, multiple commits).** Per the roadmap "characterization tests BEFORE migration" requirement:

1. **Commit 1 — Characterization tests for the abort-prior contract.** Add new test #1 and new test #2; tighten the two existing tests in §3a with signal-state assertions.

2. **Commit 2 — Characterization test for the new success-path gate.** Add new test #3.

3. **Commit 3 — Migration source.** Apply the row-by-row replacement from §Behaviour mapping to `packages/client/src/hooks/useFindReplaceState.ts`. All tests stay green.

4. **Commit 4 — Structural check.** Extend `migrationStructuralCheck.test.ts` with the two new assertions. Both pass green against the just-migrated `useFindReplaceState.ts`.

5. **Commit 5 — Cleanup (if needed).** Inspect the migrated `useFindReplaceState.ts` for residual cruft: stale comments referencing `searchAbortRef`, unused imports, etc. Tidy. If nothing needs tidying, omit this commit; the order matters, not the count.

**This phase's tests are characterization tests — they pin behaviour the source change must preserve. They are not red-then-green tests in the strict sense, since the pre-migration code already satisfies them.** The commit ordering preserves the discipline (no source change without prior test); it does not pretend the test commits go red against the current source. Splitting commits this way keeps the diff scannable: the test commits prove the behaviour is pinned before the source change, and the migration commit isolates the source change from any test additions.

**One PR, one refactor.** Per CLAUDE.md §Pull Request Scope:
- One file's worth of migration only. Do not bundle 4b.3a.3 (`useTrashManager`) or 4b.3a.4 (`ImageGallery`) — they are independent migrations and live in their own PRs.
- No unrelated cleanup. If a tangential issue surfaces (e.g., a comment in `closePanel` reads stale after migration), fix it inside the migration commit if it's caused by the migration; otherwise file a follow-up.
- The structural-check extension lands in this PR because it's the test that proves the migration; it is not a separate refactor.

**Branch.** Working branch `find-replace-abort-migration` (already created off `main`). Merge handled by Ovid post-PR-approval; the implementation plan does not push or merge.

## Risks & mitigations

- **"Characterization tests don't go red against current code."** New tests #1, #2 and the §3a assertion tightenings all pass green against the pre-migration source — that's the *expected* shape for a migration characterization test. New test #3 is the only test framed against the new success-path gate; it also passes against current code via the staleness path. This is **not** a TDD-violation flag for the reviewer. Call it out in the PR description so the reviewer doesn't read the green-green-green commit sequence as cargo-culted RED-GREEN-REFACTOR steps.

- **`mockFind.mock.calls[N][3]` signal capture is index-fragile.** If a future test reorders the args of `api.search.find`, the index breaks silently. Mitigate by extracting a small test helper (`captureSignal(callIndex = 0)`) inline at the top of the new tests block — trivial to colocate, and a single point of update if the API arg order ever changes. Function-scoped, no separate file.

- **Belt-and-suspenders gates may be deleted later as "redundant."** A future maintainer reads the success-path `if (signal.aborted) return` and sees the immediately-following `if (!token.isStale()) setLoading(false)` and concludes the staleness check covers the abort. They would be right *for the abort paths that exist today* and wrong about the contract the gate documents. Mitigate with a one-line code comment at each new gate explaining the design intent: belt-and-suspenders against a future code path that calls `op.abort()` without bumping the seq, plus future-proofing against `mapApiError`'s ABORTED handling changing.

- **Signal identity across `op.run` boundary.** The `signal` returned by `op.run()` must be the same object passed to `fn`, so the post-await gate reads the same abort state the network sees. Already covered by the prerequisite hook's behavioural-contract bullet #2 (signal identity) and its corresponding unit test. New test #1 indirectly re-pins it (the signal we capture is the one whose abort state we assert on).

- **`closePanel` side-effect ordering.** `closePanel` performs ~7 actions in a specific order: state clears → `searchSeq.abort()` → `op.abort()` (was `searchAbortRef.current?.abort()`) → `clearTimeout(debounceRef.current)`. The migration is a 1:1 swap of one statement. If the order is preserved, no behaviour change. Pin it implicitly via the existing `closePanel cancels a pending debounce timer` and `closePanel clears stale result state` tests — both still pass after migration if and only if the ordering is preserved.

- **Coverage regression on a branch the migration accidentally simplifies away.** The empty-query early-bail at line 195 (`searchAbortRef.current = null`) is removed in row 9. That line is currently covered by the `search() with empty query clears results and error` test; after migration, the test still passes (the line is gone). The branch coverage of the `if (!query)` arm itself is unaffected. Verify via `make cover`'s post-migration report.

## Definition of Done

- `packages/client/src/hooks/useFindReplaceState.ts` no longer contains `useRef<AbortController>`; the only abort primitive is `useAbortableAsyncOperation`. Verified by the structural check in `migrationStructuralCheck.test.ts`.
- The new `useAbortableAsyncOperation` hook is allocated alongside the existing `useAbortableSequence`; both coexist on the `search` operation per CLAUDE.md §Save-pipeline invariants rule 4.
- Two new `if (signal.aborted) return` gates land in `search()`: one on the success path between `await` and the first setState, one as the first statement of the catch block before `mapApiError`. Both carry an explanatory code comment per the risk-mitigation note above.
- All existing tests in `__tests__/useFindReplaceState.test.ts` continue to pass. One existing test gains a `signal.aborted` assertion per §Test plan (`clears loading on project-change reset`).
- Four new tests added to `__tests__/useFindReplaceState.test.ts`: abort-prior on rapid re-call, auto-abort on unmount, success-path gate suppression, and closePanel-aborts-in-flight signal.
- `migrationStructuralCheck.test.ts` extended with two assertions (import-presence, no-raw-useRef) for `useFindReplaceState.ts`.
- `make all` green at PR close (lint, format, typecheck, coverage, e2e — e2e shouldn't change).
- Coverage on `useFindReplaceState.ts` holds at or above CLAUDE.md §Testing Philosophy thresholds (95/85/90/95).
- Zero test warnings.
- No user-visible behaviour change. No `CLAUDE.md` change required (rule 4 already documents `useFindReplaceState.search` as the canonical example of the `useAbortableSequence` + `useAbortableAsyncOperation` pairing).
- The PR commit sequence honors the §Migration order ordering. Branch (`find-replace-abort-migration`) ready for Ovid's handling at merge time.

## Out of scope (explicit)

- **Migrating the `useAbortableSequence` pairing.** Both hooks coexist on this operation by design. The token-isStale checks stay where they are.
- **Touching `closePanel`'s debounce-clear, `setLoading(false)`, or `searchSeq.abort()` logic.** Only the `searchAbortRef`-related lines are in scope.
- **Other consumers of `useAbortableAsyncOperation`** — those land in 4b.3a.3 (`useTrashManager`) and 4b.3a.4 (`ImageGallery`).
- **Global "no `useRef<AbortController>` in `packages/client/src`" ban.** Out of scope until 4b.3a.3 and 4b.3a.4 also land. The per-file check this phase ships is the local enforcement; whichever migration phase lands last can collapse to a global ban.
- **CLAUDE.md edits.** The text under §Save-pipeline invariants rule 4 already documents the pairing pattern and explicitly cites `useFindReplaceState.search`; no edit is required.
- **Lint enforcement** of "no hand-rolled `useRef<AbortController>` outside the hook." Deferred per the prerequisite design.
- **`Editor.tsx` paste/drop image upload, the remaining ~8 client `AbortController` sites** — out of scope here; covered by Phase 4b.3b's per-site evaluation.

## Dependencies

- **Phase 4b.3a.1** — the `useAbortableAsyncOperation` hook must exist. Already shipped.
- **Independent of Phase 4b.3a.3 and 4b.3a.4.** May land in any order relative to those.
- **Does not block any downstream phase.** Phase 4b.3b's per-site evaluation depends on the hook existing (4b.3a.1), not on this consumer migration.
