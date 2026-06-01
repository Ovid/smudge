---
date: 2026-06-01
phase: "Phase 4b.15: Inline Title-Editing Hook"
model: claude-opus-4-8
design_file: docs/plans/2026-06-01-inline-title-editing-hook-design.md
plan_file: docs/plans/2026-06-01-inline-title-editing-hook-plan.md
pushback:
  total: 3
  critical: 0
  important: 2
  minor: 1
alignment:
  total: 1
  critical: 0
  important: 0
  minor: 1
---

# Phase 4b.15: Inline Title-Editing Hook — Decision Log

## Pushback Findings

### [1] Project test suite has no no-op characterization test
- **Severity:** Important
- **Category:** Omission
- **Summary:** The chapter title hook's tests pin the "unchanged title fires no mutation" no-op path, but the project hook's tests do not. The extraction centralizes the trim-and-compare no-op skip in the shared hook, and the project's `onAfterSave` (the `navigate`) must not fire on a no-op edit. Without a project no-op test, a regression that ran `onAfterSave` on an unchanged title (spurious navigation) would slip through.
- **Resolution:** fixed-in-design — added a "project no-op characterization test" requirement to the design's testing section (assert no `handleUpdateProjectTitle`, no `navigate`, edit mode exits), landing before the extraction; realized as Task 1 in the plan.

### [2] No guard against memoizing the extracted callbacks
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** Both current hooks define `save`/`start` as plain per-render closures, so they always read the latest `draft`, entity, gates, and options. A maintainer extracting into a reusable hook could wrap the returned callbacks in `useCallback` "for stability"; with an incomplete dependency array (easy, since `gates`/`options` are fresh objects each render) the callback would capture a stale `draft` or stale `driftCheck` and silently save the wrong text or skip the drift bail — the exact class of save-pipeline bug the project is sensitive to.
- **Resolution:** fixed-in-design — added an explicit "plain per-render closures; do not `useCallback`-wrap save/start" constraint to the design. (Later anchored in the shipped hook code per alignment Finding 1.)

### [3] CLAUDE.md discoverability of the new shared hook
- **Severity:** Minor
- **Category:** Omission
- **Summary:** CLAUDE.md documents the canonical save-pipeline-adjacent client hooks (`useEditorMutation`, `useAbortableSequence`, `useAbortableAsyncOperation`). The title hooks gate title PATCHes on `isActionBusy`/`isEditorLocked` and the extraction creates one canonical owner of that gate — a natural documentation anchor. But neither title hook is documented today, and adding an entry for a pure internal-dedup phase expands scope.
- **Resolution:** accepted-as-is — deferred the decision to the roadmap step-7 CLAUDE.md review, which concluded no CLAUDE.md change is required for this phase (the gate is pre-existing and undocumented; documenting it is out of scope here).

## Alignment Findings

### [1] Memoization constraint had no in-code anchor
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** Pushback Finding 2 elevated "do not `useCallback`-wrap save/start" to an explicit design/plan constraint, but the plan recorded it only in self-review prose. The shipped `useInlineTitleEditing.ts` had no comment at its `return` block warning a future editor away from memoizing, and the constraint is untestable — so it would vanish from the codebase after merge, exactly where a maintainer would later trip over it.
- **Resolution:** fixed-in-plan — added a one-line comment at the hook's `return` block in the plan's Task 2 implementation anchoring the constraint (read latest draft/entity/gates/options each render; setDraft and inputRef are already stable).

## Summary

- Pushback raised 3 issues; 2 resulted in design changes (a project no-op characterization test and a no-memoization constraint), 1 was accepted-as-is after the step-7 CLAUDE.md review confirmed no doc change is needed.
- Alignment raised 1 issue; 1 resulted in a plan change (an in-code comment anchoring the no-memoization constraint at the hook's return block). Requirements and tasks otherwise traced cleanly in both directions, with no orphaned or out-of-scope tasks; tasks were already in red→green form so no TDD rewrite was needed.
