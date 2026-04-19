# Phase 4b.1: Editor Orchestration Helper — Design

**Date:** 2026-04-19
**Phase:** 4b.1 (from `docs/roadmap.md`)
**Status:** Brainstormed, awaiting pushback review
**Author:** Ovid / Claude (collaborative)

---

## Goal

Extract the shared "mutate editor content via the server" shape — `setEditable(false)` → `flushSave` → `cancelPendingSaves` → `markClean` → server call → `clearCachedContent` → `reloadActiveChapter` → `setEditable(true)` — into a single hook, so that the CLAUDE.md Save-Pipeline Invariants are enforced by construction rather than by review vigilance.

Phase 4b required 16 rounds of review. Pattern analysis showed the dominant cause was divergent re-implementations of this shape across three call sites (`handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`). Future phases that mutate chapter content from the server (4c notes/tags/outtakes, 5b scene cards, 7e import) will hit the same rake until this is extracted.

## Non-goals

- New features or UX changes.
- Changes to the server-side save path.
- Consolidating error-mapping to UI strings (Phase 4b.3).
- Unifying ad-hoc sequence refs (Phase 4b.2).
- Externalizing raw strings via lint (Phase 4b.4).
- Touching the `handleSave` auto-save pipeline — that is a different concern.

## Architecture overview

The helper is a new hook, `useEditorMutation`, in `packages/client/src/hooks/useEditorMutation.ts`. It is called once from `EditorPage.tsx`, alongside `useProjectEditor`, and receives two explicit handles:

```ts
const projectEditor = useProjectEditor(...);
const editorRef = useRef<EditorHandle | null>(null);
const mutation = useEditorMutation({ editorRef, projectEditor });
```

- `editorRef: MutableRefObject<EditorHandle | null>` — the same ref `EditorPage` already threads into `<Editor />`. The hook reads `editorRef.current` on each `run()` invocation (not at mount), so the ref's late-binding lifecycle is preserved.
- `projectEditor` — the return value of `useProjectEditor(...)`. The hook uses `cancelPendingSaves`, `clearCachedContent`, and `reloadActiveChapter`. No new methods are added to `useProjectEditor`.

The hook returns `{ run }`. `run()` is the only entry point. The in-flight guard is purely internal — no reactive state is exposed. Callers that want to detect "busy" inspect `result.stage === "busy"` on the return value; today's call sites already rely on guard-style early-returns (no UI binds to the in-flight flag), so no current consumer needs reactive state.

Three existing call sites migrate: `handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`. Each loses ~30–50 lines of scaffolding and becomes a ~15-line function.

Two call sites stay inline: `SnapshotPanel.onView` and `SnapshotPanel.onBeforeCreate`. They do not mutate editor content via the server, so they get no benefit from the hook.

`reloadActiveChapter` stays a public method on `useProjectEditor`. The hook calls it internally; it also remains individually callable for non-mutation reload cases.

### Why a standalone hook (not merged into `useProjectEditor`)

The hook we are building has a single responsibility (orchestrate a mutation); `useProjectEditor` has a different single responsibility (own save/cache/reload state for the active chapter). Merging them makes `useProjectEditor` grow and adds an "attach editor" lifecycle step to it — the same kind of temporal coupling we are trying to delete. Keeping them composed at the call site documents exactly what the hook touches.

### Why a hook (not a single orchestrator function or composable guards)

The three call sites today manually compose `setEditable` / `flushSave` / `cancelPendingSaves` / `markClean` / mutation / cache-clear / reload / `setEditable`. A function that takes a callback would eliminate duplication, but callers would still own the in-flight guard (today's `replaceInFlightRef`) and the test surface would split across both. A hook owns state, owns the guard, enforces the full sequence in one place, and is trivially testable with `renderHook` and stubbed handles.

Composable guards (`prepareEditorMutation` + `finalizeEditorMutation`) were rejected because handing callers two Lego bricks reintroduces the composition hazard the phase is explicitly trying to delete.

## API

**Module:** `packages/client/src/hooks/useEditorMutation.ts`

```ts
export type MutationStage = "flush" | "mutate" | "reload" | "busy";

export type MutationDirective<T = void> = {
  /** Chapter IDs whose draft cache to clear after server success. */
  clearCacheFor: string[];
  /** Whether to re-fetch the currently-active chapter after server success. */
  reloadActiveChapter: boolean;
  /** Server response data to thread through to the post-success branch. */
  data: T;
};

export type MutationResult<T = void> =
  | { ok: true; data: T }
  // Reload-stage failure is a partial success: the server committed, the
  // directive was produced, so `data` is still available. Callers use it to
  // show "N replacements done, but reload failed" without a closure smuggle.
  | { ok: false; stage: "reload"; data: T; error?: unknown }
  | { ok: false; stage: "flush" | "mutate" | "busy"; error?: unknown };

export type UseEditorMutationArgs = {
  editorRef: MutableRefObject<EditorHandle | null>;
  projectEditor: Pick<
    ReturnType<typeof useProjectEditor>,
    "cancelPendingSaves" | "reloadActiveChapter"
  >;
};

// Cache-clear functions are imported directly from `./useContentCache`, not
// received via `projectEditor` — `clearCachedContent` / `clearAllCachedContent`
// are module-level functions, not methods on the `useProjectEditor` return.
// `EditorPage.tsx` already imports `clearAllCachedContent` the same way.

export type UseEditorMutationReturn = {
  run: <T>(
    mutate: () => Promise<MutationDirective<T>>,
  ) => Promise<MutationResult<T>>;
};

export function useEditorMutation(
  args: UseEditorMutationArgs,
): UseEditorMutationReturn;
```

### `run(mutate)` semantics

1. If a prior `run` is in flight → return `{ ok: false, stage: "busy" }` immediately. No side effects, no editor-handle calls.
2. Set the in-flight flag. `editorRef.current?.setEditable(false)`.
3. `await editorRef.current?.flushSave()`. On reject → restore editable, clear in-flight, return `{ ok: false, stage: "flush", error }`.
4. `projectEditor.cancelPendingSaves()` — drain any pending retries so none land after `markClean`.
5. `editorRef.current?.markClean()` — CLAUDE.md invariant 1: closes the unmount-clobber window before the server call that will overwrite editor content.
6. `await mutate()` to get the `MutationDirective`. On throw → restore editable, clear in-flight, return `{ ok: false, stage: "mutate", error }`.
7. `clearAllCachedContent(directive.clearCacheFor)` — CLAUDE.md invariant 3: cache clear happens only after server success. Imported from `./useContentCache`.
8. If `directive.reloadActiveChapter` is true → `await projectEditor.reloadActiveChapter()`. On reject → restore editable, clear in-flight, return `{ ok: false, stage: "reload", data: directive.data, error }`. The directive's `data` is carried through so the caller can surface a "server committed but reload failed" banner with the correct response data (replaced count, affected chapters, etc.) without a closure smuggle.
9. Restore editable, clear in-flight, return `{ ok: true }`.

### Design rationale by invariant

| Invariant (CLAUDE.md) | Where enforced |
|-----------------------|----------------|
| 1. `markClean()` before any server call that invalidates editor state | Step 5, before step 6 |
| 2. `setEditable(false)` around any mutation that can fail mid-typing | Steps 2 and final restoration in every return path |
| 3. Cache-clear happens after server success, never before | Step 7 is gated on step 6 success |
| 4. Bump the sequence ref before the request, not after | `reloadActiveChapter` (called in step 8) already bumps before its fetch; the hook adds no new seq-refs |
| 5. Error codes stay inside the HTTP allowlist | Out of scope — Phase 4b.3 handles error-code mapping |

### Latest-ref pattern for `projectEditor`

`useProjectEditor` returns some methods with unstable identity — `cancelPendingSaves` is an inline arrow in the return object (`useProjectEditor.ts:536`), so its reference changes on every render. The hook must not capture a stale reference.

Implementation: the hook keeps the latest `projectEditor` in a ref synced on every render.

```ts
const projectEditorRef = useRef(args.projectEditor);
useEffect(() => {
  projectEditorRef.current = args.projectEditor;
});
```

`run` reads `projectEditorRef.current.cancelPendingSaves()` at call time rather than closing over the destructured method. This keeps `run` itself stable (safe to memoize with `useCallback([], ...)`) while always invoking the latest implementation. The pattern is the standard React "latest event handler" trick.

Future-proof: any other `useProjectEditor` method that becomes unstable later is handled automatically without touching call sites.

### Null-ref safety

`editorRef.current` may be null if the editor unmounted mid-operation. The hook treats null as "no-op the editor side effect, proceed to cache/reload." This matches today's `editorRef.current?.` guards across the codebase.

### In-flight guard behavior

Second `run()` while the first is pending returns `{ ok: false, stage: "busy" }` immediately. No queue, no coalescing, no abort. This matches today's `replaceInFlightRef` semantics (drop the second call) but types it through the same discriminated-result shape as every other failure. Callers that want to surface "busy" in UI can inspect `result.stage === "busy"`; callers that want to ignore can just ignore it.

## Call-site migrations

All three call sites in `EditorPage.tsx` migrate. Sketches use the new `mutation.run(...)` contract; final code will adapt to existing imports and strings.

### `handleRestoreSnapshot` (currently lines 177–244)

`restoreSnapshot()` (from `useSnapshotState`) returns `{ ok, reason?, staleChapterSwitch? }` and does **not** throw. The mutate callback has to translate this into the hook's contract: throw a sentinel for the failure branches so the hook reports `stage: "mutate"`, and return a directive with `reloadActiveChapter: false` for the `staleChapterSwitch` case. The user-intent re-check (`viewingSnapshotRef.current`) also moves inside the mutate callback, where a stale intent becomes an `AbortedError` throw.

```ts
class RestoreAbortedError extends Error {}
class RestoreFailedError extends Error {
  constructor(
    public readonly reason:
      | "corrupt_snapshot"
      | "cross_project_image"
      | "not_found"
      | "other",
  ) {
    super(`restore failed: ${reason}`);
  }
}

const handleRestoreSnapshot = async () => {
  if (!viewingSnapshot || !activeChapter) return;

  type RestoreData = { staleChapterSwitch: boolean };

  const result = await mutation.run<RestoreData>(async () => {
    if (!viewingSnapshotRef.current) throw new RestoreAbortedError();
    const restore = await restoreSnapshot(viewingSnapshot.id);
    if (!restore.ok) {
      throw new RestoreFailedError(
        (restore.reason as RestoreFailedError["reason"]) ?? "other",
      );
    }
    const stale = Boolean(restore.staleChapterSwitch);
    return {
      clearCacheFor: stale ? [] : [activeChapter.id],
      reloadActiveChapter: !stale,
      data: { staleChapterSwitch: stale },
    };
  });

  // Caller routes each stage per the stage-to-UI routing contract.
  // On stage: "mutate", the sentinel error type disambiguates aborted-intent
  // (silent) from real failure (error banner with reason-specific copy).
  // Error-mapping details live in the plan.
};
```

Why a defensive `markClean` on the aborted-intent path is harmless: the editor is `setEditable(false)` from the hook's step 2, so no typing could have dirtied it during the flush; the editor was already clean from the last save.

### `executeReplace` (currently lines 246–358)

```ts
const executeReplace = async (opts: ReplaceOpts) => {
  const result = await mutation.run<ReplaceResponse>(async () => {
    const resp = await api.search.replace(opts);
    return {
      clearCacheFor: resp.affected_chapter_ids,
      reloadActiveChapter: resp.affected_chapter_ids.includes(activeChapterId),
      data: resp,
    };
  });

  if (!result.ok) {
    if (result.stage === "busy") return;
    setBanner(mapReplaceError(result.stage, result.error));
    return;
  }
  showReplaceSummary(result.data);
};
```

### `handleReplaceOne` (currently lines 413–520)

Same shape as `executeReplace` plus a post-success `refreshSearchResults()` call, which stays in the caller because it is a search concern, not a mutation concern. 404 and match-not-found cases trigger `refreshSearchResults()` from the error branch (inspecting `result.stage === "mutate"` with the appropriate API error code).

### What leaves the call sites

- The `try`/`finally` scaffold with manual `setEditable(true)` restoration.
- The `replaceInFlightRef` guard.
- The interleaved `editorRef.current?.flushSave()` / `markClean()` / `setEditable()` calls.
- The manual cache-clear-then-reload sequencing.

### What stays

- Mapping errors to caller-specific UI strings (Phase 4b.3 territory).
- Surfacing warnings (skipped chapters from `executeReplace`).
- Re-running search (`handleReplaceOne`).
- Capturing the server response via closure when needed.

### Stage-to-UI routing contract

Every migrated call site must preserve today's behavioral distinctions between failure modes. The hook's discriminated result exposes these via `result.stage`; the caller is responsible for routing each to the correct UI path.

| `result.stage` | Meaning | Required UI routing |
|----------------|---------|---------------------|
| `"flush"` | Pre-mutation `flushSave` rejected. Server state unchanged; editor still dirty. | Save-failure UI (same treatment as a normal failed auto-save). The existing retry loop continues in the background. |
| `"mutate"` | The server call itself failed. Server state unchanged. | Full error banner with caller-specific copy (snapshot-not-found, replace-conflict, 413 too-large, etc.). |
| `"reload"` | Server committed successfully but re-fetching the active chapter failed. Server state is **correct**; only the display is stale. `result.data` carries the mutation response for caller-specific banner copy. | Dismissible banner (matches commit `9de0923`). Never a full error — the write succeeded. |
| `"busy"` | A prior `mutation.run()` is still in flight. No side effects occurred. | Silent early-return. Matches today's `replaceInFlightRef` behavior. |

Migration checklist — verify each call site preserves its pre-refactor routing:

- `handleRestoreSnapshot` — today: flush failure → save UI, restore failure → error banner, reload failure → dismissible banner. The new sketch's `mapRestoreError(result.stage, result.error)` must accept the `stage` dimension and return the corresponding copy + severity; extend the mapper if needed.
- `executeReplace` — same three-way split; `mapReplaceError` likewise extended.
- `handleReplaceOne` — same as `executeReplace`, plus a `stage: "mutate"` with 404 / match-not-found triggers a search refresh before rendering the banner.

Error-mapper internals (the `strings.ts` keys, the exact wording) are Phase 4b.3 territory and remain out of scope for this PR. What stays in scope is the *routing* contract — where each stage lands in the UI.

### Unchanged call sites

- `SnapshotPanel.onView` — flush + `setEditable(false)` without a mutation. Stays inline.
- `SnapshotPanel.onBeforeCreate` — flush + `cancelPendingSaves` without a mutation. Stays inline.
- `useProjectEditor.handleSave` — auto-save pipeline, different concern. Untouched.
- `useProjectEditor.reloadActiveChapter` — primitive called by the hook in step 8 and also directly callable elsewhere. Untouched.

## Testing strategy

The DoD in the roadmap specifies "a regression test for the unmount-clobber bug is committed and passing." That bug spans two layers; we cover both.

### Hook unit test

`packages/client/src/hooks/useEditorMutation.test.tsx`. Uses `renderHook` with stub handles. Covers:

- **Happy path ordering** — asserts call order across all handles: `setEditable(false)` → `flushSave` → `cancelPendingSaves` → `markClean` → `mutate` → `clearCachedContent` → `reloadActiveChapter` → `setEditable(true)`. Uses a shared call-order spy, not just call counts.
- **`markClean` before `mutate`** — direct regression anchor. Fails if anyone reorders step 5 past step 6.
- **Cache-clear after mutate success, never before** — asserts `clearCachedContent` is not called on the mutate-failure path.
- **In-flight guard** — second `run()` while the first is pending returns `{ ok: false, stage: "busy" }` and triggers zero editor-handle calls.
- **Each failure stage** — flush reject / mutate throw / reload reject each produce the correct discriminated result *and* restore `setEditable(true)`.
- **Null editor ref** — all editor-handle side effects are safely skipped; cache/reload still run.
- **Directive honored** — `reloadActiveChapter: false` skips the reload step; empty `clearCacheFor` still marks success.

### Integration regression (deferred to e2e)

An initial attempt at a jsdom integration test (`packages/client/src/pages/EditorPage.unmount-clobber.test.tsx`) was written and removed. The real `<Editor />` component's `flushSave` and `setEditable` guards already close the unmount-clobber window in production; reproducing the race in jsdom required replacing `<Editor />` with a test double that deliberately weakened those guards, which reduced the test to asserting "`markClean` is the last line of defense in a simulation where everything else fails" — a ceremonial pass, not a true regression anchor.

The hook unit test already asserts `markClean()` runs before `mutate()` (step 5 ordering check in `useEditorMutation.test.tsx`). The production-shape regression lives in e2e: the existing Playwright snapshot-restore and replace-all scenarios exercise the full pipeline with real TipTap and a real fetch round-trip, and will fail if the unmount-clobber shape returns. If a tighter regression is needed later, add a Playwright case that specifically holds the restore response mid-flight and forces a chapter-switch unmount — the browser environment is the right layer for it.

### Coverage and noise discipline

- The new hook must hit 95% lines / 90% functions / 85% branches per `vitest.config.ts` thresholds.
- Every deliberately-triggered error path spies on `console.warn`/`console.error` and asserts the message, per CLAUDE.md zero-warnings rule.

## CLAUDE.md update

§Save-pipeline invariants (lines 82–88 of `CLAUDE.md`) currently states the five invariants abstractly and tells developers "any code that triggers a server mutation affecting editor content must obey them." After Phase 4b.1, invariants 1–4 are codified in `useEditorMutation`. The section gains a closing sentence along the lines of:

> For mutation-via-server flows (restore snapshot, replace across project, and future similar operations), route through `useEditorMutation` — it enforces invariants 1–4 by construction. Hand-composing these steps is reserved for flows outside its scope (e.g. snapshot view, which does not mutate content).

Invariant 5 (error-code allowlist) is out of scope for this hook and correctly stays as a standalone rule (Phase 4b.3 will handle error mapping).

## Deliverables

The phase is done when all of these land:

1. `packages/client/src/hooks/useEditorMutation.ts` — the hook.
2. `packages/client/src/hooks/useEditorMutation.test.tsx` — hook unit test.
3. `packages/client/src/pages/EditorPage.tsx` — three call sites migrated. Net deletion expected (~80–140 lines removed vs. ~45–60 added).
4. `CLAUDE.md` §Save-pipeline invariants — closing sentence pointing to `useEditorMutation`.
5. No user-visible behavior change — validated by running the existing `EditorPageFeatures.test.tsx` suite unmodified and passing. Production-shape regression for the unmount-clobber bug is owned by e2e (see §Testing strategy).

## Risks and mitigations

- **Risk:** migrating `handleReplaceOne` preserves the 404 / match-not-found re-search paths.
  **Mitigation:** the re-search stays in the caller, triggered by inspecting `result.stage === "mutate"` with a 404 error. Unit-test the routing.

- **Risk:** today's `replaceInFlightRef` blocks `handleReplaceOne` from overlapping with `executeReplace` (two callers, same ref). The hook's in-flight flag is per-hook-instance.
  **Mitigation:** `EditorPage` calls `useEditorMutation()` exactly once. Both callers share `mutation.run`. Unit-test asserts shared state.

- **Risk:** `reloadActiveChapter`'s error today routes to a dismissible banner via an optional `onError` callback, not a thrown rejection.
  **Mitigation:** the hook's implementation awaits a wrapped Promise that rejects when the `onError` path fires, so `stage: "reload"` fires cleanly. The public `onError` callback on `reloadActiveChapter` remains available for non-hook callers.

- **Risk:** existing tests may poke `editorRef.current` directly and break under the migration.
  **Mitigation:** grep for such tests during implementation; none expected, but verify.

- **Risk:** timing of `cancelPendingSaves` relative to `flushSave`. `flushSave` awaits the current in-flight save; `cancelPendingSaves` drops retries. If `flushSave` rejects, retries are already scheduled by `handleSave` — we must cancel them before `markClean` runs.
  **Mitigation:** step 4 (`cancelPendingSaves`) runs only after `flushSave` resolves. On flush reject the hook returns early without calling `cancelPendingSaves`; the caller sees `stage: "flush"` and handles the save-failure UI. Retries will run to their normal conclusion under the existing save-retry logic.

## Out of scope

- Error-to-UI-string centralization (Phase 4b.3).
- Abortable sequence primitive (Phase 4b.2).
- Raw-string ESLint rule (Phase 4b.4).
- Server-side save path changes.
- Any new features or UX changes.
- `handleSave` auto-save pipeline.

## PR scope

Single refactor, one PR. The PR description references Phase 4b.1. Expected diff shape:

- `packages/client/src/hooks/useEditorMutation.ts` — new file.
- `packages/client/src/hooks/useEditorMutation.test.tsx` — new file.
- `packages/client/src/pages/EditorPage.unmount-clobber.test.tsx` — new file.
- `packages/client/src/pages/EditorPage.tsx` — net deletion.
- `CLAUDE.md` — one-sentence addition to §Save-pipeline invariants.

No server-side files. No new dependencies. No migrations.
