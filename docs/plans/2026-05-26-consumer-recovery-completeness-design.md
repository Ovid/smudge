# Phase 4b.3c: Consumer Recovery Completeness — Design

**Date:** 2026-05-26
**Roadmap phase:** Phase 4b.3c (`docs/roadmap.md:999-1051`)
**Source review:** `paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md` (Cluster C — 15 items)
**Dependencies:** Phase 4b.3 (Unified API Error Mapper), Phase 4b.3a (4b.3 review follow-ups, Clusters A/D/F), Phase 4b.3a.1 (`useAbortableAsyncOperation`), Phase 4b.3b (AbortSignal Threading Completion).

## Goal

Address Cluster C from the Phase 4b.3 code review: 15 items where consumers of `mapApiError` mishandle the mapper's output (drop `possiblyCommitted`, silently dismiss errors, duplicate consumer ladders) or where flows lack a dedicated scope. Foundation is `applyMappedError`, a small helper that replaces the 30+ hand-rolled `if (message === null) return; if (message) setX(message)` ladders, paired with the typed `ScopeExtras<S>` accessor and a `devWarn` observability helper.

## Why Now

The Phase 4b.3 unified error mapper centralized code-to-string translation, but the 4b.3 review found consumer-side drift: scopes declare `committed:` copy that consumers ignore; recovery branches silently drop dialogs; one-shot recovery `AbortRef`s leak across renders. Each item is small individually, but the absence of a shared `applyMappedError` helper means the same mistake is reintroduced every time a new caller is written. Ships before Phase 4b.4 so the raw-strings lint rule runs against a clean baseline.

## Architecture

The phase adds **two error-handling primitives plus one observability helper** to `packages/client/src/errors/`, then migrates consumers to them. No new top-level modules; no API-surface change; no scope-registry surgery beyond a narrow [S8] tweak and a [S3]/[S7] relocation. The shape:

**New primitives** (foundation):

1. `applyMappedError(mapped, handlers)` — dispatch helper. Pure function. Owns the "silent on null" contract and the callback ordering. No React, no awaits.
2. `ScopeExtras<S>` — type that narrows `MappedError.extras` to the registered scope's `extrasFrom` return. Replaces the `as { chapters: … }` cast at `ImageGallery.tsx:334-338`.
3. `devWarn(context, signal, err)` — DEV+!aborted gated `console.warn` helper. Used at exactly two sites in this phase; barrel-exported so future recovery flows can pick it up without re-implementing.

**Consumer migrations** (~39 commits across 8 files): 11 behavioural fixes (each in its own commit, each preceded by a pinning-test commit where the catch does more than `setX(msg)`) plus ~22 simple-ladder migrations grouped per `handleX`/component method. Commit count breaks down as: 4 foundation, 2 scope refactor, 17 behavioural-with-pinning, 16 simple-ladder. The single-PR shape stays well-bounded — comparable to the Phase 4b.3a sweep.

**Scope-registry tweaks** (~30-line diff in `scopes.ts`):

- **[S8]** `image.delete.extrasFrom` — drop the all-or-nothing `valid.length !== candidates.length` reject; keep the cap+1 input window; keep the `valid.length === 0` reject.
- **[S3]/[S7]** `chapter.save` — add a `terminalCodes` field to `ScopeEntry`; move the `BAD_JSON`/`UPDATE_READ_FAILURE`/`CORRUPT_CONTENT` allowlist from `useProjectEditor.ts:468-481` into the scope; mapper plumbing reads `terminal` from the mapped result.

The phase explicitly does **not** touch the API surface, server, or the existing mapper's main control flow.

## The Three Primitives

### `applyMappedError` — `errors/applyMappedError.ts`

```ts
import type { MappedError } from "./apiErrorMapper";
import type { ApiErrorScope } from "./scopes";
import type { ScopeExtras } from "./scopeExtras";

export interface ApplyMappedErrorHandlers<S extends ApiErrorScope> {
  onMessage?: (message: string) => void;
  onCommitted?: () => void;
  onTransient?: () => void;
  onExtras?: (extras: ScopeExtras<S>) => void;
}

export function applyMappedError<S extends ApiErrorScope>(
  mapped: MappedError,
  handlers: ApplyMappedErrorHandlers<S>,
): void {
  if (mapped.message === null) return;                  // ABORTED → silent
  if (mapped.possiblyCommitted) handlers.onCommitted?.();
  if (mapped.transient)         handlers.onTransient?.();
  if (mapped.extras !== undefined) handlers.onExtras?.(mapped.extras as ScopeExtras<S>);
  handlers.onMessage?.(mapped.message);
}
```

**Contract:**

- Silent bail when `message === null` (no other callback fires).
- Otherwise fire `onCommitted` → `onTransient` → `onExtras` → `onMessage` in that order. The fixed ordering is part of the contract — consumers that do partial state writes inside `onCommitted` (refresh a list, navigate, clear a form) depend on those writes landing *before* the banner so the banner's wording is honest.
- All callbacks optional; missing callbacks are no-ops.
- Sync; no awaits anywhere in the helper. Awaited recovery flows (`handleCreateChapter`, `handleUpdateProjectTitle`, `handleRestore` post-[I4]) stay hand-rolled.
- The `S` generic flows through to `onExtras`, so the type-narrowed `extras` is the consumer-visible API.

The `as ScopeExtras<S>` cast inside the helper is the *one* place this cast lives. Consumer call sites no longer cast. The cast is justified because the mapper writes `extras` from the scope's `extrasFrom`, which already has the right shape — TypeScript just can't see it across the `Record<string, unknown>` boundary in `MappedError.extras`.

`onCommitted` deliberately takes no argument. Consumers already have `mapped` in scope. Passing the whole `mapped` would tempt consumers to read `.message` and skip `onMessage`, defeating the ordering contract.

### `ScopeExtras<S>` — `errors/scopeExtras.ts`

```ts
import type { SCOPES } from "./scopes";

type ScopeOf<S extends keyof typeof SCOPES> = (typeof SCOPES)[S];
type ExtrasFrom<S extends keyof typeof SCOPES> = ScopeOf<S>["extrasFrom"];

export type ScopeExtras<S extends keyof typeof SCOPES> =
  ExtrasFrom<S> extends (err: any) => infer R
    ? Exclude<R, undefined>
    : never;
```

For `S = "image.delete"`, `ScopeExtras<S>` resolves to `{ chapters: { title: string; trashed?: boolean }[] }`. For scopes without `extrasFrom`, `ScopeExtras<S> = never` — `onExtras` callback can never fire, which the type system enforces.

### `devWarn` — `errors/devWarn.ts`

```ts
export function devWarn(context: string, signal: AbortSignal, err: unknown): void {
  if (signal.aborted) return;
  if (import.meta.env?.DEV) console.warn(`${context}:`, err);
}
```

Used at two sites in 4b.3c (`handleStatusChange:1312`, `handleCreateChapter:788`); barrel-exported.

### Barrel update — `errors/index.ts`

Three new exports, no removed exports:

```ts
export { applyMappedError } from "./applyMappedError";
export type { ApplyMappedErrorHandlers } from "./applyMappedError";
export type { ScopeExtras } from "./scopeExtras";
export { devWarn } from "./devWarn";
```

## Scope Registry Tweaks

### [S8] `image.delete.extrasFrom` — drop the all-or-nothing reject

Current (`scopes.ts:312-342`):

1. Slice input to 51 candidates (cap+1, so the all-or-nothing check still fires at the cap boundary).
2. Validate each: `id?: string`, `title: string` with `trim().length > 0`, `trashed?: boolean`.
3. **All-or-nothing reject:** `if (valid.length !== candidates.length) return undefined;` ← **removed**.
4. `if (valid.length === 0) return undefined;` ← preserved.
5. Slice to 50, code-point-truncate titles to 200, return `{ chapters: bounded }`.

Rationale for dropping the all-or-nothing reject: the server contract is the authoritative defense against hostile envelopes; `scopes.ts` is the second line. Showing the user 49 valid chapter titles when the server returned 50 (one with a corrupted title) is materially better UX than the generic deleteBlocked fallback with no list. The cap+1 window still caps work at 51 elements; a hostile envelope of `[N valid, M bogus]` now truncates rather than rejects, which is the explicit accepted trade-off.

### [S3]/[S7] `chapter.save` terminal-codes relocation

Add `terminalCodes?: string[]` to `ScopeEntry`. Same shape as the existing `committedCodes` field, but signals "this byCode hit means the save loop must break and lock the editor without retrying" — the BAD_JSON/UPDATE_READ_FAILURE/CORRUPT_CONTENT triple.

Mapper plumbing: the `MappedError` type gains a `terminal: boolean` field; the byCode-match branch sets it from `scope.terminalCodes?.includes(err.code)`.

`useProjectEditor.handleSave` (lines 468-481) currently hardcodes:

```ts
if (isApiError(err) &&
    (err.code === "BAD_JSON" || err.code === "UPDATE_READ_FAILURE" || err.code === "CORRUPT_CONTENT")) {
  // build terminal, break out of retry loop
}
```

Post-migration, the dispatch reads `mapped.terminal` from `mapApiError(err, "chapter.save")`:

```ts
const mapped = mapApiError(err, "chapter.save");
if (mapped.terminal) {
  // build terminal from mapped.message + err.code/status, break
}
```

The allowlist now lives in `scopes.ts` next to the other `chapter.save` configuration. Adding a fourth terminal code is a single-line scope edit, not a consumer change.

## Consumer Migration Patterns

Three patterns cover all sites.

### Pattern P1: Simple ladder → `applyMappedError`

The most common shape (~22 sites). Before:

```ts
} catch (err) {
  const { message } = mapApiError(err, "chapter.load");
  if (message === null) return;
  if (message) setError(message);
}
```

After:

```ts
} catch (err) {
  applyMappedError(mapApiError(err, "chapter.load"), { onMessage: setError });
}
```

### Pattern P2: Ladder + sync recovery → `applyMappedError` with `onCommitted`/`onTransient`/`onExtras`

The ~6 sites that branch on `possiblyCommitted` / extras with synchronous recovery. Before:

```ts
} catch (err) {
  const { message, possiblyCommitted, extras } = mapApiError(err, "image.delete");
  if (message === null) return;
  if (possiblyCommitted) { /* sync recovery */ }
  if (extras) setReferences((extras as { chapters: … }).chapters);
  setError(message);
}
```

After:

```ts
} catch (err) {
  applyMappedError(mapApiError(err, "image.delete"), {
    onCommitted: () => { /* sync recovery */ },
    onExtras: ({ chapters }) => setReferences(chapters),
    onMessage: setError,
  });
}
```

### Pattern P3: Awaited recovery — stays hand-rolled

`handleCreateChapter` (line 742-792), `handleUpdateProjectTitle` (line 1167-1206), and the new [I4] `handleRestore` recovery branch all `await api.projects.get(...)` inside the committed branch. These stay hand-rolled with their own per-handler `useRef<AbortController>`. The helper is the wrong shape; the migration doesn't apply.

These sites still benefit from the phase via `devWarn` adoption ([S10]) and the inside-updater epoch re-check ([S20]).

## Per-Item Plan

### Foundation (4 commits)

1. `applyMappedError` + tests + barrel export.
2. `ScopeExtras<S>` type + tests (compile-time `expectTypeOf` + runtime).
3. `devWarn` + tests + barrel export.
4. `scopes.ts` [S8] tweak; test update.

### Scope refactor (2 commits)

5. Add `terminalCodes` field to `ScopeEntry`; mapper plumbing for `terminal: boolean` on `MappedError`.
6. Move `chapter.save` BAD_JSON/UPDATE_READ_FAILURE/CORRUPT_CONTENT allowlist from `useProjectEditor.ts:468-481` into `scopes.ts`; `handleSave` reads `mapped.terminal` ([S3]/[S7]).

### Behavioural fixes (~17 commits — each fix is one commit, preceded by a pinning-test commit where the catch does non-trivial work)

7-8. **[I3]** `SnapshotPanel.handleCreate` — pin behaviour; add `if (possiblyCommitted) { close form, clear label, refetch }` via `onCommitted` callback.

9-10. **[I4]** `useTrashManager.handleRestore` `possiblyCommitted` — pin; introduce `restoreRecoveryAbortRef` + `api.projects.get` + setProject + bulk reseed of `confirmedStatusRef` via a new `replaceConfirmedStatusesFromProject(refreshed)` exposed from `useProjectEditor` (mirrors the existing `seedConfirmedStatus(id, status)` for the bulk-reseed case).

11-12. **[I5]** `useTrashManager.confirmDeleteChapter` — pin "unexpected throw dismisses dialog silently"; route through `applyMappedError(mapApiError(err, "chapter.delete"), { onMessage: setActionError })` before dismiss. Preserves the CLAUDE.md "all user-visible API error messages flow through `mapApiError`" invariant even on the unexpected-throw path; ABORTED stays silent if a future refactor lets an ABORTED escape `handleDeleteChapter`.

13. **[S4]** `handleStatusChange` non-committed branch — fall back to `setError(message)` when `onError` is omitted (mirror `handleReorderChapters`). Single commit, no pinning needed (the dispatch is already covered by hook tests).

14-15. **[S5]** `restoreSnapshot` `dispatched` flag — pin: pre-send sync throw currently surfaces as committed-unreadable banner. Add flag immediately after `api.snapshots.restore(...)` returns:

```ts
let dispatched = false;
const { promise } = restoreOp.run((s) => {
  const p = api.snapshots.restore(snapshotId, s);
  dispatched = true;
  return p;
});
// ...
} catch (err) {
  if (isApiError(err)) return { ok: false, error: err };
  if (dispatched) return { ok: false, error: makeClientCommittedError() };
  throw err;  // pre-send bug — surface naturally
}
```

The fallthrough-throw means `restoreSnapshot`'s caller (in `EditorPage`) catches the original error; the snapshot.restore scope's `fallback` (`STRINGS.snapshots.restoreFailed`) becomes the banner copy via the caller's existing `mapApiError` dispatch. The previous lock-banner / cache-discard path stays the right behaviour for post-send throws (the `dispatched === true` branch), so CLAUDE.md save-pipeline invariant 3 is preserved.

16. **[S11]** `handleCreateChapter` 404 — pin "404 currently shows createChapterProjectGone banner and stays on the editor"; add `if (isNotFound(err)) { navigate("/"); return; }` at top of catch (mirror `EditorPage.tsx:1577-1579`). The `createChapterProjectGone` string stays in the scope as a defensive default for future call sites; the projects-list re-render is sufficient signal at this site.

17. **[S17]** `createRecoveryAbortRef` null-on-success — `if (createRecoveryAbortRef.current === recoveryController) createRecoveryAbortRef.current = null;` after the merge.

18. **[S19]** `restoreFollowupAbortRef` null-on-success. The original review target (`viewAbortRef` in `useSnapshotState.viewSnapshot`) was migrated to `viewOp` (a `useAbortableAsyncOperation`) during Phase 4b.3a.1's hook adoption; the hook owns the controller lifecycle. The same latent shape now applies to the surviving hand-rolled `restoreFollowupAbortRef` (`useSnapshotState.ts:198`, set inside `restoreSnapshot`'s success path at line 408-416, currently never nulled). Apply the same null-on-success pattern after the `.then((data) => …)` resolves.

19-20. **[S18]** `Editor.tsx` paste announcement — pin: same-project chapter switch fires success announcement on the now-torn-down editor instance (the existing `projectIdRef.current === uploadProjectId` guard catches cross-project but not same-project chapter switch). Fix by capturing `editorInstanceRef.current` at upload-start; gate announcement on `editor === editorInstanceRef.current`.

21. **[S20]** `handleReorderChapters` inside-updater re-check — inside both `setProject` updaters (success at `:1082-1091` and `possiblyCommitted` at `:1115-1124`), prepend `if (prev.id !== projectId) return prev;`. Defense-in-depth for the React-scheduling window between queueing the setState and the updater running.

22-23. **[S10]** `devWarn` adoption at `handleStatusChange:1312` and `handleCreateChapter:788` recovery catches — pin via `vi.spyOn(console, "warn")` that the warn fires on non-abort and stays silent on abort.

### Simple-ladder migrations (~16 commits, one per `handleX`/component method)

24. `useTrashManager` (openTrash, handleRestore non-committed, confirmDeleteChapter trash-refresh).
25. `useSnapshotState.viewSnapshot` (abort gate at line 334).
26. `useFindReplaceState.search` (line 237).
27. `useProjectEditor.loadProject` catch (line 332).
28. `useProjectEditor.handleSelectChapter` catch.
29. `useProjectEditor.reloadActiveChapter` catch.
30. `useProjectEditor.handleDeleteChapter` inner catches (lines 1031, 1048).
31. `useProjectEditor.handleReorderChapters` catch (non-committed message dispatch only; the committed setProject already handled by [S20]).
32. `useProjectEditor.handleStatusChange` catch tail (line 1337).
33. `useProjectEditor.handleRenameChapter` catch.
34. `SnapshotPanel.fetchSnapshots`, `handleDelete`.
35. `DashboardView` (lines 61, 83).
36. `ExportDialog` (lines 110, 173).
37. `EditorPage.handleSelectChapterWithFlush` (`chapter.flushBeforeNavigate` scope swap from [S16]) + remaining EditorPage ladder sites. Bundle the new scope addition with the swap.
38. `ImageGallery.handleDelete` — extras flows through `onExtras`; drops the `as { chapters: … }` cast at line 334-338.
39. `HomePage` ladder sites (lines 63, 121, 156).

### [S16] scope addition (bundled with commit 37)

Add `chapter.flushBeforeNavigate` to `scopes.ts`. Switch `EditorPage.tsx:1512` from `mapApiError(err, "chapter.load")` to the new scope. The current `chapter.load` use is wrong because the failure is a flush-on-navigate failure, not a load failure; the new scope's copy distinguishes the cases.

## Save-Pipeline Invariants

CLAUDE.md §Save-pipeline invariants 1-5 are load-bearing for this phase even though we don't touch `useEditorMutation`:

- **Invariant 1 (`markClean` before invalidating server call).** Untouched. `useEditorMutation` already enforces it for restore/replace; none of the new behavioural fixes introduce a new mutation-via-server flow that would need it.
- **Invariant 2 (`setEditable(false)` around fail-mid-typing mutations).** Untouched. The catches we migrate are recovery / non-editor paths.
- **Invariant 3 (cache-clear after server success).** Touched only by [S5]. The synthetic 200-BAD_JSON for non-`ApiRequestError` throws is what currently drives the lock-banner / cache-discard path. The `dispatched` flag preserves invariant 3: pre-send throws (now re-thrown) no longer hit the committed-error path, so they no longer trigger a misleading cache-discard. Post-send throws keep the existing path.
- **Invariant 4 (bump sequence before request).** Touched only by [S20]. The inside-updater `prev.id !== projectId` re-check is the React-scheduling complement to the existing seq-then-bump discipline; same intent.
- **Invariant 5 (error codes inside the allowlist).** Strictly preserved. Phase 4b.3c does not introduce any new HTTP status code. The only code-routing change is [S3]/[S7]'s relocation of the BAD_JSON/UPDATE_READ_FAILURE/CORRUPT_CONTENT allowlist from the consumer to the scope — server-emitted codes are unchanged.

The `applyMappedError` contract is itself an invariant. Once the helper lands and consumers migrate, the "silent on ABORTED, ordered side-effects-before-banner" rule is the single source of truth for consumer dispatch. Not added to CLAUDE.md in 4b.3c (deferred to 4b.3d by roadmap line 1067); contract is real from commit 1 onward. Phase 4b.4's raw-strings ESLint rule is the eventual lint-time enforcement; until then, review.

## Testing

### Foundation tests

- `applyMappedError.test.ts` — 8-10 cases: silent-on-null; onMessage fires last; ordered side-effects; missing callbacks are no-ops; `extras===undefined` doesn't fire `onExtras`; type-narrowing propagates to `onExtras` arg.
- `scopeExtras.test.ts` — compile-time type-test using `expectTypeOf`: `ScopeExtras<"image.delete">` → `{ chapters: { title; trashed? }[] }`; `ScopeExtras<"chapter.load">` → `never`.
- `devWarn.test.ts` — 3 cases: aborted signal returns silent; non-aborted + DEV-true calls console.warn with `"context: error"`; non-aborted + DEV-false stays silent. Tests use `vi.stubGlobal` / `import.meta.env` overrides; `vi.spyOn(console, "warn").mockImplementation(() => {})` per CLAUDE.md §Testing Philosophy zero-warnings rule.

### Pinning tests before each behavioural migration

Listed inline with the commit plan above. The discipline: each pinning-test commit reproduces the current (buggy or surprising) behaviour as an asserted test; the next commit flips the assertion and lands the fix. Reviewers can diff the test alone to see what changed.

### Three new e2e specs

1. `e2e/snapshot-create-recovery.spec.ts` — intercept `POST /api/chapters/:id/snapshots` with `page.route(...)` to return `200 {invalid:"json"}`, click Create Snapshot, assert (a) the create form closes, (b) the snapshot list refreshes and the new snapshot appears, (c) the committed banner displays.
2. `e2e/trash-restore-recovery.spec.ts` — soft-delete a chapter, intercept `POST /api/chapters/:id/restore` with `200 {invalid}`, click Restore, assert (a) chapter row leaves the trash, (b) sidebar shows the restored chapter, (c) status indicator reflects restored status (reseed happened), (d) committed banner displays.
3. **Chapter-create recovery** — intercept `POST /api/projects/:slug/chapters` with `200 {invalid}`, assert (a) the new chapter appears in the sidebar via the refresh path, (b) the newly-created chapter becomes the active chapter, (c) the committed banner displays. Default landing site: new file `e2e/chapter-create-recovery.spec.ts`. If, during writing-plans, the existing `e2e/editor-save.spec.ts` already has chapter-create scaffolding that can be reused with no extra setup, the test is added to that file instead — recorded as a plan-time decision, not a brainstorm-time fork.

### Coverage targets

CLAUDE.md §Testing Philosophy enforces 95% statements / 85% branches / 90% functions / 95% lines. Three new primitives with dedicated tests; the migrations don't add untested branches (they reduce existing untested branches by routing through the helper). Coverage should rise, not fall.

### Zero-warnings rule

CLAUDE.md §Testing Philosophy. `devWarn` tests use `vi.spyOn(console, "warn").mockImplementation(() => {})` and `.mockRestore()` per the established pattern; pinning tests for sites that legitimately fire `console.warn` in their catch (e.g., `useProjectEditor.handleSelectChapter:836`) do the same.

## Out of Scope

- Phase 4b.3b's signal-threading work (depended on by [S10]; landed 2026-05-25).
- Phase 4b.3d's CLAUDE.md updates and `ScopeExtras<S>` documentation.
- New API error codes or HTTP status codes (allowlist stays per CLAUDE.md §API Design).
- Re-running 4b.3a's review-follow-up sweep (different scope).
- The `useEditorMutation` invariant-pair helper (already lands per its own design doc; no change here).
- Editor State Machine work (Phase 4b.5).

## Definition of Done

- `applyMappedError`, `ScopeExtras<S>`, and `devWarn` land with full unit-test coverage (CLAUDE.md §Testing Philosophy).
- 11 behavioural items land with tests:
  - **Pinning-test-before-fix (8 items):** I3, I4, I5, S4, S5, S11, S18, S10. Pinning commit asserts current (buggy or surprising) behaviour; fix commit flips the assertion.
  - **Direct test (3 items):** S17, S19, S20 — mechanical / defense-in-depth changes. S17 and S19 are pinned by "ref is non-null after success" (before) → "ref is null after success" (after); S20's React-scheduling window is exercised by a focused unit test against the updater body rather than a flushSync-based round trip.
- The structural [S3]/[S7] terminal-codes relocation does not change observable behaviour; existing `handleSave` tests continue to pass and the move is verified by `chapter.save` scope-level assertions.
- All ~22 simple-ladder sites migrated to `applyMappedError`, one commit per `handleX`/component method.
- [S8] image.delete `extrasFrom` drops the all-or-nothing reject; test reflects the new behaviour.
- [S16] `chapter.flushBeforeNavigate` scope lives in `scopes.ts`; `EditorPage.tsx:1512` consumes it.
- [S10] `devWarn` adopted at both recovery catches; tests pin both warn-on-non-abort and silent-on-abort.
- [S18] paste-announcement instance-capture guard pinned by test.
- Three new e2e specs (or one addition + two new specs) cover the committed-recovery cycles.
- `make all` green; coverage at or above thresholds.

## CLAUDE.md

No edits in 4b.3c. Phase 4b.3d (`docs/roadmap.md:1055-1090`) is the explicit home for the `applyMappedError` / `committedCodes` / `ScopeExtras<S>` paragraph in §Key Architecture Decisions. This phase ships the primitives; the next phase documents them alongside the existing mapper documentation.

## Dependencies

- Phase 4b.3 (Unified API Error Mapper baseline + `committedCodes`).
- Phase 4b.3a (4b.3 review follow-ups, Clusters A/D/F).
- Phase 4b.3a.1 (`useAbortableAsyncOperation` — supplies the per-call `signal` that [S10] consumes).
- Phase 4b.3b (AbortSignal Threading Completion — landed 2026-05-25; the per-call signal threading [S10] relies on is in place).

## Decision Log References

- 2026-05-26 brainstorm: `applyMappedError` shape locked as **sync, void, fixed callback order** (option A of three).
- 2026-05-26 brainstorm: [S8] image.delete locked as **drop-only-malformed** (option 2 of three).
- 2026-05-26 brainstorm: [S15] cadence locked as **one commit per `handleX`/component method** (option b of three).
- 2026-05-26 brainstorm: [S5] flag placement locked as **inside-closure immediately after `api.snapshots.restore(...)` returns** (option α of three).
- 2026-05-26 brainstorm: [S20] re-check locked as **inside-updater `prev.id !== projectId` check on both success and committed `setProject`** (option i of three).
- 2026-05-26 brainstorm: [S19] resolved as **apply the null-on-success pattern to `restoreFollowupAbortRef`**; original target migrated to hook.
- 2026-05-26 brainstorm: [S11] locked as **`navigate("/"); return;` no banner** (option p of three).
- 2026-05-26 brainstorm: [I5] locked as **route through `mapApiError(err, "chapter.delete")`** (option s of two).
- 2026-05-26 brainstorm: [S10] locked as **`devWarn(context, signal, err)` helper in `errors/`** (option II of three).
- 2026-05-26 brainstorm: tests locked as **Vitest baseline + 3 new e2e specs for committed-recovery cycles** (option B of three).
- 2026-05-26 brainstorm: CLAUDE.md drift check — **no 4b.3c edits**; deferred to 4b.3d per roadmap.
