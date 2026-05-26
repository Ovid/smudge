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

1. `applyMappedError(mapped, handlers)` — dispatch helper. Pure function. Owns the "silent on null" contract, the callback ordering, and a `STOP` sentinel for early termination. No React, no awaits.
2. `MappedError<S>` / `mapApiError<S>` — the mapper output and entry point gain a phantom `S extends ApiErrorScope` so `S` flows from `mapApiError` through `applyMappedError`'s typed callbacks. `ScopeExtras<S>` then narrows extras to the registered scope's `extrasFrom` return without consumer casts.
3. `devWarn(context, signal, err)` — DEV+!aborted gated `console.warn` helper. Used at exactly two sites in this phase; barrel-exported so future recovery flows can pick it up without re-implementing.

**Phase split.** Per the 2026-05-26 pushback decision log, the original single-PR shape is split into three sub-phases to satisfy CLAUDE.md §Pull Request Scope:

- **4b.3c.1 — foundation + scope refactor + simple-ladder migrations** (4 foundation + 2 scope-refactor + 16 simple-ladder commits). Lands `applyMappedError` / `MappedError<S>` / `ScopeExtras<S>` / `devWarn` plus the [S3]/[S7] `terminalCodes` relocation and the [S8] `extrasFrom` tweak. Migrates the ~22 ladder sites mechanically against existing behaviour (no functional change at these sites). Spec 3 (chapter-create coverage backfill, framed as backfill).
- **4b.3c.2 — helper-consuming behavioural fixes** (I3, I5, S4, S10, S20, plus any remaining ladder sites). Picks up `onCommitted` / `onTransient` / `STOP` to land the behavioural fixes that newly route through them. Spec 1 (snapshot-create-recovery).
- **4b.3c.3 — independent behavioural fixes** (I4, S5, S11, S17, S18, S19, S8 UX semantic change, S16 new scope). Each touches a flow that doesn't depend on the helper landing. Spec 2 (trash-restore-recovery). [I4] additionally adds `useTrashManager.ts` to the `migrationStructuralCheck` allowlist with a justification block (its own commit, before the [I4] behavioural commit).

The three sub-phases are independently shippable; the dependency is only foundation → consumer (so 4b.3c.2 sequences after 4b.3c.1; 4b.3c.3 is independent of both and can land in parallel).

**Commit count.** ~42 commits across 8 files. 4 foundation, 2 scope refactor, 1 allowlist-update (new, for [I4]), 17 behavioural-with-pinning, 16 simple-ladder, 3 e2e specs. The single-PR framing in the original brainstorm is replaced by the three sub-phases above.

**Scope-registry tweaks** (~30-line diff in `scopes.ts`):

- **[S8]** `image.delete.extrasFrom` — drop the all-or-nothing `valid.length !== candidates.length` reject; keep the cap+1 input window; keep the `valid.length === 0` reject.
- **[S3]/[S7]** `chapter.save` — add a `terminalCodes` field to `ScopeEntry`; move the `BAD_JSON`/`UPDATE_READ_FAILURE`/`CORRUPT_CONTENT` allowlist from `useProjectEditor.ts:468-481` into the scope; mapper plumbing reads `terminal` from the mapped result.

The phase explicitly does **not** touch the API surface, server, or the existing mapper's main control flow.

## The Three Primitives

### `MappedError<S>` / `mapApiError<S>` phantom — `errors/apiErrorMapper.ts`

The mapper output and entry point gain a phantom type parameter so `S` flows from the `mapApiError` call site through `applyMappedError`. Without the phantom, `S` could only be inferred from `applyMappedError`'s `onExtras` parameter shape — a footgun that lets `mapApiError(err, "chapter.load")` get paired with an `onExtras: ({ chapters }) => ...` callback that compiles (TS infers `S = "image.delete"` to satisfy the destructure) but never fires at runtime.

```ts
export type MappedError<S extends ApiErrorScope = ApiErrorScope> = {
  message: string | null;
  possiblyCommitted: boolean;
  transient: boolean;
  extras?: Record<string, unknown>;
  // Phantom — no runtime field; carries S through the type system so
  // applyMappedError can require the same S on its handlers.
  readonly __scope?: S;
};

export function mapApiError<S extends ApiErrorScope>(
  err: unknown,
  scope: S,
): MappedError<S> {
  return _resolveErrorInternal(err, SCOPES[scope]) as MappedError<S>;
}
```

The phantom field is `readonly` + optional + never assigned at runtime, so existing destructured consumers (`const { message, possiblyCommitted, transient } = mapApiError(...)`) keep working unchanged. The default `S = ApiErrorScope` preserves the union type for any consumer that ignores the parameter.

### `applyMappedError` — `errors/applyMappedError.ts`

```ts
import type { MappedError } from "./apiErrorMapper";
import type { ApiErrorScope } from "./scopes";
import type { ScopeExtras } from "./scopeExtras";

/** Returned from a handler to halt subsequent callbacks. Mirrors the
 * pre-helper early-return pattern at sites where `possiblyCommitted`
 * recovery should suppress the extras/message branches (e.g.
 * ImageGallery.handleDelete's announce()). */
export const STOP = Symbol("applyMappedError.STOP");

export interface ApplyMappedErrorHandlers<S extends ApiErrorScope> {
  onMessage?: (message: string) => void | typeof STOP;
  onCommitted?: () => void | typeof STOP;
  onTransient?: () => void | typeof STOP;
  onExtras?: (extras: ScopeExtras<S>) => void | typeof STOP;
}

export function applyMappedError<S extends ApiErrorScope>(
  mapped: MappedError<S>,
  handlers: ApplyMappedErrorHandlers<S>,
): void {
  if (mapped.message === null) return;                  // ABORTED → silent
  if (mapped.possiblyCommitted) {
    if (handlers.onCommitted?.() === STOP) return;
  }
  if (mapped.transient) {
    if (handlers.onTransient?.() === STOP) return;
  }
  if (mapped.extras !== undefined) {
    if (handlers.onExtras?.(mapped.extras as ScopeExtras<S>) === STOP) return;
  }
  handlers.onMessage?.(mapped.message);
}
```

**Contract:**

- Silent bail when `message === null` (no other callback fires).
- Otherwise fire `onCommitted` → `onTransient` → `onExtras` → `onMessage` in that order. The fixed ordering is part of the contract — consumers that do partial state writes inside `onCommitted` (refresh a list, navigate, clear a form) depend on those writes landing *before* the banner so the banner's wording is honest.
- A callback may return `STOP` to halt subsequent callbacks. This restores the pre-helper early-return pattern (e.g. `ImageGallery.handleDelete` skipping its `extras` branch when `possiblyCommitted` is true and the committed copy is already announced).
- All callbacks optional; missing callbacks are no-ops.
- Sync; no awaits anywhere in the helper. Awaited recovery flows (`handleCreateChapter`, `handleUpdateProjectTitle`, `useTrashManager.handleRestore` post-[I4]) stay hand-rolled.
- The `S` generic on `MappedError<S>` ties the handlers' `onExtras` parameter to the same scope as the `mapApiError` call site that produced the input. Type-checked across the boundary; no consumer cast.

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

For `S = "image.delete"`, `ScopeExtras<S>` resolves to `{ chapters: { title: string; trashed?: boolean }[] }`. For scopes without `extrasFrom`, `ScopeExtras<S> = never` — `onExtras` callback can never fire, which the type system enforces. Combined with the `MappedError<S>` phantom, the wrong-scope footgun is structurally impossible:

```ts
// This now fails to type-check:
applyMappedError(mapApiError(err, "chapter.load"), {
  onExtras: ({ chapters }) => {}  // chapter.load has no extrasFrom; S = "chapter.load"; ScopeExtras<"chapter.load"> = never
});
```

### `devWarn` — `errors/devWarn.ts`

```ts
export function devWarn(context: string, signal: AbortSignal, err: unknown): void {
  if (signal.aborted) return;
  if (import.meta.env?.DEV) console.warn(`${context}:`, err);
}
```

Used at two sites in 4b.3c (`handleStatusChange:1312`, `handleCreateChapter:788`); barrel-exported.

### Barrel update — `errors/index.ts`

Four new exports, no removed exports:

```ts
export { applyMappedError, STOP } from "./applyMappedError";
export type { ApplyMappedErrorHandlers } from "./applyMappedError";
export type { ScopeExtras } from "./scopeExtras";
export { devWarn } from "./devWarn";
```

(`MappedError<S>` and `mapApiError<S>` are existing exports; the phantom parameter change is source-compatible.)

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

Add `terminalCodes?: string[]` to `ScopeEntry`. Same shape as the existing `committedCodes` field, but signals "this byCode hit means the save loop must break and lock the editor without retrying." `chapter.save`'s `terminalCodes` lists `UPDATE_READ_FAILURE` and `CORRUPT_CONTENT` — the 5xx codes where the byCode-match branch is the relevant path.

`BAD_JSON` is **not** in `terminalCodes`. The mapper's 2xx BAD_JSON branch returns early in `_resolveErrorInternal` (before byCode-matching), so `terminalCodes: ["BAD_JSON"]` would be dead. Instead, 2xx BAD_JSON sets `possiblyCommitted: true` via the existing scope.committed entry, and the consumer ORs both flags (see below).

Mapper plumbing: the `MappedError` type gains a `terminal: boolean` field; the byCode-match branch sets it from `scope.terminalCodes?.includes(err.code)`. Other branches (ABORTED, BAD_JSON 2xx, NETWORK, byStatus, fallback) set `terminal: false`.

`useProjectEditor.handleSave` (lines 468-481) currently hardcodes:

```ts
if (isApiError(err) &&
    (err.code === "BAD_JSON" || err.code === "UPDATE_READ_FAILURE" || err.code === "CORRUPT_CONTENT")) {
  // build terminal, break out of retry loop
}
```

Post-migration, the dispatch ORs the two scope-driven flags:

```ts
const mapped = mapApiError(err, "chapter.save");
// terminal: 5xx UPDATE_READ_FAILURE / CORRUPT_CONTENT (terminalCodes)
// possiblyCommitted: 2xx BAD_JSON (scope.committed) AND UPDATE_READ_FAILURE (committedCodes)
// Both signals mean "the save loop must break and lock the editor."
if (isApiError(err) && (mapped.terminal || mapped.possiblyCommitted)) {
  // build terminal from mapped.message + err.code/status, break
}
```

The OR is the documented bridge between terminal codes (no retry, server didn't commit cleanly) and committed codes (no retry, server may have committed). Both are "save loop terminates" from the consumer's perspective; the two scope fields encode the cause separately so future analytics or banners can distinguish them.

The allowlist now lives in `scopes.ts` next to the other `chapter.save` configuration. Adding a fourth terminal code (5xx with a server-emitted error code) is a single-line scope edit, not a consumer change.

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
  if (possiblyCommitted) { /* sync recovery */ ; return; }  // early return!
  if (extras?.chapters) announce(deleteBlocked(extras.chapters));
  else announce(message);
}
```

After — use `STOP` to preserve the early-return semantic where the consumer wants `possiblyCommitted` to suppress the extras/message announce:

```ts
} catch (err) {
  applyMappedError(mapApiError(err, "image.delete"), {
    onCommitted: () => {
      announce(committedMessage);
      setSelectedImage(null);
      setConfirmingDelete(false);
      incrementRefreshKey();
      return STOP;  // skip onExtras + onMessage; the committed banner is the user-visible signal
    },
    onExtras: ({ chapters }) => {
      announce(deleteBlocked(chapters));
      return STOP;  // extras-driven copy replaces the default message
    },
    onMessage: (msg) => announce(msg),
  });
}
```

The `STOP` returns make the early-return discipline visible at the call site, mirroring the pre-helper `if (possiblyCommitted) { ...; return; }` shape. Migrations of consumers that did NOT early-return omit the `STOP` and fire all matching callbacks in order.

### Pattern P3: Awaited recovery — stays hand-rolled

`handleCreateChapter` (line 742-792), `handleUpdateProjectTitle` (line 1167-1206), and the new [I4] `handleRestore` recovery branch all `await api.projects.get(...)` inside the committed branch. These stay hand-rolled with their own per-handler `useRef<AbortController>`. The helper is the wrong shape; the migration doesn't apply.

These sites still benefit from the phase via `devWarn` adoption ([S10]) and the inside-updater epoch re-check ([S20]).

## Per-Item Plan

Each commit is tagged with its sub-phase (`.1` / `.2` / `.3`). Sub-phases are independently shippable; 4b.3c.2 depends on 4b.3c.1's foundation, and 4b.3c.3 is independent of both.

### 4b.3c.1 — Foundation + scope refactor + simple-ladder migrations

**Foundation (4 commits)**

1. `MappedError<S>` phantom + `mapApiError<S>` parameterization in `errors/apiErrorMapper.ts`; existing destructured consumers unaffected. Tests cover the phantom propagation via `expectTypeOf`.
2. `applyMappedError` + `STOP` sentinel + tests + barrel export.
3. `ScopeExtras<S>` type + tests (compile-time `expectTypeOf` + runtime); negative test asserts `applyMappedError(mapApiError(err, "chapter.load"), { onExtras: ... })` fails to type-check.
4. `devWarn` + tests + barrel export.

**Scope refactor (2 commits)**

5. Add `terminalCodes` field to `ScopeEntry`; mapper plumbing for `terminal: boolean` on `MappedError`.
6. Move `chapter.save` BAD_JSON/UPDATE_READ_FAILURE/CORRUPT_CONTENT allowlist from `useProjectEditor.ts:468-481` into `scopes.ts`; `handleSave` reads `mapped.terminal` ([S3]/[S7]).

**[S8] scope tweak (1 commit)**

7. `scopes.ts` [S8] `image.delete.extrasFrom` — drop the all-or-nothing reject; test update.

**[S16] new scope (1 commit, separated from the ladder swap per pushback Issue 7-adjacent)**

8. Add `chapter.flushBeforeNavigate` to `scopes.ts` with its own copy. No call site swap in this commit.

**Simple-ladder migrations (~16 commits, one per `handleX`/component method)**

9. `useTrashManager` (openTrash, handleRestore non-committed, confirmDeleteChapter trash-refresh).
10. `useSnapshotState.viewSnapshot` (abort gate at line 334).
11. `useFindReplaceState.search` (line 237).
12. `useProjectEditor.loadProject` catch (line 332).
13. `useProjectEditor.handleSelectChapter` catch.
14. `useProjectEditor.reloadActiveChapter` catch.
15. `useProjectEditor.handleDeleteChapter` inner catches (lines 1031, 1048).
16. `useProjectEditor.handleStatusChange` catch tail (line 1337).
17. `useProjectEditor.handleRenameChapter` catch.
18. `SnapshotPanel.fetchSnapshots`, `handleDelete`.
19. `DashboardView` (lines 61, 83).
20. `ExportDialog` (lines 110, 173).
21. `EditorPage.handleSelectChapterWithFlush` — swap from `mapApiError(err, "chapter.load")` to `chapter.flushBeforeNavigate` ([S16] consumer swap) + remaining EditorPage ladder sites.
22. `ImageGallery.handleDelete` — extras flows through `onExtras`; drops the `as { chapters: … }` cast at line 329 (uses `STOP` to preserve the early-return semantics described in Pattern P2).
23. `HomePage` ladder sites (lines 63, 121, 156).
24. **E2e spec 3 — chapter-create recovery.** Coverage backfill against existing behaviour (no behavioural change in 4b.3c). Default landing site: new file `e2e/chapter-create-recovery.spec.ts`. If `e2e/editor-save.spec.ts` already has chapter-create scaffolding that can be reused with no extra setup, the test is added there instead — recorded as a plan-time decision, not a brainstorm-time fork.

### 4b.3c.2 — Helper-consuming behavioural fixes (5 fixes + 1 e2e spec)

Each behavioural fix is one commit preceded by a pinning-test commit (where the catch does non-trivial work). Items here all consume `applyMappedError` / `onCommitted` / `STOP` / `devWarn` and so depend on 4b.3c.1's foundation.

25-26. **[I3]** `SnapshotPanel.handleCreate` — pin behaviour; add `if (possiblyCommitted) { close form, clear label, refetch }` via `onCommitted` callback.

27. **[I5]** `useTrashManager.confirmDeleteChapter` — pin "unexpected throw dismisses dialog silently AND warn fires"; add `console.warn("confirmDeleteChapter programming-bug path:", err)` and a code comment naming the path as a programming-bug catch (handleDeleteChapter surfaces all API errors via `onError`). No mapper routing here — per the 2026-05-26 pushback decision, the bare catch is for genuine programming bugs, not API errors. Single commit (pin + fix bundled because the warn is the fix).

28. **[S4]** `handleStatusChange` non-committed branch — fall back to `setError(message)` when `onError` is omitted (mirror `handleReorderChapters`). Single commit, no pinning needed (the dispatch is already covered by hook tests).

29. **[S20]** `handleReorderChapters` inside-updater re-check — inside both `setProject` updaters (success at `:1082-1091` and `possiblyCommitted` at `:1115-1124`), prepend `if (prev.id !== projectId) return prev;`. Defense-in-depth for the React-scheduling window between queueing the setState and the updater running.

30-31. **[S10]** `devWarn` adoption at `handleStatusChange:1312` and `handleCreateChapter:788` recovery catches — pin via `vi.spyOn(console, "warn")` that the warn fires on non-abort and stays silent on abort. Signal source is the per-call `recoveryController.signal` from the inside-recovery `api.projects.get(...)`, NOT the primary mutation's signal.

32. `useProjectEditor.handleReorderChapters` catch ladder migration (non-committed message dispatch only; the committed setProject is already handled by [S20]). Bundled with .2 because [S20] also touches this handler.

33. **E2e spec 1 — `e2e/snapshot-create-recovery.spec.ts`.** Intercept `POST /api/chapters/:id/snapshots` with `page.route(...)` to return `200 {invalid:"json"}`, click Create Snapshot, assert (a) the create form closes, (b) the snapshot list refreshes and the new snapshot appears, (c) the committed banner displays.

### 4b.3c.3 — Independent behavioural fixes (8 fixes + 1 e2e spec)

These don't depend on 4b.3c.1's foundation landing first; the catches they touch don't consume `applyMappedError`. Can land in parallel with 4b.3c.1.

34. **[I4] allowlist update (separate commit, lands before [I4] behavioural fix).** Add `useTrashManager.ts` to the justified-survivor list in `packages/client/src/__tests__/migrationStructuralCheck.test.ts`. Add an inline justification block at the new ref site mirroring `useProjectEditor.ts:207-218`:

    > Phase 4b.3c decision matrix (2026-05-26 pushback): `restoreRecoveryAbortRef` is kept hand-rolled. It fires from the catch branch of `handleRestore`'s `possiblyCommitted` arm and runs a follow-up GET that must complete even after the primary `restoreOp` has auto-aborted (e.g. on the next `handleRestore` after a failed one). Routing this through `restoreOp` would cause the next restore to cancel the previous restore's recovery refresh — exactly the case where the previous error's user-visible state most needs the refresh to land. Phase 4b.4 replaces this file-level allowlist entry with inline `// eslint-disable-next-line` on the line below.

35-36. **[I4]** `useTrashManager.handleRestore` `possiblyCommitted` — pin; introduce `restoreRecoveryAbortRef` + `api.projects.get` + setProject + bulk reseed of `confirmedStatusRef` via a new `replaceConfirmedStatusesFromProject(refreshed)` exposed from `useProjectEditor` (mirrors the existing `seedConfirmedStatus(id, status)` for the bulk-reseed case).

37-38. **[S5]** `restoreSnapshot` `dispatched` flag — pin: pre-send sync throw currently surfaces as committed-unreadable banner. Add flag immediately after `api.snapshots.restore(...)` returns; pre-send branch returns `makeClientNetworkError` (existing helper at `useSnapshotState.ts:34`) rather than throwing:

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
  return { ok: false, error: makeClientNetworkError() };  // pre-send bug — banner via scope.network
}
```

The `makeClientNetworkError` route preserves the caller's existing branching (`result.error instanceof RestoreFailedError` matches; `mapApiError("snapshot.restore")` runs; `scope.network` copy — `STRINGS.snapshots.restoreNetworkFailed` — becomes the banner). Verify the scope's `network:` field is set during implementation. The previous lock-banner / cache-discard path stays the right behaviour for post-send throws (the `dispatched === true` branch), so CLAUDE.md save-pipeline invariant 3 is preserved. Slight framing inaccuracy (it wasn't really a network failure, it was a client bug pre-send), accepted as a trade-off against the alternative of a new sentinel class.

39. **[S11]** `handleCreateChapter` 404 — pin "404 currently shows createChapterProjectGone banner and stays on the editor"; add `if (isNotFound(err)) { navigate("/"); return; }` at top of catch (mirror `EditorPage.tsx:1577-1579`). The `createChapterProjectGone` string stays in the scope as a defensive default for future call sites; the projects-list re-render is sufficient signal at this site.

40. **[S17]** `createRecoveryAbortRef` null-on-success — `if (createRecoveryAbortRef.current === recoveryController) createRecoveryAbortRef.current = null;` after the merge.

41-42. **[S18]** `Editor.tsx` paste announcement — pin: same-project chapter switch fires success announcement on the now-torn-down editor instance (the existing `projectIdRef.current === uploadProjectId` guard catches cross-project but not same-project chapter switch). Fix by capturing `editorInstanceRef.current` at upload-start; gate announcement on `editor === editorInstanceRef.current`.

43. **[S19]** `restoreFollowupAbortRef` null-on-success. The original review target (`viewAbortRef` in `useSnapshotState.viewSnapshot`) was migrated to `viewOp` (a `useAbortableAsyncOperation`) during Phase 4b.3a.1's hook adoption; the hook owns the controller lifecycle. The same latent shape now applies to the surviving hand-rolled `restoreFollowupAbortRef` (`useSnapshotState.ts:198`, set inside `restoreSnapshot`'s success path at line 408-416, currently never nulled). Apply the same null-on-success pattern after the `.then((data) => …)` resolves.

44. **E2e spec 2 — `e2e/trash-restore-recovery.spec.ts`.** Soft-delete a chapter, intercept `POST /api/chapters/:id/restore` with `200 {invalid}`, click Restore, assert (a) chapter row leaves the trash, (b) sidebar shows the restored chapter, (c) status indicator reflects restored status (reseed happened), (d) committed banner displays.

## Save-Pipeline Invariants

CLAUDE.md §Save-pipeline invariants 1-5 are load-bearing for this phase even though we don't touch `useEditorMutation`:

- **Invariant 1 (`markClean` before invalidating server call).** Untouched. `useEditorMutation` already enforces it for restore/replace; none of the new behavioural fixes introduce a new mutation-via-server flow that would need it.
- **Invariant 2 (`setEditable(false)` around fail-mid-typing mutations).** Untouched. The catches we migrate are recovery / non-editor paths.
- **Invariant 3 (cache-clear after server success).** Touched only by [S5]. The synthetic 200-BAD_JSON for non-`ApiRequestError` throws is what currently drives the lock-banner / cache-discard path. The `dispatched` flag preserves invariant 3: pre-send throws (now routed through `makeClientNetworkError`, a 0/NETWORK synthetic) no longer hit the committed-error path, so they no longer trigger a misleading cache-discard — the banner reads as a network failure and the caller's normal failure-path bookkeeping applies. Post-send throws keep the existing 200-BAD_JSON path.
- **Invariant 4 (bump sequence before request).** Touched only by [S20]. The inside-updater `prev.id !== projectId` re-check is the React-scheduling complement to the existing seq-then-bump discipline; same intent.
- **Invariant 5 (error codes inside the allowlist).** Strictly preserved. Phase 4b.3c does not introduce any new HTTP status code. The only code-routing change is [S3]/[S7]'s relocation of the BAD_JSON/UPDATE_READ_FAILURE/CORRUPT_CONTENT allowlist from the consumer to the scope — server-emitted codes are unchanged.

The `applyMappedError` contract is itself an invariant. Once the helper lands and consumers migrate, the "silent on ABORTED, ordered side-effects-before-banner" rule is the single source of truth for consumer dispatch. Not added to CLAUDE.md in 4b.3c (deferred to 4b.3d by roadmap line 1067); contract is real from commit 1 onward. Phase 4b.4's raw-strings ESLint rule is the eventual lint-time enforcement; until then, review.

## Testing

### Foundation tests

- `apiErrorMapper.test.ts` — phantom-propagation additions: `expectTypeOf(mapApiError(err, "image.delete")).toEqualTypeOf<MappedError<"image.delete">>()` and equivalent for `"chapter.load"`.
- `applyMappedError.test.ts` — 10-12 cases: silent-on-null; onMessage fires last; ordered side-effects; missing callbacks are no-ops; `extras===undefined` doesn't fire `onExtras`; type-narrowing propagates to `onExtras` arg via `MappedError<S>` phantom; `STOP` from `onCommitted` skips `onExtras`+`onMessage`; `STOP` from `onExtras` skips `onMessage`; `STOP` from `onMessage` is a no-op (no later callbacks).
- `scopeExtras.test.ts` — compile-time type-test using `expectTypeOf`: `ScopeExtras<"image.delete">` → `{ chapters: { title; trashed? }[] }`; `ScopeExtras<"chapter.load">` → `never`. Negative test: pairing `mapApiError(err, "chapter.load")` with `{ onExtras: ... }` fails to type-check.
- `devWarn.test.ts` — 3 cases: aborted signal returns silent; non-aborted + DEV-true calls console.warn with `"context: error"`; non-aborted + DEV-false stays silent. Tests use `vi.stubGlobal` / `import.meta.env` overrides; `vi.spyOn(console, "warn").mockImplementation(() => {})` per CLAUDE.md §Testing Philosophy zero-warnings rule.

### Pinning tests before each behavioural migration

Listed inline with the commit plan above. The discipline: each pinning-test commit reproduces the current (buggy or surprising) behaviour as an asserted test; the next commit flips the assertion and lands the fix. Reviewers can diff the test alone to see what changed.

### Three new e2e specs (paired with their sub-phases per the phase split)

1. **`e2e/snapshot-create-recovery.spec.ts` — lands in 4b.3c.2 (commit 33).** Exercises [I3]. Intercept `POST /api/chapters/:id/snapshots` with `page.route(...)` to return `200 {invalid:"json"}`, click Create Snapshot, assert (a) the create form closes, (b) the snapshot list refreshes and the new snapshot appears, (c) the committed banner displays.
2. **`e2e/trash-restore-recovery.spec.ts` — lands in 4b.3c.3 (commit 44).** Exercises [I4]. Soft-delete a chapter, intercept `POST /api/chapters/:id/restore` with `200 {invalid}`, click Restore, assert (a) chapter row leaves the trash, (b) sidebar shows the restored chapter, (c) status indicator reflects restored status (reseed happened), (d) committed banner displays.
3. **Chapter-create recovery — lands in 4b.3c.1 (commit 24).** Coverage backfill against existing (unchanged in 4b.3c) behaviour. Intercept `POST /api/projects/:slug/chapters` with `200 {invalid}`, assert (a) the new chapter appears in the sidebar via the refresh path, (b) the newly-created chapter becomes the active chapter, (c) the committed banner displays. Default landing site: new file `e2e/chapter-create-recovery.spec.ts`. If, during writing-plans, the existing `e2e/editor-save.spec.ts` already has chapter-create scaffolding that can be reused with no extra setup, the test is added to that file instead — recorded as a plan-time decision, not a brainstorm-time fork.

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

Each sub-phase is independently shippable; "Done" applies per sub-phase.

### 4b.3c.1 — foundation + scope refactor + simple-ladder migrations

- `MappedError<S>` / `mapApiError<S>` phantom + `applyMappedError` + `STOP` + `ScopeExtras<S>` + `devWarn` land with full unit-test coverage (CLAUDE.md §Testing Philosophy).
- `ScopeExtras<S>` regression guard: pairing `mapApiError(err, "chapter.load")` with an `onExtras` callback narrows the callback's parameter to `never` (verified by an in-callback `expectTypeOf(e).toEqualTypeOf<never>()` assertion). The `@ts-expect-error`-over-a-no-op-callback form does NOT work because TS parameter contravariance accepts any callable when the expected parameter is `never`; the in-callback `expectTypeOf<never>` is the only structural guard (failure flips to a tsc error and a vitest typecheck error).
- The structural [S3]/[S7] terminal-codes relocation does not change observable behaviour; existing `handleSave` tests continue to pass and the move is verified by `chapter.save` scope-level assertions.
- [S8] `image.delete` `extrasFrom` drops the all-or-nothing reject; test reflects the new behaviour.
- [S16] `chapter.flushBeforeNavigate` scope lives in `scopes.ts`; `EditorPage.handleSelectChapterWithFlush` consumes it (commit 21).
- All ~16 simple-ladder sites migrated to `applyMappedError`, one commit per `handleX`/component method.
- E2e spec 3 (chapter-create recovery) lands as coverage backfill.
- `make all` green; coverage at or above thresholds.

### 4b.3c.2 — helper-consuming behavioural fixes

- 5 behavioural items land with tests:
  - **Pinning-test-before-fix (3 items):** I3, S10 (both sites). Pinning commit asserts current (buggy or surprising) behaviour; fix commit flips the assertion.
  - **Bundled pin+fix (1 item):** I5. The warn IS the fix; pinning and fix collapse to one commit.
  - **Direct test (2 items):** S4, S20 — S4 is mechanical (existing hook tests cover the dispatch); S20's React-scheduling window is exercised by a focused unit test against the updater body rather than a flushSync-based round trip.
- E2e spec 1 (snapshot-create-recovery) covers [I3]'s committed-recovery cycle.
- `make all` green; coverage at or above thresholds.

### 4b.3c.3 — independent behavioural fixes

- 7 behavioural items land with tests:
  - **Pinning-test-before-fix (4 items):** I4, S5, S11, S18. Pinning commit asserts current (buggy or surprising) behaviour; fix commit flips the assertion.
  - **Direct test (3 items):** S17, S19, S8 UX semantic. S17 and S19 are pinned by "ref is non-null after success" (before) → "ref is null after success" (after); S8 is covered by the scope test updated in 4b.3c.1 but verified end-to-end through the consumer here.
- `useTrashManager.ts` added to the `migrationStructuralCheck` allowlist with a justification block (own commit, before [I4] behavioural fix).
- E2e spec 2 (trash-restore-recovery) covers [I4]'s committed-recovery cycle.
- `make all` green; coverage at or above thresholds.

## CLAUDE.md

No edits in 4b.3c. Phase 4b.3d (`docs/roadmap.md:1055-1090`) is the explicit home for the `applyMappedError` / `committedCodes` / `ScopeExtras<S>` paragraph in §Key Architecture Decisions. This phase ships the primitives; the next phase documents them alongside the existing mapper documentation.

**Known deferred drift (per 2026-05-26 /roadmap step-7 review).** CLAUDE.md §Save-Pipeline Invariants Rule 4 currently says "three justified-survivor files (HomePage.tsx, useProjectEditor.ts, useSnapshotState.ts)". Phase 4b.3c.3 adds `useTrashManager.ts` to the `migrationStructuralCheck` allowlist, making it four. The CLAUDE.md wording update is **deferred to Phase 4b.3d** per user decision (2026-05-26) — Phase 4b.3d already absorbs the `applyMappedError` / `MappedError<S>` paragraph, and bundling the count-and-file-list update with that work keeps CLAUDE.md edits to a single PR. Between 4b.3c.3 merging and 4b.3d merging, the test file is the source of truth; CLAUDE.md will be temporarily out of date.

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
- 2026-05-26 brainstorm: [I5] locked as **route through `mapApiError(err, "chapter.delete")`** (option s of two). **Superseded 2026-05-26 pushback (Issue 5, option B):** the bare catch is for genuine programming bugs (handleDeleteChapter surfaces all API errors via `onError`); drop mapper routing; add `console.warn` + naming comment instead.
- 2026-05-26 brainstorm: [S10] locked as **`devWarn(context, signal, err)` helper in `errors/`** (option II of three).
- 2026-05-26 brainstorm: tests locked as **Vitest baseline + 3 new e2e specs for committed-recovery cycles** (option B of three).
- 2026-05-26 brainstorm: CLAUDE.md drift check — **no 4b.3c edits**; deferred to 4b.3d per roadmap.

### 2026-05-26 pushback resolutions

- **Issue 1 (option A):** [I4] adds `useTrashManager.ts` to `migrationStructuralCheck` allowlist with justification block; allowlist update lands as its own commit before the [I4] behavioural fix in 4b.3c.3.
- **Issue 2 (option B):** Phase 4b.3c splits into three sub-phases (4b.3c.1 foundation + scope refactor + simple-ladder; 4b.3c.2 helper-consuming behaviourals; 4b.3c.3 independent behaviourals). Roadmap will be updated to reflect the split.
- **Issue 3 (option B):** [S5] pre-send branch returns `makeClientNetworkError` (no caller change; banner via existing `mapApiError("snapshot.restore")` + `scope.network` path) rather than fallthrough-throwing.
- **Issue 4 (option A):** `MappedError<S>` and `mapApiError<S>` gain a phantom `S` parameter so the scope flows through `applyMappedError`'s typed callbacks; eliminates the silent-wrong-scope footgun.
- **Issue 5 (option B):** [I5] drops mapper routing; the bare catch is named as a programming-bug path (`console.warn` + comment); pinning test asserts both dismiss and warn.
- **Issue 6 (option A):** `applyMappedError` gains a `STOP` sentinel return semantic; callbacks may return `STOP` to halt subsequent callbacks, restoring the early-return pattern (e.g. `ImageGallery.handleDelete`'s `possiblyCommitted`-skip-extras shape).
- **Issue 7 (option A):** Three new e2e specs are paired with their behavioural-fix sub-phases: spec 1 → 4b.3c.2, spec 2 → 4b.3c.3, spec 3 (chapter-create coverage backfill) → 4b.3c.1.
