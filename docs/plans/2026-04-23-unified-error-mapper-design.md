# Phase 4b.3: Unified API Error Mapper — Design

**Version:** 0.1.0
**Date:** 2026-04-23
**Author:** Ovid / Claude (collaborative)
**Phase:** 4b.3 (roadmap row ref)
**Dependencies:** Phase 4b (merged 2026-04-19). Independent of 4b.1 and 4b.2.

---

## 1. Overview & Motivation

Phase 4b.3 promotes the `findReplaceErrors.ts` pattern (already-consolidated code→UI-string mapping) into a single app-wide module, and migrates every other error site onto it.

### Problem

Today, API-error-to-UI-string translation happens in three shapes:

1. **Already consolidated** (`findReplaceErrors.ts`, plus a weaker form in `useSnapshotState.ts`). Correct, but *each site is independently correct* — they duplicate identical cross-cutting rules (ABORTED → silent, 2xx BAD_JSON → "possibly committed", NETWORK → connection copy) and will drift over time.
2. **Generic single-string fallbacks** (~20 sites in `HomePage`, `useProjectEditor`, `useTrashManager`, `DashboardView`, `EditorPage`). No code discrimination — a 413 "chapter too large" and a 500 both show the same "Failed to save" message, so the writer doesn't know what to do next.
3. **Raw server text leaking to the UI** (`ImageGallery.tsx` ×3, `ExportDialog.tsx`, `Editor.tsx`). These interpolate `err.message` directly, violating both CLAUDE.md §String externalization and the "no raw server text" contract.

### Goal

One declarative registry of scopes maps `(ApiRequestError, scope) → { message, possiblyCommitted, transient, extras? }`. Cross-cutting rules live in a single resolver. Every call site routes through it. Raw `err.message` leaks are deleted as part of the migration.

### Non-goals

- No changes to the server error envelope (already defined; CLAUDE.md §API Design).
- No restructuring of `strings.ts` itself (Phase 4b.4's territory).
- No new lint rule enforcing the pattern (Phase 4b.4).
- No user-visible behavior changes. Writers see the same copy they see today; it just stops drifting.

### Success measure

A reviewer scanning `packages/client/src/` for `err.message`, `err instanceof Error ? ... :`, `"Unknown error"`, or hand-rolled code ladders finds zero. Every mutation-triggered error message in the app can be traced to one line in one registry.

---

## 2. Core Contract: `MappedError` and the Resolver

The public surface is one function and one type.

```ts
// packages/client/src/errors/apiErrorMapper.ts

export type MappedError = {
  /** UI string from strings.ts, or null when the error should be silently ignored
   *  (e.g. ABORTED / seq-stale). Null is the silent signal — never "". */
  message: string | null;
  /** True when the server may have committed despite the client failing to
   *  read the response (2xx BAD_JSON). Callers must lock the editor rather
   *  than just showing a toast — the on-screen content may be stale. */
  possiblyCommitted: boolean;
  /** True when the failure is transient (NETWORK). Callers that can retry
   *  in place (e.g. keep the user in snapshot view) use this instead of
   *  inspecting err.code. */
  transient: boolean;
  /** Structured payload from the server envelope. Currently used for
   *  IMAGE_IN_USE's `chapters: [...]`. Absent when the scope doesn't
   *  declare an extrasFrom. */
  extras?: Record<string, unknown>;
};

export function mapApiError(err: unknown, scope: ApiErrorScope): MappedError;
```

### Resolver algorithm

Single code path. This is the anti-drift machinery:

```
1. If err is not an ApiRequestError     → { message: scope.fallback,
                                             possiblyCommitted: false, transient: false }
2. If err.code === "ABORTED"            → { message: null,
                                             possiblyCommitted: false, transient: false }
3. If err.code === "BAD_JSON" && 2xx    → { message: scope.committed ?? scope.fallback,
                                             possiblyCommitted: scope.committed !== undefined,
                                             transient: false }
4. If err.code === "NETWORK"            → { message: scope.network ?? scope.fallback,
                                             possiblyCommitted: false, transient: true }
5. If scope.byCode[err.code] defined    → { message: scope.byCode[err.code],
                                             possiblyCommitted: false, transient: false,
                                             extras: scope.extrasFrom?.(err) }
6. If scope.byStatus[err.status] defined→ { message: scope.byStatus[err.status],
                                             possiblyCommitted: false, transient: false,
                                             extras: scope.extrasFrom?.(err) }
7. Otherwise                             → { message: scope.fallback,
                                             possiblyCommitted: false, transient: false,
                                             extras: scope.extrasFrom?.(err) }
```

### Key invariants enforced by the single code path

- **Aborted errors are always silent.** No scope can accidentally show one.
- **2xx BAD_JSON is `possiblyCommitted: true` when the scope declares `committed:` copy; otherwise `false`.** Mutation scopes opt in to the committed-UX contract by declaring `committed:`; read scopes (GETs) have no committed state, so a 2xx with an unreadable body is not a "possibly committed" write. A scope author who forgets to declare `committed:` for a mutation will correctly get `possiblyCommitted: false` (and the generic fallback copy) rather than a misleading "your save may have gone through" on a read — the cost is a less-ideal mutation UX until the scope is completed, not a silent lock miss.
- **NETWORK is always `transient: true`.** Callers that can retry in place detect transience by a field, not by inspecting `err.code`.
- **Network errors use scope-specific network copy if declared, else the scope's generic fallback.** No bare "Network error" in the UI.
- **`extras` is only computed when the scope declares an `extrasFrom`.** Typos in server envelope shape can't leak through.
- **`byCode` beats `byStatus`.** Code is the more specific discriminator (`VALIDATION_ERROR` at 400 is not the same as `INVALID_REGEX` at 400).

### Testability

The resolver is a pure function over `(ApiRequestError, ScopeEntry)`. Every scope × every relevant (code, status) pair is a table-driven Vitest case. No DOM, no fetch mock, no component render.

---

## 3. Scope Registry

`ApiErrorScope` is a typed literal union; `SCOPES` is `Record<ApiErrorScope, ScopeEntry>` so TypeScript enforces every scope has an entry.

```ts
type ScopeEntry = {
  /** Required. Shown when no code/status override matches, and as the
   *  fallback for NETWORK/BAD_JSON when the scope doesn't override those. */
  fallback: string;
  /** Optional. Shown when err.code === "BAD_JSON" on a 2xx response.
   *  Always paired with possiblyCommitted:true. */
  committed?: string;
  /** Optional. Shown when err.code === "NETWORK". */
  network?: string;
  /** Optional. code → message. Higher priority than byStatus. */
  byCode?: Partial<Record<string, string>>;
  /** Optional. status → message. */
  byStatus?: Partial<Record<number, string>>;
  /** Optional. Pulls server envelope extras off the error for the caller. */
  extrasFrom?: (err: ApiRequestError) => Record<string, unknown> | undefined;
};

type ApiErrorScope =
  | 'project.load'     | 'project.create'   | 'project.delete'  | 'project.updateTitle'
  | 'project.velocity'
  | 'chapter.load'     | 'chapter.save'     | 'chapter.create'  | 'chapter.delete'
  | 'chapter.rename'   | 'chapter.reorder'  | 'chapter.updateStatus'
  | 'chapterStatus.fetch'
  | 'image.upload'     | 'image.delete'     | 'image.updateMetadata'
  | 'snapshot.restore' | 'snapshot.view'    | 'snapshot.list'
  | 'snapshot.create'  | 'snapshot.delete'
  | 'findReplace.search' | 'findReplace.replace'
  | 'export.run'
  | 'trash.load'       | 'trash.restoreChapter'
  | 'settings.get'     | 'settings.update'
  | 'dashboard.load';
```

### Representative entries

Abridged — the full registry covers every code the server emits for each scope. These four illustrate the four common shapes (generic fallback only, status override, byCode + extras, full combination).

```ts
const SCOPES: Record<ApiErrorScope, ScopeEntry> = {
  'chapter.save': {
    fallback: STRINGS.editor.saveFailed,
    network:  STRINGS.editor.saveFailed,  // reuses existing "check connection" copy
    byStatus: { 413: STRINGS.editor.saveFailedTooLarge },
    byCode:   { VALIDATION_ERROR: STRINGS.editor.saveFailedInvalid },
  },
  'image.delete': {
    fallback: STRINGS.imageGallery.deleteFailedGeneric,   // new string (see §6)
    byCode:   { IMAGE_IN_USE: STRINGS.imageGallery.deleteBlockedInUse },
    extrasFrom: (err) => {
      const chapters = (err.extras as { chapters?: unknown })?.chapters;
      return Array.isArray(chapters) ? { chapters } : undefined;
    },
  },
  'snapshot.restore': {
    fallback:  STRINGS.snapshots.restoreFailed,
    network:   STRINGS.snapshots.restoreNetworkFailed,
    committed: STRINGS.snapshots.restoreResponseUnreadable,
    byCode: {
      [SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT]:        STRINGS.snapshots.restoreFailedCorrupt,
      [SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF]: STRINGS.snapshots.restoreFailedCrossProjectImage,
    },
    byStatus: { 404: STRINGS.snapshots.restoreFailedNotFound },
  },
  'findReplace.replace': {
    fallback:  STRINGS.findReplace.replaceFailed,
    network:   STRINGS.findReplace.replaceNetworkFailed,
    committed: STRINGS.findReplace.replaceResponseUnreadable,
    byCode: {
      [SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED]: STRINGS.findReplace.tooManyMatches,
      [SEARCH_ERROR_CODES.REGEX_TIMEOUT]:      STRINGS.findReplace.searchTimedOut,
      [SEARCH_ERROR_CODES.INVALID_REGEX]:      STRINGS.findReplace.invalidRegex,
      [SEARCH_ERROR_CODES.CONTENT_TOO_LARGE]:  STRINGS.findReplace.contentTooLarge,
      [SEARCH_ERROR_CODES.SCOPE_NOT_FOUND]:    STRINGS.findReplace.replaceScopeNotFound,
      VALIDATION_ERROR:                        STRINGS.findReplace.invalidReplaceRequest,
    },
    byStatus: { 404: STRINGS.findReplace.replaceProjectNotFound },
  },
  // ... all other scopes
};
```

### New `strings.ts` entries

Additive only (Phase 4b.4 owns restructuring):

- `STRINGS.imageGallery.uploadFailedGeneric` — fixed string replacing templated `uploadFailed(reason)`.
- `STRINGS.imageGallery.deleteFailedGeneric` — fixed string replacing templated `deleteFailed(reason)`.
- `STRINGS.error.possiblyCommitted` — shared default for scopes that don't override `committed`. Draft copy: "The server may have completed the change, but the response could not be read. Reload to confirm." (Final copy to be confirmed during implementation.)

The two templated `(reason: string) => …` image strings are deleted once all callers migrate — they're the vector for the `err.message` leak.

---

## 4. Transport Changes

Two small changes to `packages/client/src/api/client.ts` unify the error flow so the mapper doesn't need to know about special cases.

### 4a. Extend `ApiRequestError` with `extras` (plus a shared-types widening)

Two edits are needed: the client-side class gains an `extras` field, and the shared envelope type gains an index signature so TypeScript acknowledges what the server has always actually emitted.

**Shared types edit (`packages/shared/src/types.ts:55-60`):**

```ts
// Before
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// After
export interface ApiError {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;          // NEW — server already emits extras like `chapters`;
                                     // the type finally acknowledges it.
  };
}
```

The server routes that ship `chapters: [...]` on 409 (e.g. `packages/server/src/images/images.routes.ts:175-181`) already populate the envelope loosely; this edit closes the gap between what the type says and what the server emits. No server-side code changes.

**Client-side class (`packages/client/src/api/client.ts`):**

```ts
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly extras?: Record<string, unknown>,  // NEW
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}
```

Inside `apiFetch()`, capture any envelope fields beyond `code` and `message` on non-2xx responses. With the index-signature widening in place, the spread is now type-safe:

```ts
const body = (await res.json()) as ApiError;
message = body.error?.message ?? message;
code = body.error?.code;
// NEW: stash any other fields the envelope carries (e.g. chapters, details)
const { code: _c, message: _m, ...rest } = body.error ?? {};
const extras = Object.keys(rest).length ? (rest as Record<string, unknown>) : undefined;
```

Scopes opt in via `extrasFrom`. Scopes that don't declare one get `extras: undefined` — no risk of a caller accidentally trusting data from a scope that didn't validate it.

**Cross-package note.** Because this edits `@smudge/shared`, both `server` and `client` workspaces rebuild on this commit. The change is additive (index signature widens, doesn't remove fields), so no existing server or client code breaks.

### 4b. Remove the DELETE special case

Today, `deleteImage` catches 409 and returns `{ ok: false, code: "IMAGE_IN_USE", chapters }` instead of throwing. With `extras` on the thrown error, the special case is unnecessary:

```ts
// Before
async deleteImage(id) {
  const res = await fetch(...);
  if (res.status === 409) {
    const body = await res.json();
    return { ok: false as const, code: body.error?.code, chapters: body.error?.chapters };
  }
  // ... normal throw path
}

// After
async deleteImage(id) {
  return apiFetch(`/api/images/${id}`, { method: 'DELETE' });  // throws on 409 like everything else
}
```

`ImageGallery.tsx` becomes:

```ts
try {
  await api.images.delete(id);
  // success path
} catch (err) {
  const { message, extras } = mapApiError(err, 'image.delete');
  if (message && extras?.chapters) {
    showInUseDialog(message, extras.chapters as Array<{ id: string; title: string }>);
  } else if (message) {
    announce(message);
  }
}
```

### What's not changing

- **Server untouched.** No envelope change; `chapters` continues to ship in the 409 body. Only the client's interpretation shifts.
- **Existing 409 tests.** Server-side integration tests are unchanged. Client-side tests that asserted the old 409-return shape become tests that assert the new throw shape (same data, different delivery).
- **Atomic rollout.** The transport change and the `ImageGallery.handleDelete` migration land in the same commit (§8 commit 2) so there is no intermediate state where a 409 response would bypass the "in use by chapters" dialog and fall through to a raw-message toast.

---

## 5. Migrating the Already-Centralized Sites

Two existing modules disappear. Their tests migrate to the unified mapper.

### 5a. `findReplaceErrors.ts` → deleted

The file's two exports (`mapSearchErrorToMessage`, `mapReplaceErrorToMessage`) become two scope entries (`findReplace.search`, `findReplace.replace`) in the registry. Call sites change shape but not behavior:

```ts
// Before (useFindReplaceState.ts)
const message = mapSearchErrorToMessage(err);
if (message) setError(message);

// After
const { message } = mapApiError(err, 'findReplace.search');
if (message) setError(message);
```

`findReplaceErrors.test.ts` is rewritten as `apiErrorMapper.test.ts` cases under the two scope keys. Every existing assertion survives. `SEARCH_ERROR_CODES` stays in `@smudge/shared` as the source of code strings for `byCode`.

### 5b. `useSnapshotState.ts`'s `RestoreFailureReason` / `ViewFailureReason` enums → deleted (failure arm only)

This is the trickier migration. Two separate concerns live in the hook today, and **only the failure-arm reason enum disappears**. The success-arm metadata is orthogonal and stays.

**What the hook owns today (after 4b.2):**

```ts
type RestoreResult =
  | { ok: true; staleChapterSwitch?: boolean; restoredChapterId?: string }
  | { ok: false; reason: RestoreFailureReason };

type ViewResult =
  | { ok: true; superseded?: "chapter" | "sameChapterNewer" }
  | { ok: false; reason: ViewFailureReason };
```

The success-arm fields (`staleChapterSwitch`, `restoredChapterId`, `superseded`) are **supersede metadata**, not error classifications. `EditorPage` uses them to decide whether to reload, exit snapshot view, or keep the editor disabled after a *successful* server call where the client-side state has since moved on. Recent commits (8ae123b, a2d0f09, 894f0ac) landed this separation specifically, and the regression tests from Phase 4b.2 rely on it.

**What changes.** Only the failure arm is migrated. The reason enum goes away; the failure shape becomes a carried `ApiRequestError`:

```ts
type RestoreResult =
  | { ok: true; staleChapterSwitch?: boolean; restoredChapterId?: string }
  | { ok: false; error: ApiRequestError };

type ViewResult =
  | { ok: true; superseded?: "chapter" | "sameChapterNewer" }
  | { ok: false; error: ApiRequestError };
```

The hook still handles abort/stale-sequence silently (that's a success-path concern: a superseded/aborted request is not a user-facing failure). It still classifies `superseded` on the success arm. It stops owning error-string mapping on the failure arm.

**New caller shape in `EditorPage`:**

```ts
const result = await snapshots.restoreSnapshot(id);
if (result.ok) {
  // Handle supersede metadata as today (staleChapterSwitch, restoredChapterId)
  // — unchanged from post-4b.2 behavior.
  return;
}
const { message, possiblyCommitted, transient } = mapApiError(result.error, 'snapshot.restore');
if (!message) return;                             // silent (ABORTED — shouldn't happen for failure arm, but defensive)
if (possiblyCommitted) {
  setEditorLockedMessage(message);                // editor stays read-only
  return;
}
if (transient) {
  setActionError(message);                        // stay in snapshot view; user can retry
  return;
}
setActionError(message);
exitSnapshotView();                               // all other classified failures exit view
```

Identical structure for `handleSnapshotView` with `'snapshot.view'` scope. The success-arm `superseded` check continues to run before any mapper call — exactly as it does today.

**What this collapses.** `RestoreFailureReason` and `ViewFailureReason` enums (and the multi-branch if/else-if ladders in `EditorPage` that mapped reason → string) disappear. The failure-arm UI branches become structural (`possiblyCommitted`, `transient`, `message`) and share the same field names as every other caller in the app. `ViewSupersededReason` and the success-arm metadata fields are untouched.

---

## 6. Migrating Generic Fallbacks and Raw-Message Leaks

Roughly 30 call sites. Each is mechanical once the registry exists. Organized by file.

### Generic-fallback sites (use the scope's fallback, plus code/status overrides as declared)

- **`HomePage.tsx`** (3 sites): `project.load`, `project.create`, `project.delete`.
- **`useProjectEditor.ts`** (10 sites): chapter load/create/delete/rename, project load, reorder chapters, update title, status change, chapter status fetch.
- **`useTrashManager.ts`** (2 sites): `trash.load`, `trash.restoreChapter`.
- **`DashboardView.tsx`** (1 site): `dashboard.load`. Promise `.catch` becomes `catch (err) { const { message } = mapApiError(err, 'dashboard.load'); ... }`.
- **`DashboardView.tsx` velocity fetch** (1 site, line ~61): `project.velocity`. Currently collapsed into the dashboard load; gets its own scope since `STRINGS.velocity.loadError` copy already exists.
- **`EditorPage.tsx`** (3 misc sites): `chapterStatus.fetch`, `chapter.load` (switch-chapter recovery), `project.load` (project fetch recovery). Plus the snapshot-restore branch covered in §5b and the existing `mapReplaceErrorToMessage` calls covered in §5a.
- **`SnapshotPanel.tsx`** (3 sites): `snapshot.list` (line ~121), `snapshot.create` (line ~255), `snapshot.delete` (line ~272).
- **`useTimezoneDetection.ts`** (2 sites): `settings.get`, `settings.update` on first-launch timezone detection.
- **`ProjectSettingsDialog.tsx`** (1 site, line ~192): `settings.update` for the timezone save.

### Audit subtask (part of the plan)

Before calling the migration complete, grep `packages/client/src/` for every `await api.*`, `api.*.then`, and `.catch(` in non-test code. Every site must either:
- route through `mapApiError(err, scope)`, or
- have documented silent-error semantics (e.g. a telemetry-only log that deliberately surfaces nothing to the UI).

This is a blocking step in the plan — no scope may be silently dropped.

Standard shape for each:

```ts
// Before: setError(STRINGS.error.someGenericFailed);
const { message } = mapApiError(err, '<scope>');
if (message) setError(message);
```

These now discriminate by status/code where appropriate — e.g. `project.delete` surfaces the right copy on 404 vs 500.

### Raw-message leak fixes (`err.message` interpolations that CLAUDE.md explicitly bans)

- **`ImageGallery.tsx` upload catch** (lines 128-131):
  ```ts
  // Before: const reason = err instanceof Error ? err.message : "Unknown error"; announce(S.uploadFailed(reason));
  const { message } = mapApiError(err, 'image.upload');
  if (message) announce(message);
  ```
- **`ImageGallery.tsx` delete catch** (lines 215-218): `image.delete` scope; extras carry the in-use chapters list (§4b).
- **`ImageGallery.tsx` save catch** (lines 162-165): uses `image.updateMetadata` scope; already a fixed string.
- **`ExportDialog.tsx`** (line 150): `err.message` disappears; `mapApiError(err, 'export.run')`.
- **`Editor.tsx` image upload from editor** (line 260): `mapApiError(err, 'image.upload')`.

### What does not change

- `useEditorMutation`'s `MutationResult` discriminated union (Phase 4b.1 territory; its stages are orthogonal to error-string classification — callers still pattern-match on stage, then ask the mapper for the string).
- `useAbortableSequence`'s silent-stale behavior (orthogonal — ABORTED errors are one of several ways a stale response is discarded).
- Any server code.

---

## 7. Testing Strategy

Three test layers, each with a distinct purpose.

### Layer 1 — Unit tests for the resolver (`apiErrorMapper.test.ts`)

Pure-function, table-driven. No React, no fetch, no DOM.

```ts
describe('mapApiError', () => {
  describe('cross-cutting rules (apply to every scope)', () => {
    it.each(ALL_SCOPES)('ABORTED is silent for %s', (scope) => { ... });
    it.each(ALL_SCOPES)('2xx BAD_JSON flags possiblyCommitted for %s', (scope) => { ... });
    it.each(ALL_SCOPES)('NETWORK flags transient for %s', (scope) => { ... });
    it.each(ALL_SCOPES)('non-ApiRequestError falls through to scope.fallback for %s', (scope) => { ... });
  });

  describe('chapter.save', () => {
    it('413 → saveFailedTooLarge', () => { ... });
    it('400 VALIDATION_ERROR → saveFailedInvalid', () => { ... });
    it('500 → saveFailed (fallback)', () => { ... });
  });

  describe('image.delete', () => {
    it('409 IMAGE_IN_USE → deleteBlockedInUse with chapters extras', () => { ... });
    it('409 IMAGE_IN_USE with malformed extras → deleteBlockedInUse, extras undefined', () => { ... });
    // ...
  });
  // ... one describe per scope
});
```

`ALL_SCOPES` is `Object.keys(SCOPES) as ApiErrorScope[]` — ensures new scopes automatically pick up cross-cutting coverage.

### Layer 2 — Call-site unit tests

Every migrated catch block (in `useProjectEditor`, `useFindReplaceState`, `useSnapshotState`, `ImageGallery`, `ExportDialog`, etc.) already has tests. They're updated to:

- assert the correct scope is passed to `mapApiError`,
- assert the caller reacts correctly to `message`, `possiblyCommitted`, `transient`, and `extras`.

No new coverage to design — just edits.

### Layer 3 — Snapshot regressions from the 2026-04-20 review

Phase 4b's 2026-04-20 review identified three Critical finding shapes: stale `expectedChapterId` skip, 2xx BAD_JSON on replace, 2xx BAD_JSON on restore. Each becomes (or stays, if already present) a regression test asserting:

- `mapApiError` returns `possiblyCommitted: true` for the 2xx BAD_JSON cases,
- `EditorPage` locks the editor (not just toasts) on those results,
- the lock banner remains visible until the user acts.

Phase 4b.5 (Editor State Machine) will later tighten these into compile-time invariants; this phase leaves them as runtime tests but *centralizes* the classification logic they depend on.

### Zero-warnings rule

All migrated catch blocks that currently `console.warn(err)` (HomePage, useProjectEditor) are touched by this PR. Logging behavior stays the same; any test that newly triggers a code path previously silent must spy-and-suppress per CLAUDE.md §Testing Philosophy.

### Coverage impact

- The resolver should land at 100% statements/branches — it's tiny and table-driven.
- The scope registry is data (no branches), measured but uninteresting.
- Net effect on client coverage is positive: previously-untested inline `catch` branches gain explicit tests.

---

## 8. File Layout & Rollout

### File layout

New top-level `errors/` directory under `packages/client/src/`, not buried in `utils/`. Signals that error mapping is a load-bearing module.

```
packages/client/src/
  errors/
    apiErrorMapper.ts          # mapApiError() + MappedError + ApiErrorScope + resolver
    apiErrorMapper.test.ts     # resolver + registry tests
    scopes.ts                  # SCOPES: Record<ApiErrorScope, ScopeEntry>
    index.ts                   # public exports: mapApiError, MappedError, ApiErrorScope
  api/
    client.ts                  # ApiRequestError gains `extras`; deleteImage special-case removed
  utils/
    findReplaceErrors.ts       # DELETED
    findReplaceErrors.test.ts  # DELETED (contents migrate into apiErrorMapper.test.ts)
```

The `scopes.ts` / `apiErrorMapper.ts` split keeps the resolver (~40 lines of disciplined logic) separate from the registry (~150 lines of data). Review focuses on the logic; the registry grows linearly with new API surfaces.

### Rollout order — one PR, five commits

Aligns with CLAUDE.md §Pull Request Scope: one feature, one phase. The order is chosen so each commit passes `make all` in isolation with no user-visible regression, even mid-stack.

1. **New module (unused).** Add `errors/apiErrorMapper.ts`, `scopes.ts`, `index.ts`, tests. Full scope registry in one commit. No call sites wired up yet — the module compiles, tests pass, nothing uses it. Safe intermediate state.
2. **Transport change + `ImageGallery` migration (atomic).** Widen `@smudge/shared`'s `ApiError` with an index signature. Add `extras` to `ApiRequestError` and capture envelope extras in `apiFetch`. Remove the `deleteImage` DELETE special case. **In the same commit**, migrate `ImageGallery.handleDelete` to the throw-based contract + `mapApiError(err, 'image.delete')` (extras carries the in-use chapters list). Update `api-client.test.ts` to assert the new throw shape and `ImageGallery.test.tsx` to the new mock shape. This commit is the contract change and its only load-bearing caller together — no intermediate state where `ImageGallery` is half-migrated.
3. **Migrate the centralized-already sites.** Delete `findReplaceErrors.ts`, migrate `useFindReplaceState`. In `useSnapshotState`, collapse `RestoreFailureReason` / `ViewFailureReason` to a carried `ApiRequestError` on the failure arm; preserve the success-arm `staleChapterSwitch` / `restoredChapterId` / `superseded` fields untouched. Migrate `EditorPage.handleRestoreSnapshot` + `handleSnapshotView` to branch on MappedError fields. Run the three 2026-04-20 Critical regression tests green.
4. **Migrate generic-fallback sites.** `HomePage` (project), `useProjectEditor` (10 sites), `useTrashManager`, `DashboardView` (dashboard + velocity), `EditorPage`'s misc catches, `SnapshotPanel` (list/create/delete), `useTimezoneDetection` + `ProjectSettingsDialog` (settings).
5. **Kill remaining raw-message leaks.** `ImageGallery.handleUpload` and `ImageGallery.updateMetadata`, `ExportDialog`, `Editor.tsx`. Remove the templated `uploadFailed(reason)` / `deleteFailed(reason)` strings from `strings.ts`; add `uploadFailedGeneric` / `deleteFailedGeneric`. (`ImageGallery.handleDelete` already landed in commit 2.)

Each commit passes `make all` on its own. After commit 1, the module exists but is unused — safe intermediate state. After commit 2, the transport contract is uniform (every non-2xx throws) and the only caller that cared about the old shape has been updated atomically. After commits 3–5, every call site routes through the mapper.

### Phase-boundary rule

Phase 4b.3 is one PR. No bundling with 4b.4 (ESLint rule) or 4b.5 (state machine). The raw-`err.message` kills in commit 5 are part of 4b.3 because they're call-site migrations, not lint enforcement.

---

## 9. CLAUDE.md Updates

Two sections of `CLAUDE.md` are edited as part of this phase. Both land in the same PR as the mapper.

### 9a. §Key Architecture Decisions — new entry (after §Save-pipeline invariants)

The save-pipeline-invariants section already documents `useEditorMutation` and `useAbortableSequence` as canonical paths. `mapApiError` deserves the same treatment — otherwise the next feature author will write a hand-rolled error ladder and the drift starts again.

Proposed text:

> **Unified API error mapping.** All client code that surfaces a user-visible message from an API error must route through `mapApiError(err, scope)` in `packages/client/src/errors/`. The mapper returns `{ message, possiblyCommitted, transient, extras? }`; it is the single owner of code/status-to-string translation and of the cross-cutting rules (ABORTED is silent, 2xx BAD_JSON is `possiblyCommitted`, NETWORK is `transient`). Raw `err.message` must never reach the UI. New API surfaces add a scope entry to `scopes.ts`; they do not write ad-hoc ladders at call sites. This invariant will be enforced by ESLint in Phase 4b.4; until then, it is enforced by review.

### 9b. §Target Project Structure — `errors/` directory

The current client listing (`components/, hooks/, pages/, api/, strings.ts`) is updated to include the new top-level directory:

```
  client/       # React SPA, components/, hooks/, pages/, api/, errors/, strings.ts
```

Small edit; keeps the project-structure map accurate so Phase 4b.4 / 4b.5 / 4c authors know where error mapping lives.

### What's not edited

No changes to §API Design (no new endpoints or error codes), §Data Model, §Testing Philosophy (existing zero-warnings and coverage rules cover the mapper), §Accessibility, §Visual Design, or §Pull Request Scope.

---

## 10. Risks

1. **Snapshot migration is the load-bearing one.** Phase 4b bundled snapshots + find/replace and took 16 rounds of review because save-pipeline invariants were applied inconsistently. Collapsing `RestoreFailureReason` / `ViewFailureReason` into MappedError-field branches changes the *shape* of error handling in `EditorPage` — even though behavior should be identical. The success-arm supersede metadata is specifically preserved (recent commits 8ae123b, a2d0f09, 894f0ac depend on it) — the migration affects only the failure arm.
   - **Mitigation:** commit 3 is reviewed independently; the three Critical regression tests from 2026-04-20 run green before the PR goes up; commit 3 is the smallest commit that can be reverted in isolation if post-merge issues surface.

2. **`ApiRequestError.extras` is `Record<string, unknown>`.** Any caller that reaches into extras without going through a scope's `extrasFrom` loses type safety.
   - **Mitigation:** `extrasFrom` is the only documented way to read extras; reviewers reject direct `err.extras` access in call sites. Phase 4b.4's lint rule can add this as an explicit ban.

3. **Scope sprawl.** 20 scopes today; more added per phase.
   - **Mitigation:** the registry is data — low review cost. If sprawl becomes unwieldy, scopes can be grouped by resource in separate files (`scopes/chapter.ts`, `scopes/image.ts`) without changing the resolver contract. Not doing that upfront per YAGNI.

4. **Test coverage thresholds.** The migration touches `useProjectEditor` (currently ~85% branch coverage in the 10 catch blocks); several untested branches become tested.
   - **Mitigation:** no regression expected, but the migration commit (4) is verified against the 85% branches / 95% lines floor before merging.

---

## 11. Open Items for the Plan

Not blocking the design; flagged for the writing-plans step.

- **`ALL_SCOPES` constant for tests.** Derive as `Object.keys(SCOPES) as ApiErrorScope[]` to avoid duplication; declared in `errors/index.ts`.
- **`STRINGS.error.possiblyCommitted` copy.** Draft ("The server may have completed the change, but the response could not be read. Reload to confirm.") to be confirmed during implementation.

---

## 12. Definition of Done

Directly from the roadmap entry, restated as verifiable criteria:

- [ ] Only `packages/client/src/errors/apiErrorMapper.ts` owns API-error → UI-string translation. `findReplaceErrors.ts` is deleted; `useSnapshotState.ts` no longer classifies *errors* (success-arm supersede metadata — `staleChapterSwitch`, `restoredChapterId`, `superseded` — is preserved untouched).
- [ ] No call site in `packages/client/src/` contains inline error-to-text mapping (no `err instanceof ApiRequestError ? ... : ...`, no hand-rolled code ladders, no `err.message` reaching the UI).
- [ ] All strings emitted by the mapper come from `packages/client/src/strings.ts`.
- [ ] Transport: `@smudge/shared`'s `ApiError` has the `[key: string]: unknown` index signature; `ApiRequestError` carries `extras`; the `deleteImage` DELETE special case is removed; `api/client.ts` throws uniformly on non-2xx. The transport change and `ImageGallery.handleDelete` migration land in the same commit.
- [ ] Regression tests from the 2026-04-20 review pass (stale `expectedChapterId` skip; 2xx BAD_JSON on replace; 2xx BAD_JSON on restore) and assert the mapper's `possiblyCommitted` output drives the editor lock.
- [ ] `make all` green: lint + format + typecheck + coverage (95%/85%/90%/95% floors) + e2e.
- [ ] Zero noisy `console.warn` / `console.error` in test output (spy-and-suppress per CLAUDE.md §Testing Philosophy).
- [ ] CLAUDE.md §Key Architecture Decisions includes the "Unified API error mapping" entry; §Target Project Structure lists `errors/` under `client/`. Both edits land in the same PR.
- [ ] No user-visible behavior change.
