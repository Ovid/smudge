# Phase 4b.15: Inline Title-Editing Hook — Design

**Date:** 2026-06-01
**Phase:** 4b.15 (roadmap `docs/roadmap.md`)
**Branch:** `inline-title-editing-hook`
**Status:** Design approved

## Goal

Extract the inline edit/cancel/commit state machine shared by
`useChapterTitleEditing` and `useProjectTitleEditing` into one canonical
`useInlineTitleEditing` hook, reducing the two existing hooks to thin
adapters. The two hooks are ~85% line-by-line identical (105 + 119 lines,
same refs, same lifecycle, same gates); bug fixes today require synchronized
edits across two files and tests on one path do not cover the other.

The slug-drift check and post-save `navigate` are load-bearing in the project
hook and intentionally absent from the chapter hook (chapters have no slug).
The extraction preserves those differences as opt-in callbacks.

## Why a design for an extraction

The wrappers' external signatures and return shapes are pinned by two
forces: their existing unit tests (which must pass unmodified per the DoD)
and the `EditorPage.tsx` call sites that destructure their return objects.
The extraction is therefore purely internal — the wrappers stay
byte-compatible at their boundary. The only genuine design decisions are
(a) the shape of the shared hook and (b) how to reconcile two incidental
asymmetries between the two hooks' cancel-on-change effects.

## Current-state analysis

### Common structure (the machine to extract)

Both hooks share:

- State: `editing: boolean`, `draft: string`.
- Refs: `inputRef`, `escapePressedRef`, `isSavingRef`, `prevIdRef`.
- A `useEffect` keyed on the entity id that cancels editing when the entity
  changes (skipping the initial `undefined → first id` transition).
- `start()`: bail if no entity, reset escape sentinel, clear error, seed the
  draft from the entity title, enter edit mode, `setTimeout(() =>
  inputRef.current?.select(), 0)`.
- `save()`: re-entry latch → escape-pressed exit → empty/no-entity exit →
  (project-only drift bail) → busy/locked gates bail → trim-and-compare
  no-op skip → `await` the save → keep edit mode open on failure → on
  success set the escape sentinel and exit edit mode; `finally` clears the
  latch.
- `cancel()`: set escape sentinel, exit edit mode.

### Genuine, load-bearing differences (preserved as opt-ins)

1. **Slug-drift check (project only).** `if (project.slug !== slug) return;`
   runs after the empty check and before the busy/locked gates. Detects the
   window where the URL slug has advanced ahead of loaded project state and
   refuses to PATCH, keeping edit mode open. Chapters have no slug and omit
   this. → exposed as `options.driftCheck?: () => boolean` (true ⇒ bail).

2. **Post-save navigate (project only).** On success, if the returned slug
   differs from the current URL slug, `navigate(\`/projects/${newSlug}\`,
   { replace: true })`. → exposed as `options.onAfterSave?: (result) => void`.

3. **Save-result / failure-detection shape.**
   - Chapter: `handleRenameChapter(id, title, onError?)` returns
     `Promise<void>`; failure is signaled by the `onError` callback firing.
     The chapter hook owns `titleError` state internally and sets it from
     `onError`.
   - Project: `handleUpdateProjectTitle(title)` returns
     `Promise<string | undefined>`; `undefined` means failure, a string is
     the new slug. The error message is owned externally (set inside
     `handleUpdateProjectTitle` in `useProjectEditor`); the project hook only
     *clears* it on edit-start via the injected `setProjectTitleError`.

   These unify cleanly by generalizing the project's `T | undefined`
   contract: the shared `save` returns `Promise<T | undefined>` where
   `undefined` means "keep edit mode open" and any defined `T` means success
   (and triggers `onAfterSave`). The chapter adapter returns `true` on
   success / `undefined` when `onError` fired. The discriminator is strict
   `=== undefined`, never falsiness, so a defined-but-falsy result would
   still count as success (not relevant here — slugs are non-empty and the
   chapter sentinel is `true`).

### Incidental asymmetries (DECISION: normalize to the union)

Two differences in the cancel-on-entity-change effect look intentional but
are almost certainly incidental:

- **`isSaving` latch reset.** The *project* effect resets
  `isSavingProjectTitleRef.current = false` on project change; the *chapter*
  effect does **not** reset `isSavingTitleRef` on chapter change.
- **Error clearing on entity change.** The *chapter* effect clears
  `titleError` on chapter change; the *project* effect does **not** clear its
  (externally-owned) error on project change.

A single shared effect cannot preserve both asymmetries without
re-introducing per-caller boolean flags, which would defeat the extraction.

**Decision (approved 2026-06-01): normalize to the union.** The shared
effect resets the saving latch AND calls `clearError?.()` on entity change,
for both callers. Both additions are strictly safety-positive:

- Resetting the latch on entity switch can only *prevent* a stuck latch; it
  cannot cause a stale save because `escapePressedRef` is also set in the
  same effect, which makes the next `save()` bail before any mutation.
- Clearing a stale title error when the entity switches is correct UX.

Net behavior change vs today: the chapter path gains the latch reset; the
project path gains error-clear-on-switch. This deliberately amends the
phase's "no behavior change" Definition of Done; each newly-added behavior
is pinned by a characterization test.

## The shared hook

`packages/client/src/hooks/useInlineTitleEditing.ts`

```ts
import { useState, useRef, useEffect } from "react";

export interface InlineTitleGates {
  isActionBusy: () => boolean;
  isEditorLocked: () => boolean;
}

export interface InlineTitleOptions<T> {
  // true ⇒ bail and keep edit mode open (project slug-drift window)
  driftCheck?: () => boolean;
  // runs on success only, with the defined save result
  onAfterSave?: (result: T) => void;
  // called on edit-start AND on entity-change (the normalization)
  clearError?: () => void;
}

export interface InlineTitleEditing {
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  start: () => void;
  save: () => Promise<void>;
  cancel: () => void;
}

export function useInlineTitleEditing<T>(
  currentId: string | undefined,
  currentTitle: string | undefined,
  // undefined return ⇒ failure (keep edit mode open); defined ⇒ success
  save: (id: string, title: string) => Promise<T | undefined>,
  gates: InlineTitleGates,
  options?: InlineTitleOptions<T>,
): InlineTitleEditing;
```

### Behavior contract

- `gates` is **required** (both `isActionBusy` and `isEditorLocked`). A test
  double or future caller that omitted a gate would silently disable a
  load-bearing save-pipeline guard (this is why the existing hooks take the
  predicates as required positional args, per their S7 note).
- `start()`: returns early if `currentId`/`currentTitle` is undefined; resets
  the escape sentinel; calls `options.clearError?.()`; seeds `draft` from
  `currentTitle`; enters edit mode; `setTimeout(() =>
  inputRef.current?.select(), 0)`.
- `save()` ordering (identical to both hooks today):
  1. if the saving latch is set, return;
  2. if the escape sentinel is set, exit edit mode and return;
  3. if no `currentId` or `draft.trim()` is empty, exit edit mode and return;
  4. if `options.driftCheck?.()` is true, return (keep edit mode open);
  5. if `gates.isActionBusy()` or `gates.isEditorLocked()`, return (keep open);
  6. set the latch; in `try`: compute `trimmed`; if `trimmed === currentTitle`
     skip the mutation; else `const result = await save(currentId, trimmed)`
     and if `result === undefined` return (keep open) else
     `options.onAfterSave?.(result)`; set the escape sentinel; exit edit mode;
     `finally` clears the latch.
- `cancel()`: set the escape sentinel; exit edit mode.
- Entity-change effect (keyed on `currentId`, skipping the initial
  `undefined → first id`): set the escape sentinel, reset the saving latch,
  exit edit mode, call `options.clearError?.()`.

### Memoization constraint (pushback Finding 2)

The shared hook returns **plain per-render closures** for `start` and
`save`. Do **not** wrap them in `useCallback`. Both current hooks rely on
fresh-closure-per-render to read the latest `draft`, entity, `gates`, and
`options` (notably `driftCheck`); a `useCallback` with an incomplete
dependency array — easy to write, since `gates`/`options` are fresh objects
each render — would capture a stale `draft` or stale `driftCheck` and
silently save the wrong text or skip the drift bail. The `useState` setter
`setDraft` and the `inputRef` are already stable; no return value needs
memoization. These callbacks are not passed to memoized children, so there
is no stability benefit to trade against the staleness risk.

## The two wrappers

Both keep their **exact** existing signatures and return shapes — verified
against the wrapper tests and the `EditorPage.tsx` destructures.

### `useChapterTitleEditing`

```ts
export function useChapterTitleEditing(
  activeChapter: Chapter | null,
  handleRenameChapter: (id, title, onError?) => Promise<void>,
  isActionBusy: () => boolean,
  isEditorLocked: () => boolean,
) {
  const [titleError, setTitleError] = useState<string | null>(null);
  const inline = useInlineTitleEditing<true>(
    activeChapter?.id,
    activeChapter?.title,
    async (id, title) => {
      let failed = false;
      await handleRenameChapter(id, title, (m) => {
        setTitleError(m);
        failed = true;
      });
      return failed ? undefined : true;
    },
    { isActionBusy, isEditorLocked },
    { clearError: () => setTitleError(null) },
  );
  return {
    editingTitle: inline.editing,
    titleDraft: inline.draft,
    setTitleDraft: inline.setDraft,
    titleError,
    titleInputRef: inline.inputRef,
    startEditingTitle: inline.start,
    saveTitle: inline.save,
    cancelEditingTitle: inline.cancel,
  };
}
```

### `useProjectTitleEditing`

```ts
export function useProjectTitleEditing(
  project: ProjectWithChapters | null,
  slug: string | undefined,
  handleUpdateProjectTitle: (title: string) => Promise<string | undefined>,
  setProjectTitleError: (error: string | null) => void,
  navigate: (path, options?) => void,
  isActionBusy: () => boolean,
  isEditorLocked: () => boolean,
) {
  const inline = useInlineTitleEditing<string>(
    project?.id,
    project?.title,
    (_id, title) => handleUpdateProjectTitle(title),
    { isActionBusy, isEditorLocked },
    {
      driftCheck: () => !!project && project.slug !== slug,
      onAfterSave: (newSlug) => {
        if (newSlug !== slug) navigate(`/projects/${newSlug}`, { replace: true });
      },
      clearError: () => setProjectTitleError(null),
    },
  );
  return {
    editingProjectTitle: inline.editing,
    projectTitleDraft: inline.draft,
    setProjectTitleDraft: inline.setDraft,
    projectTitleInputRef: inline.inputRef,
    startEditingProjectTitle: inline.start,
    saveProjectTitle: inline.save,
    cancelEditingProjectTitle: inline.cancel,
  };
}
```

Note: `driftCheck` guards on `project` being present so a null project (the
no-entity case already handled by step 3 of `save()`) cannot throw. The
existing project hook reaches the `project.slug !== slug` check only after
the `!project` guard, so `!!project && …` is faithful.

## Testing

Red-green-refactor throughout (CLAUDE.md §Testing Philosophy).

1. **Characterization first.** Confirm the existing `useChapterTitleEditing`
   and `useProjectTitleEditing` test files pin the load-bearing differences
   (slug drift, post-save navigate, failure-keeps-open, gates, escape, no-op
   skip, cancel-on-change). They already do; add any missing case before
   touching the hooks. **Specifically add a project no-op characterization
   test** (pushback Finding 1): the chapter suite has a no-op-skip test but
   the project suite does not, and the shared hook now centralizes the
   trim-and-compare skip. Assert that when `projectTitleDraft` equals the
   current title, `handleUpdateProjectTitle` is *not* called, `navigate` is
   *not* called (no spurious navigation via `onAfterSave`), and edit mode
   exits. Land this before the extraction.

2. **New `useInlineTitleEditing.test.ts`** exercises the machine directly:
   start/cancel/save happy paths; each bail path (latch, escape, empty,
   drift, busy, locked); no-op skip when `trimmed === currentTitle`; success
   path runs `onAfterSave(result)`; `undefined` result keeps edit mode open;
   cancel-on-id-change; and the two normalized behaviors — latch reset on
   id-change and `clearError` called on id-change.

3. **Both existing wrapper test files pass unmodified.**

4. **Two new wrapper-layer normalization tests:** one chapter-wrapper test
   pinning the now-present latch reset on chapter change, and one
   project-wrapper test pinning the now-present `setProjectTitleError(null)`
   on project change.

Coverage floors (95% statements, 85% branches, 90% functions, 95% lines)
must hold or rise; zero test-output warnings (client console spies only via
`expectConsole()`).

## CLAUDE.md review (step 7)

Neither title hook is referenced in CLAUDE.md, and this extraction introduces
no new invariant, endpoint, error code, table, test layer, or top-level
folder. Expected outcome: **no CLAUDE.md change required.** This will be
re-confirmed against the final design during the roadmap step-7 check.

Pushback Finding 3 considered whether the new shared hook (now the single
owner of the title-PATCH busy/lock gate) warrants a CLAUDE.md mention for
discoverability. Decision: **defer to step 7, leaning toward no change** —
the gate is pre-existing and undocumented, and adding a doc entry for a pure
internal-dedup phase expands scope without a strong need.

## Out of scope

- Extending the hook to non-title inline editing.
- Changing keyboard semantics, cancel-on-escape, or trim-before-compare
  behavior (beyond the two approved normalizations).
- Migrating any other dialog/modal hook (that is Phase 4b.16).
- Bundling Phase 4b.16 into the same PR.

## Definition of Done (amended)

- One canonical `useInlineTitleEditing` hook with unit tests.
- Two thin wrappers around it; the slug-drift check and post-save navigate
  remain load-bearing in the project wrapper.
- All existing title-editing wrapper tests green **without modification**.
- Two incidental asymmetries deliberately normalized to the safety-positive
  union (latch reset + error-clear on entity change), each pinned by a new
  test. This amends the original "no behavior change visible to the user"
  line: the two changes are not user-visible in normal use (they only affect
  stuck-latch and stale-error edge cases on entity switch).
- `make all` green at PR close.

## Dependencies

Independent of other 4b.X phases. Should land before any new title-style
inline editing surface (none currently planned).
