# Phase 4b.3d — Mapper Internals & CLAUDE.md Updates: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Phase 4b.3 follow-up backlog — two small refactors ([S13] extract `refreshTrashList`, [S14] hoist `chapterSeq.abort()` into `fetchSnapshots`) and a CLAUDE.md update that documents `applyMappedError` / `ScopeExtras<S>` / `committedCodes` as the canonical consumer pattern and acknowledges the prior-art bundling exceptions.

**Architecture:** TDD red/green/refactor at every code task; tests pin the contract before implementation lands. Code refactors are behaviour-preserving — characterization tests in `useTrashManager.test.ts` and `SnapshotPanel.test.tsx` continue to pass without modification. New direct unit test ships alongside the new `useTrashManager.refresh.ts` file.

**Tech Stack:** TypeScript, React 18, Vitest, React Testing Library, npm workspaces.

**Spec:** `docs/plans/2026-05-27-mapper-internals-claude-md-updates-design.md`. The decision log entry at `docs/roadmap-decisions/2026-05-27-phase-4b-3d-mapper-internals-claude-md-updates.md` will be written by /roadmap step 10 (not as a task here).

**PR scope rule:** This phase bundles two small refactors + docs in one PR under the bundling-exception clause; see CLAUDE.md §Pull Request Scope (the addition Task 5 makes), and the decision log entry for the exception rationale.

**Quality gates (all tasks):**
- `make all` green at end of plan.
- Coverage at or above CLAUDE.md §Testing Philosophy thresholds (95% statements, 85% branches, 90% functions, 95% lines).
- Zero test-output warnings (CLAUDE.md §Testing Philosophy zero-warnings rule).
- Per-task commits use Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).

---

## File Structure

**Create:**
- `packages/client/src/hooks/useTrashManager.refresh.ts` — helper file. Exports `refreshTrashList(project, projectRef, trashOp)` and the `RefreshTrashResult` discriminated-union type. ~50 lines.
- `packages/client/src/hooks/useTrashManager.refresh.test.ts` — direct unit test for the helper. Six test cases covering the 6 paths to the 4 return kinds. ~140 lines.

**Modify:**
- `packages/client/src/hooks/useTrashManager.ts` — `openTrash` (lines 105–132) and `confirmDeleteChapter`'s post-delete refresh (lines 357–386) become callers of `refreshTrashList`. Each loses ~25 lines of inlined fetch/abort/stale/error machinery.
- `packages/client/src/components/SnapshotPanel.tsx` — `fetchSnapshots` (lines 133–150) gains `chapterSeq.abort()` at its top; mount useEffect (lines 155–186) shrinks to ~5 lines (early-return + `void fetchSnapshots()` + cleanup).
- `packages/client/src/__tests__/SnapshotPanel.test.tsx` — add one component-level chapter-switch test asserting stale chapter-A response is discarded after switch to chapter B.
- `CLAUDE.md` — §Unified API error mapping paragraph expanded; §Pull Request Scope exception list grown to four entries; §Save-Pipeline Invariants Rule 4 verified unchanged.

**Do not touch:**
- `packages/client/src/hooks/useTrashManager.ts` other handlers (`handleRestore`, `confirmDeleteChapter`'s delete itself). Out of scope per design.
- `packages/client/src/errors/apiErrorMapper.ts`. The [S6] try/catch was dropped in pushback.
- The `SnapshotPanel` list-load/detail-load `useEffect` flows (these are different lifecycle shapes per the 4b.3a.4 design).

---

## Task 1: Extract `refreshTrashList` helper (RED → GREEN → COMMIT)

**Files:**
- Create: `packages/client/src/hooks/useTrashManager.refresh.ts`
- Create: `packages/client/src/hooks/useTrashManager.refresh.test.ts`

### Step 1.1: Write the failing test file

- [ ] Create `packages/client/src/hooks/useTrashManager.refresh.test.ts` with the test scaffold below. The import line will fail until step 1.3 lands.

```ts
import { describe, expect, it, vi } from "vitest";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { ApiRequestError } from "../errors";
import type { AbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { refreshTrashList } from "./useTrashManager.refresh";

function makeProject(id: string, slug: string): ProjectWithChapters {
  return {
    id,
    slug,
    title: `Project ${id}`,
    mode: "fiction",
    target_word_count: null,
    target_deadline: null,
    created_at: "2026-05-27T00:00:00.000Z",
    updated_at: "2026-05-27T00:00:00.000Z",
    chapters: [],
  };
}

function makeTrashOp(
  promise: Promise<Chapter[]>,
  signal: AbortSignal,
): AbortableAsyncOperation {
  return {
    run: vi.fn(() => ({ promise, signal })),
    abort: vi.fn(),
  };
}

describe("refreshTrashList", () => {
  it("returns { kind: 'ok', trashed } on success when project unchanged and signal not aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const trashed: Chapter[] = [];
    const controller = new AbortController();
    const trashOp = makeTrashOp(Promise.resolve(trashed), controller.signal);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "ok", trashed });
  });

  it("returns { kind: 'aborted' } on success when signal is aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const controller = new AbortController();
    controller.abort();
    const trashOp = makeTrashOp(Promise.resolve([]), controller.signal);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on success when projectRef has moved to a different project", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const controller = new AbortController();
    const promise = Promise.resolve([]).then((v) => {
      projectRef.current = projectB;
      return v;
    });
    const trashOp = makeTrashOp(promise, controller.signal);

    const result = await refreshTrashList(projectA, projectRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });

  it("returns { kind: 'error', mapped } on rejection when project unchanged and signal not aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const controller = new AbortController();
    const err = new ApiRequestError("Internal Server Error", 500, {
      code: "INTERNAL",
      message: "Internal Server Error",
    });
    const trashOp = makeTrashOp(Promise.reject(err), controller.signal);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("unreachable");
    expect(result.mapped.message).not.toBeNull();
  });

  it("returns { kind: 'aborted' } on rejection when signal is aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const controller = new AbortController();
    controller.abort();
    const trashOp = makeTrashOp(Promise.reject(new Error("network")), controller.signal);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on rejection when projectRef has moved", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const controller = new AbortController();
    const err = new ApiRequestError("Internal Server Error", 500, {
      code: "INTERNAL",
      message: "Internal Server Error",
    });
    const promise = Promise.reject(err).catch((e) => {
      projectRef.current = projectB;
      throw e;
    });
    const trashOp = makeTrashOp(promise, controller.signal);

    const result = await refreshTrashList(projectA, projectRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });
});
```

### Step 1.2: Run the test to confirm it fails (RED)

- [ ] Run: `npx vitest run packages/client/src/hooks/useTrashManager.refresh.test.ts -w packages/client`

Expected: 6 tests FAIL with `Cannot find module './useTrashManager.refresh'` (or similar import resolution error).

### Step 1.3: Write the helper

- [ ] Create `packages/client/src/hooks/useTrashManager.refresh.ts`:

```ts
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError } from "../errors";
import type { MappedError } from "../errors/apiErrorMapper";
import type { AbortableAsyncOperation } from "./useAbortableAsyncOperation";

export type RefreshTrashResult =
  | { kind: "ok"; trashed: Chapter[] }
  | { kind: "aborted" }
  | { kind: "stale" }
  | { kind: "error"; mapped: MappedError<"trash.load"> };

/**
 * Fetch the trash list for a project, applying the same I2 drift-guard +
 * abort + stale + error pipeline that openTrash and the confirmDeleteChapter
 * post-delete refresh need. Callers own their state writes; the helper owns
 * the pipeline.
 *
 * `projectRef.current` is captured at entry; if the user navigates to a
 * different project mid-flight, the return is `{ kind: "stale" }` so the
 * caller bails out cleanly.
 *
 * Pushback Issue 2 (2026-05-27): extracted to its own file so the unit
 * test imports it directly rather than threading through useTrashManager's
 * public surface.
 */
export async function refreshTrashList(
  project: ProjectWithChapters,
  projectRef: { readonly current: ProjectWithChapters | null },
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

### Step 1.4: Run the test to confirm it passes (GREEN)

- [ ] Run: `npx vitest run packages/client/src/hooks/useTrashManager.refresh.test.ts -w packages/client`

Expected: 6 tests PASS.

### Step 1.5: Commit

- [ ] Commit:

```bash
git add packages/client/src/hooks/useTrashManager.refresh.ts packages/client/src/hooks/useTrashManager.refresh.test.ts
git commit -m "$(cat <<'EOF'
feat(trash): extract refreshTrashList helper to its own file (4b.3d S13)

New file packages/client/src/hooks/useTrashManager.refresh.ts exports
the discriminated-union helper { kind: "ok" | "aborted" | "stale" |
"error" } that openTrash and confirmDeleteChapter's post-delete
refresh both need. Callers own their state writes; the helper owns
the I2 drift-guard + abort + stale + mapApiError("trash.load")
pipeline once.

Per pushback Issue 2 (docs/plans/2026-05-27-mapper-internals-claude-
md-updates-design.md), the helper is its own file so the direct
unit test can import it. Six tests cover the 6 paths to the 4
return kinds.

No caller migration yet — that's Tasks 2 and 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migrate `openTrash` to use the helper (REFACTOR → COMMIT)

**Files:**
- Modify: `packages/client/src/hooks/useTrashManager.ts:105-132` (`openTrash` body)

### Step 2.1: Confirm baseline

- [ ] Run: `npx vitest run packages/client/src/__tests__/useTrashManager.test.tsx -w packages/client`

Expected: all existing `openTrash` tests PASS. (If anything fails, stop and investigate before refactoring — the refactor relies on these tests as the behaviour pin.)

### Step 2.2: Add the import

- [ ] Edit `packages/client/src/hooks/useTrashManager.ts` — add this import near the top of the file (alongside the existing `useAbortable*` imports):

```ts
import { refreshTrashList } from "./useTrashManager.refresh";
```

### Step 2.3: Replace the `openTrash` body

- [ ] Edit `packages/client/src/hooks/useTrashManager.ts` — replace `openTrash` (lines 105-132 in the pre-refactor file) with:

```ts
  const openTrash = useCallback(async () => {
    if (!project) return;
    // I2 (review 2026-05-27 round 2, sibling of handleRestore): capture
    // project id at entry so we can bail any state writes after the
    // user has navigated A → B mid-fetch. The capture + isStale
    // mechanism lives in refreshTrashList (4b.3d S13). EditorPage
    // stays mounted across project navigation so this is a routine
    // race.
    const result = await refreshTrashList(project, projectRef, trashOp);
    if (result.kind === "aborted" || result.kind === "stale") return;
    if (result.kind === "ok") {
      setTrashedChapters(result.trashed);
      setTrashOpen(true);
      return;
    }
    // result.kind === "error"
    // message:null for ABORTED is impossible here — the helper returns
    // { kind: "aborted" } before reaching the error branch. Mapped
    // message is non-null on the trash.load scope; log it for
    // debuggability and surface via applyMappedError.
    if (result.mapped.message !== null) {
      console.error("Failed to load trash:", result.mapped.message);
    }
    applyMappedError(result.mapped, { onMessage: setActionError });
  }, [project, trashOp]);
```

Note the dependency array stays `[project, trashOp]` — `projectRef`, `setTrashedChapters`, `setTrashOpen`, `setActionError` are stable React refs/setters that ESLint exhaustive-deps does not require, and `refreshTrashList` is module-level.

### Step 2.4: Run tests to confirm green

- [ ] Run: `npx vitest run packages/client/src/__tests__/useTrashManager.test.tsx -w packages/client`

Expected: all existing `openTrash` tests still PASS.

### Step 2.5: Commit

- [ ] Commit:

```bash
git add packages/client/src/hooks/useTrashManager.ts
git commit -m "$(cat <<'EOF'
refactor(trash): migrate openTrash to refreshTrashList helper (4b.3d S13)

Replace the inlined I2 drift-guard + trashOp.run + abort/stale gates +
mapApiError("trash.load") + applyMappedError ladder with a call to
the new refreshTrashList helper. openTrash now owns only its own
state writes (setTrashedChapters, setTrashOpen) and the
console.error log.

Behaviour preserved; characterization tests pass unchanged. The
helper's discriminated-union return lets openTrash and the future
confirmDeleteChapter refresh diverge on side effects (Task 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate `confirmDeleteChapter` refresh to use the helper (REFACTOR → COMMIT)

**Files:**
- Modify: `packages/client/src/hooks/useTrashManager.ts:357-386` (the post-delete refresh block inside `confirmDeleteChapter`)

### Step 3.1: Confirm baseline

- [ ] Run: `npx vitest run packages/client/src/__tests__/useTrashManager.test.tsx -w packages/client`

Expected: all `confirmDeleteChapter` tests PASS (still — they didn't change since Task 2).

### Step 3.2: Replace the refresh block

- [ ] Edit `packages/client/src/hooks/useTrashManager.ts` — locate the `if (trashOpen && project) { ... }` block inside `confirmDeleteChapter` (around line 357 in the pre-refactor file; line numbers will have shifted slightly after Task 2's `openTrash` refactor — search for `if (trashOpen && project) {` to find it). Replace the block's body (between the opening `{` and closing `}`) with:

```ts
      // S4 + S5 (review 2026-04-25): refreshTrashList threads a signal
      // so an unmount between the successful delete and the trash
      // refresh drops the GET cleanly, and routes the catch through
      // mapApiError so a non-ABORTED failure surfaces an actionable
      // banner instead of being silently swallowed. ABORTED stays silent.
      //
      // I2 (review 2026-05-27 round 2, sibling of handleRestore /
      // openTrash): refreshTrashList captures project id at entry, so
      // post-await state writes bail when the user has navigated
      // A → B mid-refresh.
      //
      // 4b.3d S13: migrated to refreshTrashList. Caller still owns
      // setTrashedChapters; unlike openTrash this site does NOT set
      // setTrashOpen (already open) and does NOT log (the failure
      // banner via applyMappedError is sufficient signal).
      const result = await refreshTrashList(project, projectRef, trashOp);
      if (result.kind === "aborted" || result.kind === "stale") return;
      if (result.kind === "ok") {
        setTrashedChapters(result.trashed);
        return;
      }
      applyMappedError(result.mapped, { onMessage: setActionError });
```

The `if (trashOpen && project) {` guard and the outer dependency array stay unchanged.

### Step 3.3: Run tests to confirm green

- [ ] Run: `npx vitest run packages/client/src/__tests__/useTrashManager.test.tsx -w packages/client`

Expected: all `confirmDeleteChapter` tests PASS.

### Step 3.4: Run the entire client test suite to catch cross-cutting breakage

- [ ] Run: `npx vitest run -w packages/client`

Expected: 0 failures, 0 unexpected warnings.

### Step 3.5: Commit

- [ ] Commit:

```bash
git add packages/client/src/hooks/useTrashManager.ts
git commit -m "$(cat <<'EOF'
refactor(trash): migrate confirmDeleteChapter refresh to refreshTrashList (4b.3d S13)

The post-delete trash refresh inside confirmDeleteChapter now also
calls refreshTrashList, mirroring openTrash's migration in the prior
commit. This site does NOT set setTrashOpen (already open) and does
NOT log to console — the failure banner via applyMappedError is the
sufficient signal here. Both call sites now share the I2 drift-guard
+ abort + stale + mapApiError("trash.load") pipeline through one
helper; their divergent state writes stay at the call sites.

Behaviour preserved; characterization tests pass unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: [S14] Hoist `chapterSeq.abort()` into `fetchSnapshots`; add chapter-switch test (RED → GREEN → COMMIT)

**Files:**
- Modify: `packages/client/src/components/SnapshotPanel.tsx:133-186` (`fetchSnapshots` + mount useEffect)
- Modify: `packages/client/src/__tests__/SnapshotPanel.test.tsx` — add one new test

### Step 4.1: Write the failing chapter-switch test

- [ ] Edit `packages/client/src/__tests__/SnapshotPanel.test.tsx` — append the following test inside the existing top-level `describe` (or the relevant `describe` for fetch/mount behaviour; look for the test "aborts in-flight imperative fetchSnapshots on unmount" at ~line 705 and add the new test adjacent to it).

```ts
    it("discards stale chapter-A response after chapter switch to B (4b.3d S14)", async () => {
      // The mount-effect-fetchSnapshots dedupe (4b.3d S14) hoists
      // chapterSeq.abort() into fetchSnapshots itself, so a chapter
      // switch bumps the sequence's epoch via fetchSnapshots's new
      // first line. Without that hoist, a stale chapter-A response
      // could land on chapter-B's panel because capture() alone
      // returns a token at the same (unbumped) epoch as the prior
      // chapter's still-outstanding token.

      // Resolver controls when chapter A's promise resolves.
      let resolveA!: (v: SnapshotListItem[]) => void;
      const aPromise = new Promise<SnapshotListItem[]>((r) => {
        resolveA = r;
      });
      const bPromise = Promise.resolve<SnapshotListItem[]>([
        makeSnapshot({ id: "snap-B", label: "B snapshot" }),
      ]);

      vi.mocked(api.snapshots.list).mockImplementation(async (chapterId: string) => {
        if (chapterId === "ch-A") return aPromise;
        if (chapterId === "ch-B") return bPromise;
        return [];
      });

      const { rerender } = render(<SnapshotPanel {...defaultProps} chapterId="ch-A" />);

      // Wait for chapter A's mount fetch to fire.
      await waitFor(() => {
        expect(api.snapshots.list).toHaveBeenCalledWith("ch-A", expect.anything());
      });

      // Switch to chapter B — mount-effect re-runs, fetchSnapshots
      // calls chapterSeq.abort() then capture() at a bumped epoch.
      rerender(<SnapshotPanel {...defaultProps} chapterId="ch-B" />);

      // Chapter B's fetch resolves first; panel shows B's snapshot.
      await waitFor(() => {
        expect(screen.getByText("B snapshot")).toBeInTheDocument();
      });

      // Now resolve A's still-held promise with a recognisable label.
      resolveA([makeSnapshot({ id: "snap-A", label: "A snapshot" })]);

      // Give the .then chain time to run.
      await new Promise((r) => setTimeout(r, 0));

      // A's stale response MUST NOT appear in the panel — token.isStale()
      // gates it out because the epoch was bumped by fetchSnapshots's
      // hoisted abort() during the chapter switch.
      expect(screen.queryByText("A snapshot")).not.toBeInTheDocument();

      // And the chapter-B label should still be there.
      expect(screen.getByText("B snapshot")).toBeInTheDocument();
    });
```

If `makeSnapshot` is not imported at the top of the file (search for `function makeSnapshot` or `const makeSnapshot`), use the existing test helpers already in this file — the existing tests like "surfaces viewStaleChapterSwitch ..." use `makeSnapshot({ id, label })`, so the helper exists.

### Step 4.2: Run the test to confirm it fails (RED)

- [ ] Run: `npx vitest run packages/client/src/__tests__/SnapshotPanel.test.tsx -t "discards stale chapter-A response" -w packages/client`

Expected: test FAILS — chapter A's "A snapshot" appears in the panel because the mount effect's `capture()` alone returns a token at the same epoch as chapter A's still-outstanding token.

**If the test passes unexpectedly:** the current code may already have the protection (e.g. a recently-added explicit-abort I missed). Stop and inspect — re-read `SnapshotPanel.tsx:133-186` for any recent change.

### Step 4.3: Hoist `chapterSeq.abort()` into `fetchSnapshots`

- [ ] Edit `packages/client/src/components/SnapshotPanel.tsx` — replace the `fetchSnapshots` `useCallback` body (lines 133-150 in the pre-refactor file) with:

```tsx
    const fetchSnapshots = useCallback(async () => {
      if (!chapterId) return;
      // 4b.3d S14: bump the chapterSeq epoch before capturing a token so
      // any prior in-flight fetchSnapshots's .then/.catch checks see
      // token.isStale() === true. Hoisted from the mount useEffect (now
      // a single fetchSnapshots() call) so both call paths get the same
      // chapter-switch invalidation semantics.
      chapterSeq.abort();
      const token = chapterSeq.capture();
      const { promise } = fetchOp.run((s) => api.snapshots.list(chapterId, s));
      try {
        const data = await promise;
        if (token.isStale()) return;
        setSnapshots(data);
        setListError(null);
        onSnapshotsChange?.(data.length);
      } catch (err) {
        if (token.isStale()) return;
        // Surface the failure instead of silently showing an empty panel;
        // otherwise a network blip makes the user think a chapter with
        // snapshots has none.
        applyMappedError(mapApiError(err, "snapshot.list"), { onMessage: setListError });
      }
    }, [chapterId, onSnapshotsChange, chapterSeq, fetchOp]);
```

### Step 4.4: Simplify the mount useEffect

- [ ] Edit `packages/client/src/components/SnapshotPanel.tsx` — replace the mount useEffect (lines 155-186 in the pre-refactor file) with:

```tsx
    // Fetch on mount and when chapterId changes
    useEffect(() => {
      if (!isOpen || !chapterId) return;
      // 4b.3d S14: chapterSeq.abort() now lives at the top of
      // fetchSnapshots, so this effect doesn't need to re-implement the
      // inlined fetch — it just calls fetchSnapshots() and lets the
      // hoisted abort do the chapter-switch invalidation work.
      //
      // S4 (review 2026-05-25): explicit cleanup. useAbortableAsyncOperation
      // auto-aborts on unmount AND on the next .run() call, but NOT on a
      // bare effect-rerun (e.g. the isOpen=true→false transition that early-
      // returns above without re-issuing run()). In practice SnapshotPanel
      // is conditionally rendered on `snapshotPanelOpen && activeChapter`,
      // so a close-while-mounted transition doesn't occur today — but a
      // future refactor that keeps the panel mounted with isOpen=false
      // would leave the prior in-flight server work running to completion.
      // Mirror sibling ExportDialog's explicit op.abort() in its
      // open→closed transition.
      void fetchSnapshots();
      return () => {
        fetchOp.abort();
      };
    }, [isOpen, chapterId, fetchSnapshots, fetchOp]);
```

Note the dependency array gains `fetchSnapshots` (since the effect now calls it) and drops `onSnapshotsChange` / `chapterSeq` (they're consumed via `fetchSnapshots`'s closure).

### Step 4.5: Run the chapter-switch test to confirm green

- [ ] Run: `npx vitest run packages/client/src/__tests__/SnapshotPanel.test.tsx -t "discards stale chapter-A response" -w packages/client`

Expected: test PASSES.

### Step 4.6: Run the full `SnapshotPanel.test.tsx` suite

- [ ] Run: `npx vitest run packages/client/src/__tests__/SnapshotPanel.test.tsx -w packages/client`

Expected: all `SnapshotPanel` tests PASS — no regression from the refactor.

### Step 4.7: Commit

- [ ] Commit:

```bash
git add packages/client/src/components/SnapshotPanel.tsx packages/client/src/__tests__/SnapshotPanel.test.tsx
git commit -m "$(cat <<'EOF'
refactor(snapshots): hoist chapterSeq.abort() into fetchSnapshots (4b.3d S14)

The mount useEffect previously inlined a copy of the fetch
shape with chapterSeq.abort() at the top, while fetchSnapshots
(used imperatively after create/delete) did capture() alone.
This was load-bearing — without abort() before capture() on
chapter switch, capture() returns a token at the same epoch
as the prior chapter's still-outstanding token, and both are
considered current; a late chapter-A response could overwrite
chapter-B's state.

Hoist chapterSeq.abort() to the top of fetchSnapshots so both
the mount path (now `void fetchSnapshots()` + cleanup) and the
imperative refresh-after-mutation path get the same chapter-
switch invalidation semantics. The behavioural delta on the
imperative path is no-op in practice (no concurrent imperative
refresh occurs on the same chapter) and arguably more correct
if a future refactor introduces one.

New test pins the post-hoist contract: chapter A's stale
response is discarded after switch to chapter B.

Net: removes ~25 lines of duplicated fetch shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CLAUDE.md updates (DOCS → COMMIT)

**Files:**
- Modify: `CLAUDE.md` (§Unified API error mapping, §Pull Request Scope)

### Step 5.1: Verify §Save-Pipeline Invariants Rule 4 (no write)

- [ ] Read `CLAUDE.md` line 132 (the long paragraph inside Rule 4). Confirm it lists exactly four files in the justified-survivor allowlist: HomePage.tsx, useProjectEditor.ts, useSnapshotState.ts, useTrashManager.ts (with the `restoreRecoveryAbortRef` justification on the last). Confirm the leading "four" matches the four files enumerated.

If anything is drifted (e.g. text still says "three" anywhere, or a file is missing), fix it inline. Otherwise, no write.

### Step 5.2: Expand §Unified API error mapping

- [ ] Edit `CLAUDE.md` — locate the §Unified API error mapping paragraph (lines 137-147 in pre-edit CLAUDE.md; search for "**Unified API error mapping.**"). Replace the entire paragraph with:

```markdown
**Unified API error mapping.** All client code that surfaces a user-visible
message from an API error must route through `mapApiError(err, scope)` in
`packages/client/src/errors/`. The mapper returns `MappedError<S> = { message,
possiblyCommitted, transient, extras? }`; the `<S>` phantom parameter ties
the `extras` shape to the scope, accessible via `ScopeExtras<S>`. The mapper
is the single owner of code/status-to-string translation and of the cross-
cutting rules (ABORTED is silent, 2xx BAD_JSON is `possiblyCommitted: true`
when the scope declares `committed:` copy and `false` for read scopes that do
not, NETWORK is `transient`). The `committedCodes` scope field extends
`possiblyCommitted: true` beyond the 2xx-BAD_JSON case to specific server
codes (e.g. `UPDATE_READ_FAILURE`, `READ_AFTER_CREATE_FAILURE`,
`RESTORE_READ_FAILURE`) where the write may or may not have landed. Raw
`err.message` must never reach the UI. New API surfaces add a scope entry to
`scopes.ts`; they do not write ad-hoc ladders at call sites. Consumer call
sites route through `applyMappedError(mapped, { onMessage, onTransient?,
onCommitted?, onExtras? })` from `packages/client/src/errors/applyMappedError.ts`
— its `STOP` sentinel lets a callback short-circuit the rest of the chain.
This is the canonical consumer pattern, parallel with `useEditorMutation` and
`useAbortableSequence`. This invariant will be enforced by ESLint in Phase
4b.4; until then, it is enforced by review.
```

### Step 5.3: Append the §Pull Request Scope exception acknowledgments

- [ ] Edit `CLAUDE.md` — locate the exception-tracking paragraph at line 213 (search for "Exceptions to the one-feature rule require"). Replace that single paragraph with the expanded version:

```markdown
**Exceptions to the one-feature rule require an explicit decision recorded in the phase's decision log; the rule defaults to enforcement.** The 2026-05-25 Phase 4b.3b decision log entry is the first such recorded exception (bundling Cluster B threading with the allowlist sweep). Earlier and subsequent exceptions follow the same machinery: the 2026-04-19 Phase 4b.3 PR bundled sanitizer + CONTRIBUTING.md + Node-engines pin with the unified-error-mapper migration (per Cluster F [I15] in `docs/plans/2026-04-25-4b3a-review-followups-design.md`); the 2026-05-26 Phase 4b.3c three-way split (4b.3c.1/.2/.3) is recorded in `docs/roadmap-decisions/2026-05-26-phase-4b-3c-consumer-recovery-completeness.md`; and the 2026-05-27 Phase 4b.3d bundling of two small refactors plus the docs that codify the consumer pattern is recorded in `docs/roadmap-decisions/2026-05-27-phase-4b-3d-mapper-internals-claude-md-updates.md`.
```

### Step 5.4: Confirm CLAUDE.md still reads cleanly

- [ ] Read the modified §Unified API error mapping paragraph end-to-end. Confirm:
  - One paragraph, no orphan sentences left from the prior version.
  - The new sentences flow with the surrounding text.
  - No duplicated definitions or contradictory claims.
- [ ] Read the modified §Pull Request Scope exception paragraph. Confirm:
  - The 4b.3b "first such recorded exception" sentence still leads.
  - The chronological enumeration is correct: 2026-04-19, 2026-05-25 (already there), 2026-05-26, 2026-05-27.
  - All decision-log filenames cited exist (verify with `ls docs/roadmap-decisions/`).
- [ ] If the 4b.3d decision-log file does not exist yet (it lands in /roadmap step 10), that is acceptable for this commit — the file will exist by the time the PR opens. Add a note in the commit message acknowledging the forward reference.

### Step 5.5: Commit

- [ ] Commit:

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): §Unified API error mapping + §PR Scope updates (4b.3d S2)

Expand §Key Architecture Decisions → "Unified API error mapping"
paragraph to describe the architecture that Phase 4b.3c established:
MappedError<S> return type with phantom <S>; ScopeExtras<S> typed
accessor for extras; committedCodes scope field extending
possiblyCommitted beyond 2xx-BAD_JSON; applyMappedError + STOP
sentinel as canonical consumer pattern, parallel with useEditorMutation
and useAbortableSequence.

§Pull Request Scope grows from one recorded exception (4b.3b) to four:
2026-04-19 Phase 4b.3 ([I15]), 2026-05-25 Phase 4b.3b (already
recorded), 2026-05-26 Phase 4b.3c three-way split, 2026-05-27 Phase
4b.3d bundling. Per pushback Issue 7, the 4b.3d self-reference is
included so CLAUDE.md becomes a one-stop list of prior-art exceptions
for future contributors searching "do I need an exception?".

The 4b.3d decision-log entry referenced here is forthcoming (lands at
/roadmap step 10 in the same brainstorming session).

§Save-Pipeline Invariants Rule 4 verified unchanged (the four-file
allowlist already landed in 4b.3c.3 via commit a35c8c8 + 6c04b29).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full-suite verification + coverage + zero-warnings audit

**Files:** none modified — verification only.

### Step 6.1: Run the full test suite (no coverage)

- [ ] Run: `make test`

Expected: all tests PASS. No `console.warn`/`console.error` leakage in test output.

If any test outputs a warning that does not arise from a spy assertion: stop and pin it per CLAUDE.md §Testing Philosophy zero-warnings rule. Do not paper over with `vi.spyOn(...).mockImplementation(() => {})` without an assertion.

### Step 6.2: Run lint + format

- [ ] Run: `make lint`
- [ ] Run: `make format`

Expected: both pass cleanly. No prettier diffs left uncommitted.

If `make lint` autofixed anything, run `git diff` and commit the formatting/lint fixes as a separate `style(...)` commit before moving on.

### Step 6.3: Run typecheck

- [ ] Run: `make typecheck` (or `npm run typecheck` if no Makefile target)

Expected: zero type errors. The new `useTrashManager.refresh.ts` adds a `RefreshTrashResult` type; the test file uses `MappedError`; verify both compile.

### Step 6.4: Run coverage

- [ ] Run: `make cover`

Expected: PASS — coverage at or above thresholds (95% statements, 85% branches, 90% functions, 95% lines) per `packages/client/vitest.config.ts`.

If coverage dropped below the floor: identify which lines in `useTrashManager.refresh.ts` or the modified `SnapshotPanel.tsx` are uncovered, and add direct tests for those lines. **Do not lower the thresholds.** Per CLAUDE.md §Testing Philosophy, write meaningful tests for the uncovered code; never minimal tests to scrape past the floor.

### Step 6.5: Run e2e

- [ ] Run: `make e2e`

Expected: all e2e tests PASS. The 4b.3d changes are behaviour-preserving, so existing e2e flows (trash open/restore/delete, snapshot create/view) should not regress.

### Step 6.6: Final manual smoke check

- [ ] Run `make dev`. In the browser:
  1. Open a project; create a chapter; create a snapshot; delete the snapshot. Confirm the SnapshotPanel updates correctly (the imperative refresh path that consumes the now-hoisted `chapterSeq.abort()`).
  2. Delete a chapter via the editor's chapter menu. Open the trash drawer. Confirm the deleted chapter appears (`openTrash` → `refreshTrashList`).
  3. Restore the chapter from the trash drawer. Confirm it returns to the sidebar.
  4. Delete a different chapter while the trash drawer is open. Confirm the trash list refreshes to show the new entry (`confirmDeleteChapter` post-delete → `refreshTrashList`).
  5. Open the same project's trash, navigate to a different project mid-fetch (slow-network this with DevTools), and confirm the trash list does not flash a stale entry. (Manual verification of the `kind: "stale"` branch.)

### Step 6.7: Confirm DoD signals

- [ ] `make all` green.
- [ ] Coverage report shows thresholds met.
- [ ] No test-output warnings unaccounted-for.
- [ ] All commits ready for PR. The PR description should reference the design doc (`docs/plans/2026-05-27-mapper-internals-claude-md-updates-design.md`), the decision-log entry (`docs/roadmap-decisions/2026-05-27-phase-4b-3d-mapper-internals-claude-md-updates.md`), and explicitly invoke the bundling-exception per CLAUDE.md §Pull Request Scope.

### Step 6.8: No code commit (verification-only task)

This task produces no commit. If Step 6.2 surfaced a `make lint` autofix, that lands as its own `style(...)` commit between Step 5 and Step 6.

---

## Self-Review Notes (writing-plans skill)

- **Spec coverage:**
  - [S6] — explicitly dropped in spec; no plan task. ✓
  - [S13] — Task 1 (extract + test) + Task 2 (`openTrash` migration) + Task 3 (`confirmDeleteChapter` migration). ✓
  - [S14] — Task 4. ✓
  - [S2] CLAUDE.md updates — Task 5. ✓
  - [S22]/[S23] — recorded in decision-log entry (/roadmap step 10, not a plan task). ✓
  - DoD: `make all` + coverage + zero warnings — Task 6. ✓
- **Placeholders:** none. All code blocks are concrete; commit messages are concrete; expected outputs are concrete.
- **Type consistency:** `refreshTrashList` signature, `RefreshTrashResult` type, and the four return kinds match across Task 1, 2, and 3. The `MappedError<"trash.load">` parameterization matches the existing `scopes.ts` entry.
- **Caller dependency arrays:** `openTrash`'s deps stay `[project, trashOp]`; `confirmDeleteChapter`'s deps unchanged (it's not modified at the `useCallback` boundary, only inside its body). React's exhaustive-deps lint rule should accept both — verify in Task 6's `make lint`.

---

## Out of Scope (do not implement)

- [S6] try/catch around `safeExtrasFrom` dev log. Dropped in pushback Issue 1. If a real reproduction surfaces, file a follow-up — do not retrofit.
- Phase Structure table updates in `docs/roadmap.md`. Already landed in /roadmap step 5b (commit 80ea1b7).
- Decision-log entry + INDEX update. Lands at /roadmap step 10 in the same brainstorming session — not a plan task.
- Any other `useTrashManager.ts` handlers (`handleRestore`, etc.). Out of scope per design's "Out of Scope" section.
- `SnapshotPanel` list-load and detail-load `useEffect` flows. Out of scope per the 4b.3a.4 design that established their different lifecycle shape.
