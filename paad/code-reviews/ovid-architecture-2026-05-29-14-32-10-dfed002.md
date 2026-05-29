# Agentic Code Review: ovid/architecture

**Date:** 2026-05-29 14:32:10
**Branch:** ovid/architecture -> main
**Commit:** dfed002c45e81833dc3af5576c2472a2a916d4c1
**Files changed:** 11 | **Lines changed:** +3310 / -2118
**Diff size category:** Large

## Executive Summary

This branch implements **F-1: EditorPage God Object Decomposition** — the ~2,373-line `EditorPage.tsx` and the ~1,722-line `useProjectEditor.ts` were split into focused orchestration hooks (`useChapterCrud`, `useChapterMetadata`, `useFindReplaceController`, `useSnapshotController`, plus `useProjectEditor.types.ts`), with `useProjectEditor` reduced to a thin orchestrator and `EditorPage` to 1,394 lines. Six specialist agents (logic, error-handling, contract/integration, concurrency/state, security, plan-alignment) reviewed the change against the pre-refactor code and the design report. **No correctness, error-handling, contract, concurrency, or security bugs were found at confidence ≥ 60.** This is a faithful, near-verbatim mechanical extraction: every reviewer independently confirmed `tsc --noEmit`, `eslint`, and the relevant Vitest suites pass green, and that the load-bearing save-pipeline invariants survive the split intact. The only items worth acting on are documentation-drift suggestions, not code defects.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **Stale steering prose in `CLAUDE.md:132`** (save-pipeline invariant #4) — it still lists the `useRef<AbortController>` justified-survivor files as `HomePage.tsx, useProjectEditor.ts, useSnapshotState.ts, useTrashManager.ts`. Verified against the tree: `useProjectEditor.ts` no longer holds a live hand-rolled controller — the only matches there (lines 138, 182) are *comments* describing the old pattern. The live survivor allocations are now `useChapterCrud.ts:117`, `useChapterMetadata.ts:65/66`, `useTrashManager.ts:71`, `useSnapshotState.ts:198`, and `HomePage.tsx:35`. The structural test (`migrationStructuralCheck.test.ts:223-234`) was updated to match — its allowlist drops `useProjectEditor.ts` and adds the two chapter hooks, with an explicit comment ("useProjectEditor.ts removed by F-2 (2026-05-29)") — but the CLAUDE.md prose was not. Per this review's steering-contradiction rule, this is a real documentation-only divergence between the steering file and the code/test. One-line fix: update the survivor-file list in CLAUDE.md:132 to match the test allowlist (replace `useProjectEditor.ts` with `useChapterCrud.ts` + `useChapterMetadata.ts`).
- **Stale `Evidence` line numbers for F-7 in the architecture report** (`paad/architecture-reviews/2026-05-29-smudge-architecture-report.md`) — F-7's evidence still points at `EditorPage.tsx:2095-2231`; that hand-composed save-pipeline ordering now lives in `useSnapshotController.ts`. Cosmetic; F-7 remains formally open and out of F-1 scope.

## Plan Alignment

Design/status doc: `paad/architecture-reviews/2026-05-29-smudge-architecture-report.md` §F-1.

- **Implemented (matches plan):**
  - `useFindReplaceController` extracted (new, 622 lines) — `finalizeReplaceSuccess`, `executeReplace`, `handleReplaceOne`, manuscript/chapter replace-all handlers, `replaceConfirmation` state, `replaceOp`/slug ref.
  - `useSnapshotController` extracted (new, 590 lines) — `handleRestoreSnapshot`, `RestoreAbortedError`/`RestoreFailedError` sentinels, exported `renderSnapshotContent`, `onView`/`onBeforeCreate`.
  - Single `useEditorMutation` instance retained in `EditorPage` and threaded into both controllers by reference — the "single mutation instance shared by every caller" invariant is preserved by construction.
  - Safety-net test landed first (`EditorPageF1SafetyNet.test.tsx`, 224 lines), pinning export-dialog / settings-dialog / Ctrl+Shift+W wiring before decomposition.
  - EditorPage line-count claim (2373 → 1394) verified accurate.
- **Not yet implemented (neutral — partial is expected and explicitly declared):**
  - Render-layer decomposition (`EditorHeader`/`EditorMainContent`/dialog cluster) deferred; the plan scopes this out ("Option A: orchestration hooks only").
  - F-7 (temporal coupling) — the hand-composed save-pipeline ordering was *relocated* into `useSnapshotController` but remains hand-composed rather than routed through `useEditorMutation`; F-7 stays open.
  - F-17 (global editor registry in `Editor.tsx`) — untouched, out of scope.
- **Deviations:** None material. No second feature or unrelated refactor is bundled; the one-feature and phase-boundary rules are respected. The `dfed002` prettier-only follow-up and the SHA-record doc commit are normal hygiene. The F-1 diff does **not** touch `migrationStructuralCheck.test.ts` — the allowlist edits seen in that file belong to the F-2 commit, not F-1, and neither new controller hook contains a raw `useRef<AbortController>` (find/replace uses the canonical `useAbortableAsyncOperation`; the snapshot controller allocates no controller ref).

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness — behavior drift across the extraction
  - Error Handling & Edge Cases — dropped catches / mapper routing
  - Contract & Integration — return-shape, type, dep-threading, duplication
  - Concurrency & State — save-pipeline invariants, shared refs, epoch/abort wiring
  - Security — XSS/sanitizer, ReDoS, error-message leakage
  - Plan Alignment — diff vs F-1 design report + PR-scope rules
- **Scope:** changed files plus pre-refactor originals (reconstructed from `main`/`f578758^`) and adjacent boundaries (`sanitizer.ts`, `PreviewMode.tsx`, `search.service.ts`, `useEditorMutation`, `useAbortableSequence`, `useAbortableAsyncOperation`, consumers of `useProjectEditor`).
- **Raw findings:** 0 code findings ≥ 60 confidence (2 documentation-drift observations)
- **Verified findings:** 0 code defects
- **Filtered out:** 0 (no false positives to reject; specialists self-verified via byte-diff + tsc + eslint + Vitest, so no separate verifier pass was warranted)
- **Steering files consulted:** `CLAUDE.md` (one stale-prose contradiction flagged — see Suggestions)
- **Plan/design docs consulted:** `paad/architecture-reviews/2026-05-29-smudge-architecture-report.md`
