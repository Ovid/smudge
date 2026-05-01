# Phase 4b.3a.2: Find/Replace Abort Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `useFindReplaceState.search` from a hand-rolled `useRef<AbortController>` + cleanup-effect pattern to a single `useAbortableAsyncOperation` instance, preserving the existing `useAbortableSequence` pairing, with no user-visible behaviour change.

**Architecture:** `useFindReplaceState` continues to compose `useAbortableSequence` for response-staleness arbitration; a new `useAbortableAsyncOperation` instance is added side-by-side for network cancellation. Both hooks coexist on the `search` operation per CLAUDE.md §Save-pipeline invariants rule 4. Two new `if (signal.aborted) return` gates land in `search()` on the success path and at the top of the catch (before `mapApiError`) per the design's belt-and-suspenders decision.

**Tech Stack:** TypeScript, React 18, Vitest + `@testing-library/react`, vi mocks. Hooks live in `packages/client/src/hooks/`; tests in `packages/client/src/__tests__/`.

**Source design:** `docs/plans/2026-05-01-find-replace-abort-migration-design.md`

**Working branch:** `find-replace-abort-migration` (already created off `main`).

---

## File Structure

Files modified by this plan:

- `packages/client/src/hooks/useFindReplaceState.ts` — source migration (Task 3)
- `packages/client/src/__tests__/useFindReplaceState.test.ts` — extended with `captureSignal` helper, signal.aborted assertion on one existing test, four new tests (Tasks 1, 2)
- `packages/client/src/__tests__/migrationStructuralCheck.test.ts` — extended with two new assertions for the migrated file (Task 4)

Files NOT modified (referenced for shape/import only):

- `packages/client/src/hooks/useAbortableAsyncOperation.ts` — the hook to migrate to; shipped in Phase 4b.3a.1
- `packages/client/src/hooks/useAbortableSequence.ts` — companion hook; stays in place
- `packages/client/src/api/client.ts` — `api.search.find` signature: `(slug, query, options, signal)` — signal is the 4th positional arg
- `CLAUDE.md` — no edit required; rule 4 already documents the pairing

---

## Plan-vs-Design Notes

Two small divergences from the source design surfaced during plan-writing. Each is here for the alignment review to consider:

**[D1] §3a closePanel tightening dropped, replaced with a 4th new test.** The design's §3a row for `closePanel clears stale result state` proposes asserting `signal.aborted === true` on the captured signal after `closePanel()`. The existing test resolves the fetch via `mockFind.mockResolvedValue(...)` *before* `closePanel()` runs; the pre-migration `search()` finally-block clears `searchAbortRef.current` after a successful fetch (current code lines 256–259), so when `closePanel()` runs the ref is null and the captured signal is NOT aborted pre-migration. The assertion would fail pre-migration → contradicts the characterization-test framing. **Resolution in this plan:** drop the §3a closePanel tightening; add a 4th pure-new test (`closePanel aborts an in-flight search signal`) using a never-resolving mock. Net effect: +1 new test (4 instead of 3); the closePanel abort behaviour is still pinned, just by a different test shape. The §3a project-change tightening still applies as designed (its existing test uses a manually-controlled promise that genuinely is in-flight at the project-change moment).

**[D2] Preserve abort-on-empty-query behaviour with explicit op.abort() call.** The design's §Behaviour mapping row 5 says the line-193 `searchAbortRef.current?.abort()` is "Removed (the abort-prior is now done by op.run() itself)." This is true for the non-empty-query path. For the empty-query path, op.run() never fires (the `if (!query)` early-returns before allocation), so removing the line-193 abort means a prior in-flight search is no longer aborted when the user clears the query. This is a small behavioural regression in a defensive code path. **Resolution in this plan:** call `op.abort()` at the top of the empty-query branch to preserve the pre-migration behaviour. The call is cheap (no-op if no controller is tracked) and faithful to the design intent.

---

## Task 1: Commit 1 — Characterization tests for the abort-prior contract

**Files:**

- Modify: `packages/client/src/__tests__/useFindReplaceState.test.ts`

This task adds the `captureSignal` test helper, three new tests (#1 abort-prior, #2 unmount-aborts, #4 closePanel-aborts-in-flight per [D1]), and tightens one existing test with a `signal.aborted` assertion. All tests pass green against the current (pre-migration) source code — these are characterization tests pinning behaviour the migration must preserve.

**Design references:** §Test plan §3a (project-change tightening), §3b items 1 and 2 (new tests), §Risks "mockFind.mock.calls[N][3] is index-fragile" (helper rationale), pushback [3] (typing decision), Plan-vs-Design Note [D1] (closePanel new test).

- [ ] **Step 1: Add the captureSignal helper above the describe block**

Open `packages/client/src/__tests__/useFindReplaceState.test.ts`. Locate the line `describe("useFindReplaceState", () => {` (around line 38). Insert the helper immediately above it:

```ts
/**
 * Captures the AbortSignal passed to `api.search.find` at the given call
 * index. The 4th positional argument of `api.search.find` is the signal
 * (see packages/client/src/api/client.ts). Centralising the index here
 * absorbs the index-fragility risk noted in the design's §Risks: a future
 * arg-order change to api.search.find is a one-line fix here, not N tests
 * deep.
 */
function captureSignal(callIndex = 0): AbortSignal {
  return mockFind.mock.calls[callIndex][3] as AbortSignal;
}
```

- [ ] **Step 2: Run lint to determine the typing approach (per pushback [3])**

Run: `make lint`

If lint passes: keep the inline `as AbortSignal` cast as written.

If lint fails on a `no-unsafe-type-assertion`-style rule for the cast: change the existing mock declaration at the top of the file from

```ts
const mockFind = api.search.find as ReturnType<typeof vi.fn>;
```

to

```ts
const mockFind = api.search.find as unknown as ReturnType<typeof vi.fn<typeof api.search.find>>;
```

and rewrite the helper as `return mockFind.mock.calls[callIndex][3];` (no cast — TypeScript infers it from the typed mock).

- [ ] **Step 3: Add new test #1 — abort-prior on rapid re-call**

Append this test inside the `describe("useFindReplaceState", () => { ... })` block, before the trailing `// (Migration structural check moved to migrationStructuralCheck.test.ts — S2.)` comment:

```ts
it("search() aborts the prior in-flight signal when called again rapidly", async () => {
  // Pin the abort-prior contract that op.run() provides post-migration
  // (and that searchAbortRef.current?.abort() provides today). Issue
  // search1 against a manually-controlled promise; capture signal1.
  // Issue search2 against a never-resolving promise; capture signal2.
  // Assert signal1 is aborted, signal2 is not.
  let resolveFirst: (v: SearchResult) => void = () => {};
  mockFind.mockImplementationOnce(
    () =>
      new Promise<SearchResult>((resolve) => {
        resolveFirst = resolve;
      }),
  );
  mockFind.mockImplementationOnce(() => new Promise<SearchResult>(() => {}));

  const { result } = renderHook(() => useFindReplaceState("my-project"));

  act(() => {
    result.current.setQuery("first");
  });
  await act(async () => {
    void result.current.search("my-project");
    await Promise.resolve();
  });
  expect(mockFind).toHaveBeenCalledTimes(1);

  act(() => {
    result.current.setQuery("second");
  });
  await act(async () => {
    void result.current.search("my-project");
    await Promise.resolve();
  });
  expect(mockFind).toHaveBeenCalledTimes(2);

  expect(captureSignal(0).aborted).toBe(true);
  expect(captureSignal(1).aborted).toBe(false);

  // Allow the orphaned first promise to resolve without affecting state.
  resolveFirst({ total_count: 0, chapters: [] });
  await act(async () => {
    await Promise.resolve();
  });
});
```

- [ ] **Step 4: Run new test #1 in isolation**

Run: `npm test -w packages/client -- useFindReplaceState.test.ts -t "aborts the prior in-flight signal"`

Expected: PASS. The current code's `searchAbortRef.current?.abort()` at line 193 of `useFindReplaceState.ts` already provides this behaviour.

- [ ] **Step 5: Add new test #2 — auto-abort on hook unmount**

Append this test inside the `describe` block:

```ts
it("search() in-flight signal aborts on hook unmount", async () => {
  // Pin the auto-abort-on-unmount contract. The unmount cleanup effect
  // at lines 99–104 of useFindReplaceState (current) provides this; the
  // hook's auto-abort provides it post-migration. Either way, an in-
  // flight search's signal must read aborted === true after unmount.
  mockFind.mockImplementationOnce(() => new Promise<SearchResult>(() => {}));

  const { result, unmount } = renderHook(() => useFindReplaceState("my-project"));

  act(() => {
    result.current.setQuery("hello");
  });
  await act(async () => {
    void result.current.search("my-project");
    await Promise.resolve();
  });
  expect(mockFind).toHaveBeenCalledTimes(1);

  const signal = captureSignal(0);
  expect(signal.aborted).toBe(false);

  unmount();
  expect(signal.aborted).toBe(true);
});
```

- [ ] **Step 6: Run new test #2 in isolation**

Run: `npm test -w packages/client -- useFindReplaceState.test.ts -t "in-flight signal aborts on hook unmount"`

Expected: PASS.

- [ ] **Step 7: Add new test #4 — closePanel aborts an in-flight search signal (per [D1])**

Append this test inside the `describe` block:

```ts
it("closePanel aborts an in-flight search signal", async () => {
  // Pin the closePanel abort behaviour. Use a never-resolving mock so a
  // search is genuinely in flight at closePanel time. Pre-migration:
  // closePanel calls searchAbortRef.current?.abort() which aborts the
  // controller. Post-migration: closePanel calls op.abort() which does
  // the same.
  //
  // This test was added during plan-writing because the design's §3a
  // tightening of "closePanel clears stale result state" was infeasible
  // — that test resolves the fetch via mockResolvedValue before
  // closePanel runs, and the pre-migration finally-block clears the
  // searchAbortRef on success. The captured signal is therefore NOT
  // aborted pre-migration in that test, contradicting the
  // characterization framing. Plan-vs-Design Note [D1] documents the
  // tradeoff.
  mockFind.mockImplementationOnce(() => new Promise<SearchResult>(() => {}));

  const { result } = renderHook(() => useFindReplaceState("my-project"));

  act(() => {
    result.current.togglePanel();
    result.current.setQuery("foo");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(mockFind).toHaveBeenCalledTimes(1);

  const signal = captureSignal(0);
  expect(signal.aborted).toBe(false);

  act(() => {
    result.current.closePanel();
  });
  expect(signal.aborted).toBe(true);
});
```

- [ ] **Step 8: Run new test #4 in isolation**

Run: `npm test -w packages/client -- useFindReplaceState.test.ts -t "closePanel aborts an in-flight search signal"`

Expected: PASS.

- [ ] **Step 9: Tighten the existing "clears loading on project-change reset" test with a signal.aborted assertion**

Locate the existing test (currently the last test before the trailing comment, around line 644):

```ts
it("clears loading on project-change reset so the new panel is not stuck 'Searching…' (I2)", async () => {
```

Modify the test by capturing the in-flight signal before the rerender and asserting both pre- and post-rerender states. The full updated test:

```ts
it("clears loading on project-change reset so the new panel is not stuck 'Searching…' (I2)", async () => {
  // Before I2 the project-change reset bumped searchSeqRef and aborted
  // the controller but did not clear `loading`. The in-flight search's
  // finally only clears loading when seq === current — after the bump
  // the check fails and loading stays true forever. closePanel sidesteps
  // this by clearing loading explicitly, so the bug only manifested when
  // navigating projects with the panel open.
  let resolveFind: (v: { total_count: number; chapters: [] }) => void = () => {};
  mockFind.mockImplementationOnce(
    () =>
      new Promise<{ total_count: number; chapters: [] }>((resolve) => {
        resolveFind = resolve;
      }),
  );

  const { result, rerender } = renderHook(
    ({ slug, id }: { slug: string; id: string }) => useFindReplaceState(slug, id),
    { initialProps: { slug: "first", id: "proj-1" } },
  );

  act(() => {
    result.current.togglePanel();
    result.current.setQuery("hello");
  });
  // Let the 300ms debounce fire so the search starts and loading flips.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(result.current.loading).toBe(true);
  // ADDED for Phase 4b.3a.2: capture the in-flight signal so we can
  // pin that the project-change reset aborts it (current code:
  // searchAbortRef.current?.abort(); post-migration: op.abort()).
  const signal = captureSignal(0);
  expect(signal.aborted).toBe(false);

  // Navigate to a different project with the panel still open and a
  // search in flight.
  rerender({ slug: "second", id: "proj-2" });

  expect(result.current.loading).toBe(false);
  // ADDED for Phase 4b.3a.2: pin that the in-flight signal was aborted
  // by the project-change reset.
  expect(signal.aborted).toBe(true);

  // Resolve the now-orphaned response — it must not flip loading back.
  resolveFind({ total_count: 0, chapters: [] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(result.current.loading).toBe(false);
});
```

- [ ] **Step 10: Run the full useFindReplaceState test file**

Run: `npm test -w packages/client -- useFindReplaceState.test.ts`

Expected: all tests pass (the existing 19 + 3 new + 1 tightened = 23 tests).

- [ ] **Step 11: Run the full client test suite to confirm no cross-file regressions**

Run: `npm test -w packages/client`

Expected: all pass.

- [ ] **Step 12: Run lint and typecheck**

Run: `make lint`

Expected: PASS. If the typing-decision lint check from Step 2 surfaced an issue and was switched to typed mock, verify it stays clean.

- [ ] **Step 13: Commit**

```bash
git add packages/client/src/__tests__/useFindReplaceState.test.ts
git commit -m "$(cat <<'EOF'
test(find-replace): characterization tests for abort-prior contract (4b.3a.2)

Adds captureSignal helper, three new tests (#1 abort-prior on rapid
re-call, #2 auto-abort on unmount, #4 closePanel aborts in-flight
signal), and tightens one existing test (project-change reset) with a
signal.aborted assertion. All tests pass green against current code —
these are characterization tests pinning behaviour the upcoming
migration to useAbortableAsyncOperation must preserve.

Test #4 replaces the design's §3a closePanel tightening, which was
infeasible against the existing "clears stale result state" test (the
existing test resolves the fetch before closePanel; the pre-migration
finally-block nulls the controller ref on success, so the captured
signal would NOT be aborted pre-migration — the design's tightening
would have failed). Plan-vs-Design Note [D1] documents the tradeoff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Commit 2 — Characterization test for the new success-path gate

**Files:**

- Modify: `packages/client/src/__tests__/useFindReplaceState.test.ts`

This task adds new test #3 (the success-path gate suppression test). Per the design's §3b item 3 limitation note, this test pins the *combined* behaviour (`signal.aborted` OR `token.isStale()` suppresses the success-path setState); it cannot in isolation distinguish which gate fires. The code comment at the gate (per §Risks) is the design-time enforcement.

**Design references:** §Test plan §3b item 3 (with limitation acknowledgment).

- [ ] **Step 1: Add new test #3 — success-path gate suppression**

Append this test inside the `describe("useFindReplaceState", () => { ... })` block, after the tests added in Task 1:

```ts
it("search() success-path setState is suppressed when the signal aborts between await and the next line", async () => {
  // Pin that the success-path setResults is suppressed when the prior
  // search is aborted. LIMITATION (per design §Test plan §3b item 3):
  // the migrated code has TWO gates between await and setResults
  // (signal.aborted then token.isStale). Both fire when closePanel
  // bumps the seq AND aborts op. This test cannot tell which gate did
  // the suppression — it pins the combined behaviour. Pinning the
  // gates in isolation would require contrived production-impossible
  // state and is explicitly out of scope.
  let resolveFind: (v: SearchResult) => void = () => {};
  mockFind.mockImplementationOnce(
    () =>
      new Promise<SearchResult>((resolve) => {
        resolveFind = resolve;
      }),
  );

  const { result } = renderHook(() => useFindReplaceState("my-project"));

  act(() => {
    result.current.togglePanel();
    result.current.setQuery("hello");
  });
  // Let the 300ms debounce fire so the search starts and loading flips.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(result.current.loading).toBe(true);
  expect(result.current.results).toBeNull();

  // Close the panel before the search resolves. closePanel bumps
  // searchSeq (causing token.isStale() to return true) AND, post-
  // migration, aborts op (causing signal.aborted to be true). Both
  // gates would fire in the await-to-setResults gap.
  act(() => {
    result.current.closePanel();
  });

  // Resolve the now-orphaned response.
  await act(async () => {
    resolveFind({ total_count: 5, chapters: [{ id: "c1", title: "Ch 1", matches: [] }] });
    await Promise.resolve();
  });

  // The success-path setResults must NOT have fired despite the
  // resolved response — both the signal.aborted and token.isStale
  // gates would suppress it (the test does not differentiate which).
  expect(result.current.results).toBeNull();
});
```

- [ ] **Step 2: Run new test #3 in isolation**

Run: `npm test -w packages/client -- useFindReplaceState.test.ts -t "success-path setState is suppressed"`

Expected: PASS. The current code's `if (token.isStale()) return` after `await api.search.find(...)` already provides this suppression via the staleness path; closePanel bumps the seq through `searchSeq.abort()`.

- [ ] **Step 3: Run the full client test suite**

Run: `npm test -w packages/client`

Expected: all pass.

- [ ] **Step 4: Run lint**

Run: `make lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/__tests__/useFindReplaceState.test.ts
git commit -m "$(cat <<'EOF'
test(find-replace): characterization test for success-path gate suppression (4b.3a.2)

Adds new test #3 pinning that search()'s success-path setResults is
suppressed when the prior search is aborted (via closePanel between
await and the next line). Per design §3b item 3 limitation: the
migrated code has two gates (signal.aborted, token.isStale) and this
test pins the combined behaviour, not gate-isolation — production
abort paths bump both. The code comment at the new signal.aborted
gate (added in the upcoming migration commit) is the design-time
enforcement of that gate's intent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Commit 3 — Migration source

**Files:**

- Modify: `packages/client/src/hooks/useFindReplaceState.ts`

This task applies the row-by-row replacement from the design's §Behaviour mapping. Each step cites the row(s) it implements. After this task, no `useRef<AbortController>` survives in `useFindReplaceState.ts`.

**Design references:** §Behaviour mapping rows 1–9, §Row-7 placement detail, §Risks "closePanel side-effect ordering" (preserve order). Plan-vs-Design Note [D2] (preserve abort-on-empty-query).

- [ ] **Step 1: Add the useAbortableAsyncOperation import (row 1, first part)**

Open `packages/client/src/hooks/useFindReplaceState.ts`. Locate the existing `useAbortableSequence` import (line 5). Add the new import on the next line:

```ts
// Before (line 5):
import { useAbortableSequence } from "./useAbortableSequence";

// After:
import { useAbortableSequence } from "./useAbortableSequence";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
```

The `useRef` import on line 1 STAYS — four other refs (`debounceRef`, `latestSlugRef`, `panelOpenRef`, `latestProjectIdRef`) still need it.

- [ ] **Step 2: Allocate the op hook and remove the searchAbortRef declaration (row 1, second part)**

Locate the `searchSeq` allocation and the `searchAbortRef` declaration that follows it (currently lines 74–78). Replace with:

```ts
// Before (lines 74–78):
const searchSeq = useAbortableSequence();
// Owned by the latest in-flight search() call. Aborting releases the
// HTTP connection and stops the server-side regex walk; the sequence
// token still protects us from late resolutions writing state back.
const searchAbortRef = useRef<AbortController | null>(null);

// After:
const searchSeq = useAbortableSequence();
// Network-cancellation primitive (CLAUDE.md §Save-pipeline invariants
// rule 4). Coexists with searchSeq on this operation: searchSeq
// arbitrates response staleness via epoch tokens; op cancels in-flight
// network requests via AbortController. Both are needed; neither
// subsumes the other.
const op = useAbortableAsyncOperation();
```

- [ ] **Step 3: Remove the unmount cleanup effect (row 2)**

Locate and DELETE the entire useEffect block at lines 97–104 (the "On unmount, abort any in-flight search" comment plus the effect):

```ts
// On unmount, abort any in-flight search so the server stops walking
// chapters for a caller that no longer exists.
useEffect(() => {
  return () => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
  };
}, []);
```

This effect is fully subsumed by the new hook's auto-abort on unmount (see `useAbortableAsyncOperation.ts` lines 24–36).

- [ ] **Step 4: Replace project-change cleanup with op.abort() (row 3)**

Locate the project-change reset useEffect (currently around lines 107–133). The block to change is the trailing two lines inside the `if (latestProjectIdRef.current !== projectId)` branch:

```ts
// Before (inside the branch):
searchSeq.abort();
// Abort any in-flight search so the server stops walking a project
// the user has left. The sequence abort prevents the response from
// writing state back, but without this the server keeps scanning.
searchAbortRef.current?.abort();
searchAbortRef.current = null;

// After:
searchSeq.abort();
// Abort any in-flight search so the server stops walking a project
// the user has left. The sequence abort prevents the response from
// writing state back, but without op.abort() the server keeps scanning.
op.abort();
```

Add `op` to the effect's dependency array:

```ts
// Before:
}, [projectId, searchSeq]);

// After:
}, [projectId, searchSeq, op]);
```

- [ ] **Step 5: Replace closePanel abort with op.abort() — preserve side-effect ordering (row 4, §Risks)**

Locate the `closePanel` useCallback. The block to change:

```ts
// Before:
// Invalidate any still-in-flight response so a late reply can't
// write results back after the panel was explicitly closed.
searchSeq.abort();
// Abort the underlying fetch too so the server stops walking chapters
// for a search the user has clearly moved on from.
searchAbortRef.current?.abort();
searchAbortRef.current = null;
// Clear any pending debounced search; if the panel closes inside the
// 300ms debounce window, the timer would otherwise fire search(slug)
// after the panel was closed — starting a new sequence and writing a
// stale result set pinned to the pre-close query/options, visible on
// reopen.
if (debounceRef.current) {
  clearTimeout(debounceRef.current);
  debounceRef.current = null;
}

// After:
// Invalidate any still-in-flight response so a late reply can't
// write results back after the panel was explicitly closed.
searchSeq.abort();
// Abort the underlying fetch too so the server stops walking chapters
// for a search the user has clearly moved on from.
op.abort();
// Clear any pending debounced search; if the panel closes inside the
// 300ms debounce window, the timer would otherwise fire search(slug)
// after the panel was closed — starting a new sequence and writing a
// stale result set pinned to the pre-close query/options, visible on
// reopen.
if (debounceRef.current) {
  clearTimeout(debounceRef.current);
  debounceRef.current = null;
}
```

**Verify the ordering is preserved per §Risks "closePanel side-effect ordering":** state clears (panelOpenRef → setPanelOpen → setResults → setResultsQuery → setResultsOptions → setError → setLoading) → `searchSeq.abort()` → `op.abort()` (was `searchAbortRef.current?.abort()`) → `clearTimeout(debounceRef.current)`. The 1:1 swap of `searchAbortRef.current?.abort()` → `op.abort()` must NOT change the relative position of any other action.

Add `op` to the closePanel dependency array:

```ts
// Before:
}, [searchSeq]);

// After:
}, [searchSeq, op]);
```

- [ ] **Step 6: Replace the search() function body (rows 5, 6, 7, 8, 9 + [D2])**

Locate the `search` useCallback (currently lines 185–264). Replace the entire `useCallback` with:

```ts
const search = useCallback(
  async (slug: string) => {
    // Always bump the sequence so any still-in-flight response for a
    // prior query is discarded rather than overwriting cleared state.
    const token = searchSeq.start();
    if (!query) {
      // Per Plan-vs-Design Note [D2]: explicitly abort any in-flight
      // prior search when the user clears the query, preserving the
      // pre-migration line-193 abort-prior behaviour. op.run() handles
      // abort-prior in the non-empty branch, but never fires here, so
      // the abort would otherwise be lost in this defensive path.
      // Cheap when no controller is tracked.
      op.abort();
      setResults(null);
      setResultsQuery(null);
      setResultsOptions(null);
      setError(null);
      setLoading(false);
      return;
    }
    // Snapshot the query/options as-of the request so replace operations
    // use the exact search context that produced the current results
    // (the user may be typing while waiting for the response).
    // `replacement` is intentionally NOT frozen: it does not affect the
    // result set, and freezing it here would either re-fire searches on
    // every keystroke in the replace input or leave it stale relative to
    // what the user sees.
    const frozenQuery = query;
    const frozenOptions: SearchOptionsShape = { ...options };
    setLoading(true);
    setError(null);
    // op.run() aborts any prior controller, allocates a fresh one, and
    // returns the per-call signal. The signal is captured here for the
    // belt-and-suspenders gates below.
    const { promise, signal } = op.run((s) =>
      api.search.find(slug, frozenQuery, frozenOptions, s),
    );
    try {
      const result = await promise;
      // Belt-and-suspenders against (a) a future code path that calls
      // op.abort() without bumping searchSeq, and (b) mapApiError's
      // ABORTED handling ever changing. The token.isStale() check below
      // also catches every abort path that exists today; this gate
      // locally documents the per-call signal contract per CLAUDE.md
      // §Save-pipeline invariants rule 4. Do NOT delete as "redundant"
      // — see Phase 4b.3a.2 design §Risks for the rationale.
      if (signal.aborted) return;
      if (token.isStale()) return;
      setResults(result);
      setResultsQuery(frozenQuery);
      setResultsOptions(frozenOptions);
    } catch (err) {
      // See success-path comment above. Placed before mapApiError so an
      // aborted network error bypasses error mapping entirely —
      // mapApiError's ABORTED-message-null path is the unified contract
      // today, but this gate insulates useFindReplaceState from any
      // future change to that contract.
      if (signal.aborted) return;
      if (token.isStale()) return;
      const { message } = mapApiError(err, "findReplace.search");
      if (message === null) {
        // Aborted: no banner, no state changes.
        return;
      }
      if (isApiError(err) && (err.status === 400 || err.status === 404 || err.status === 413)) {
        // 400s mean the CURRENT query is invalid; stale results no
        // longer correspond to anything the user typed.
        // 404s mean the project (or scope) has gone away — the prior
        // results are pinned to a slug/chapter that no longer resolves
        // and can't be acted on. Clear so the panel is consistent with
        // the error.
        // 413 (I4, review 2026-04-21): the query itself exceeded the
        // server's body-size cap and will keep being rejected until
        // the user changes the query — not transient. Keeping stale
        // results alongside the contentTooLarge banner lets Replace
        // act on matches the server has already said it cannot
        // process.
        setError(message);
        setResults(null);
        setResultsQuery(null);
        setResultsOptions(null);
      } else {
        // Network / 5xx / unknown: the prior successful results are
        // still valid for resultsQuery. Show the error banner but
        // preserve the result set so a transient blip doesn't wipe
        // content the user is actively reading.
        setError(message);
      }
    } finally {
      if (!token.isStale()) {
        setLoading(false);
      }
    }
  },
  [query, options, searchSeq, op],
);
```

Note that `op` is added to the dependency array.

- [ ] **Step 7: Run the full useFindReplaceState test file to confirm all tests pass post-migration**

Run: `npm test -w packages/client -- useFindReplaceState.test.ts`

Expected: all tests pass (the existing 19 + 4 new + 1 tightened from Tasks 1+2 = 24 tests).

- [ ] **Step 8: Run the full client test suite to confirm no cross-file regressions**

Run: `npm test -w packages/client`

Expected: all pass.

- [ ] **Step 9: Run typecheck**

Run: `make lint` (which runs typecheck + eslint together in this repo) or, if you want typecheck alone: `npx tsc -p packages/client --noEmit`

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/client/src/hooks/useFindReplaceState.ts
git commit -m "$(cat <<'EOF'
refactor(find-replace): migrate searchAbortRef to useAbortableAsyncOperation (4b.3a.2)

Migrates useFindReplaceState.search from a hand-rolled
useRef<AbortController> to a single useAbortableAsyncOperation
instance allocated alongside the existing useAbortableSequence. Both
hooks coexist on this operation per CLAUDE.md §Save-pipeline
invariants rule 4: searchSeq arbitrates response staleness via epoch
tokens, op cancels in-flight network requests via AbortController.

Per the design's belt-and-suspenders decision, two new
`if (signal.aborted) return` gates land in search() — one on the
success path between await and the first setState, one as the first
statement of the catch block before mapApiError. The token.isStale()
checks remain in place after both gates as response-staleness
arbitration.

Source touchpoints (per §Behaviour mapping table):
- searchAbortRef declaration → removed; op = useAbortableAsyncOperation()
- unmount cleanup effect → removed (subsumed by hook's auto-abort)
- project-change cleanup → op.abort()
- closePanel abort (ordering preserved) → op.abort()
- search() empty-query branch → explicit op.abort() preserves
  pre-migration abort-prior behaviour (Plan-vs-Design Note [D2])
- search() body allocation → op.run((s) => api.search.find(..., s))
- success-path: NEW signal.aborted gate (with code comment)
- catch-top: NEW signal.aborted gate (with code comment)
- finally controller-equality cleanup → removed (hook owns ref)

No user-visible behaviour change. The four characterization tests + one
tightening from Task 1 + Task 2's new test pin the contracts the
migration preserves.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Commit 4 — Structural check

**Files:**

- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts`

Add two new assertions mirroring the existing `useAbortableSequence` migration check (lines 76–90 of the file).

**Design references:** §Test plan §3c (Structural check).

- [ ] **Step 1: Add the two new assertions**

Open `packages/client/src/__tests__/migrationStructuralCheck.test.ts`. Locate the closing `});` of the `describe("client source-tree migration structural check", () => { ... })` block. Insert these two new tests immediately before it:

```ts
it("useAbortableAsyncOperation is imported by every file that has been migrated to it", () => {
  // Phase 4b.3a.2 (find-replace) is the first migration of this hook;
  // 4b.3a.3 (useTrashManager) and 4b.3a.4 (ImageGallery) will append
  // their migrated files to this list. Whichever phase lands last can
  // collapse this per-file check into a global ban.
  const migrated = [resolve(clientSrcRoot, "hooks/useFindReplaceState.ts")];
  for (const file of migrated) {
    const source = readFileSync(file, "utf-8");
    expect(source, `${file} should import useAbortableAsyncOperation`).toMatch(
      /useAbortableAsyncOperation/,
    );
  }
});

it("migrated files do not contain raw useRef<AbortController>", () => {
  // Companion to the import assertion above; whichever migration phase
  // lands last can convert this from a per-file check to a global
  // packages/client/src ban (excluding the hook file itself).
  const migrated = [resolve(clientSrcRoot, "hooks/useFindReplaceState.ts")];
  const pattern = /useRef\s*<\s*AbortController\s*(?:\|\s*null\s*)?>/;
  for (const file of migrated) {
    const source = readFileSync(file, "utf-8");
    expect(source, `${file} should not contain useRef<AbortController>`).not.toMatch(pattern);
  }
});
```

- [ ] **Step 2: Run the structural check test file**

Run: `npm test -w packages/client -- migrationStructuralCheck.test.ts`

Expected: 5 tests pass (the original 3 + 2 new).

- [ ] **Step 3: Run the full client test suite**

Run: `npm test -w packages/client`

Expected: all pass.

- [ ] **Step 4: Run lint**

Run: `make lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/__tests__/migrationStructuralCheck.test.ts
git commit -m "$(cat <<'EOF'
test(client): structural check pins useFindReplaceState migration to useAbortableAsyncOperation (4b.3a.2)

Adds two assertions mirroring the existing useAbortableSequence
migration check (lines 76–90 of migrationStructuralCheck.test.ts):
(1) useFindReplaceState.ts must import useAbortableAsyncOperation;
(2) useFindReplaceState.ts must NOT contain raw useRef<AbortController>.

Future migration phases (4b.3a.3 useTrashManager, 4b.3a.4 ImageGallery)
will append their migrated files to the same `migrated` arrays;
whichever phase lands last can collapse the per-file checks into a
global packages/client/src ban.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Commit 5 — Cleanup (if needed)

**Files:**

- Possibly modify: `packages/client/src/hooks/useFindReplaceState.ts`

This task is conditional. After the migration, inspect the source for residual cruft: stale comments referencing `searchAbortRef`, unused imports, etc. If nothing needs tidying, OMIT this commit — the order matters, not the count.

**Design references:** §Migration order Commit 5 (Cleanup, if needed).

- [ ] **Step 1: Search for any remaining occurrence of searchAbortRef in the migrated source**

Run: `grep -n searchAbortRef packages/client/src/hooks/useFindReplaceState.ts`

Expected: no output.

If any remains (most likely in a code comment that wasn't fully scrubbed during Task 3), edit it to remove the reference or update it to reflect the post-migration state.

- [ ] **Step 2: Verify no unused imports**

Run: `make lint`

Expected: PASS. If any unused-import warning appears, remove the offending import. (Note: `useRef` stays — it is used by `debounceRef`, `latestSlugRef`, `panelOpenRef`, `latestProjectIdRef`.)

- [ ] **Step 3: If any edits were made in Steps 1 or 2, commit; otherwise SKIP this task**

```bash
# Only run if Step 1 or 2 made changes:
git add packages/client/src/hooks/useFindReplaceState.ts
git commit -m "$(cat <<'EOF'
refactor(find-replace): tidy residual cruft post-migration (4b.3a.2)

Cleanup pass: stale comment references and/or unused imports left
behind by the searchAbortRef → useAbortableAsyncOperation migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no edits were needed, write a short note (not a commit): "No cleanup needed — Task 5 omitted."

---

## Task 6: Final verification

**Files:**

- (No file modifications)

This task runs the full CI pass and inspects coverage to confirm the migration meets all DoD criteria. No commits — verification only.

**Design references:** §Definition of Done.

- [ ] **Step 1: Run the full CI pass**

Run: `make all`

Expected: PASS (lint + format + typecheck + coverage + e2e all green). The e2e suite shouldn't change behaviour — if any e2e test fails, investigate before considering the migration done. Likely failures point to a behavioural regression in the migration source (Task 3) that the unit tests didn't catch.

- [ ] **Step 2: Inspect coverage for useFindReplaceState.ts**

Run: `make cover`

Inspect the coverage report (typically `packages/client/coverage/index.html` if HTML reporter is configured, or the terminal summary) for `packages/client/src/hooks/useFindReplaceState.ts`. Confirm all four metrics meet or exceed CLAUDE.md §Testing Philosophy thresholds:

- statements ≥ 95%
- branches ≥ 85%
- functions ≥ 90%
- lines ≥ 95%

If any metric regresses below threshold, identify the uncovered branch and add a targeted test rather than relax the threshold (per CLAUDE.md §Testing Philosophy: "the goal is always to increase coverage as much as possible … never simply adjust the thresholds downward").

- [ ] **Step 3: Confirm zero test warnings**

Re-run `make test` and scan stderr for `console.warn`/`console.error` output. There should be none. If any noisy output appears, identify the source — likely an unsuppressed warning in a test that triggers an error path. Per CLAUDE.md §Testing Philosophy, spy on the output and assert the expected message rather than letting it leak.

- [ ] **Step 4: Walk the Definition of Done checklist from the design**

Verify each bullet from the design's §Definition of Done is met:

- [ ] `useFindReplaceState.ts` no longer contains `useRef<AbortController>` (verify via Step 1 of Task 5's grep, or Task 4's structural check)
- [ ] `op = useAbortableAsyncOperation()` is allocated alongside `searchSeq` (Task 3 Step 2)
- [ ] Two new `if (signal.aborted) return` gates land in `search()` — one on the success path, one as the first statement of the catch (Task 3 Step 6)
- [ ] Both gates carry an explanatory code comment (Task 3 Step 6 — verified in the code block)
- [ ] All existing tests in `__tests__/useFindReplaceState.test.ts` continue to pass (Steps 1–2 above)
- [ ] One existing test gained `signal.aborted` assertion: project-change reset (Task 1 Step 9) — note: per [D1], the design's second tightening on closePanel was replaced with a 4th new test
- [ ] Four new tests added to `__tests__/useFindReplaceState.test.ts`: #1 abort-prior, #2 unmount, #3 success-path gate, #4 closePanel-aborts-in-flight (Tasks 1 & 2)
- [ ] `migrationStructuralCheck.test.ts` extended with two assertions (Task 4)
- [ ] `make all` green (Step 1 above)
- [ ] Coverage on `useFindReplaceState.ts` holds at or above 95/85/90/95 (Step 2 above)
- [ ] Zero test warnings (Step 3 above)
- [ ] No user-visible behaviour change (verified by all existing tests passing + e2e green)
- [ ] No `CLAUDE.md` change required (verified during /roadmap Step 7 — rule 4 already documents the pairing)

- [ ] **Step 5: Branch is ready for Ovid's PR-creation**

The working branch `find-replace-abort-migration` is ready. Ovid handles PR creation and merge per the design's §Migration order. The plan does NOT push, create a PR, or merge.

Final commit count: **4 or 5 commits** (Tasks 1, 2, 3, 4, plus optionally Task 5 if cleanup was needed).
