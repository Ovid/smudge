# Agentic Code Review: ovid/architecture

**Date:** 2026-05-29 17:49:39
**Branch:** ovid/architecture -> main
**Commit:** b1577cc9b1d3332f07ab95570234eabaf7a67a13
**Files changed:** 8 | **Lines changed:** +410 / -37
**Diff size category:** Medium

## Executive Summary

This branch lands three architecture-report fixes — **F-4** (split the 54-method `ProjectStore` god-interface into seven per-domain sub-interfaces + a composite), **F-7** (extract the load-bearing editor-quiesce ordering into a shared `quiesceEditorForServerOp` helper), and **F-8** (JSDoc disclosure of hidden side effects on three `chapters.service` mutations) — plus the report's Status backfill. Six specialist agents (Logic, Error Handling, Contract & Integration, Concurrency & State, Security, Plan Alignment) reviewed it independently and found **no bugs**. The changes are verified behavior-preserving: F-7 is byte-equivalent to the inline code it replaced, F-4 is type-level only (identical method set, clean `tsc`, sole impl still satisfies the composite), and F-8 is doc-only with JSDoc that accurately matches the implementation. Confidence is high — this is a clean, well-tested refactor branch with safety-net tests committed before each fix.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

None of bug severity. One pre-existing, out-of-diff nit was noted incidentally (not introduced by this branch, listed for awareness only): the comment at `packages/client/src/hooks/useSnapshotController.ts:554` claims "flushSave can also reject from an onSave rejection," but the real `EditorHandle.flushSave` (`Editor.tsx:406-415`) has a `.catch(() => false)` and never rejects — so the caller's try/catch is purely defensive on that path. Harmless, pre-existing, and outside this diff's scope.

## Plan Alignment

The architecture report (`paad/architecture-reviews/2026-05-29-smudge-architecture-report.md`) is the design doc; this branch fixes and updates the Status for F-4, F-7, F-8.

- **Implemented:**
  - **F-4** (commit `91d9d5c`) — `project-store.types.ts` defines exactly the seven named sub-interfaces (`ProjectsStore`, `ChaptersStore`, `ChapterStatusesStore`, `SettingsStore`, `VelocityStore`, `ImagesStore`, `SnapshotsStore`); `ProjectStore extends` all seven plus the cross-domain `transaction()` seam. Method set is identical to the prior monolith (verified by signature diff), all 17 consumers still import the unchanged composite, sole impl still `implements ProjectStore`, and `transaction()` still hands the callback the full composite. Server `tsc` clean. Method-surface guard test pins all 54 methods by domain.
  - **F-7** (commit `ccd9915`) — `quiesceEditorForServerOp` in `editorSafeOps.ts` encodes the `[disable] → flushSave → (fail: re-enable, bail) → cancel → [markClean]` ordering once; both `useSnapshotController.ts` handlers delegate (`onView` with `disableEditor:true`, `onBeforeCreate` with `markCleanAfter:true`). Byte-equivalent behavior confirmed by all four reviewers; 6 new ordering/failure/null-ref tests.
  - **F-8** (commit `5440210`) — JSDoc added to `updateChapter`/`deleteChapter`/`restoreChapter` naming each undisclosed side effect (in-tx parent `updated_at` bump, in-tx `applyImageRefDiff` ref-count diff, post-commit best-effort velocity call, and `restoreChapter`'s parent restore-and-reslug). Each claim cross-checked against the code and accurate. Doc-only.
- **Status-claim honesty (verified accurate):** F-4's Status explicitly resolves only the god-object/cohesion facet and disclaims the shotgun-surgery and over-abstraction facets — correct, a new op still touches three files and there is still one impl. F-7's Status self-discloses that the finding's cited line range (`EditorPage.tsx:2095-2231`) was stale because F-1 had relocated the handlers into `useSnapshotController.ts` — accurate disclosure, not a defect. All three cited Status-commit SHAs correspond to their fixes (`git show --stat` confirmed); `2d68e1f` backfilled the SHAs and `b1577cc` is formatting-only.
- **Not yet implemented (correctly disclosed, neutral — partial is expected):** F-4's shotgun-surgery and over-abstraction facets remain open by design; F-1's UI-component extraction and F-17's global editor registry are separate findings untouched here.
- **Deviations:** None. No overclaiming in any Status entry.
- **Process observation (neutral, for the author — not a defect):** the branch bundles three distinct refactors across two packages plus the report doc update. CLAUDE.md's one-feature rule reads as one refactor per PR with bundling exceptions recorded in the phase decision log; no decision-log entry covering this bundling was found. All three are low-risk refactor-class changes — flagging only so the author can confirm the bundling is intentional or record the exception.

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness — behavioral equivalence of the F-7 extraction
  - Error Handling & Edge Cases — throw absorption, swallowed-velocity accuracy, JSDoc-vs-code fidelity
  - Contract & Integration — F-4 method preservation, composite/`extends` completeness, consumer + impl conformance, `EditorHandle` signature match
  - Concurrency & State — save-pipeline ordering invariants, markClean race window, TOCTOU on `editorRef`
  - Security — data-loss / data-integrity properties (no-auth single-user app)
  - Plan Alignment — code vs. report Status claims, scope-honesty, commit-SHA verification
- **Scope:** `editorSafeOps.ts`, `useSnapshotController.ts`, `chapters.service.ts`, `project-store.types.ts` (changed) + `sqlite-project-store.ts`, `Editor.tsx`, `velocity.service.ts`, and the 17 `ProjectStore` consumers (adjacent, one level)
- **Raw findings:** 0 (before verification)
- **Verified findings:** 0 (after verification)
- **Filtered out:** 0 — no specialist reported a finding at confidence ≥ 60, so the verifier had an empty input set
- **Steering files consulted:** `CLAUDE.md` (save-pipeline invariants, status-code allowlist, one-feature/phase-boundary rules) — no contradictions with code found
- **Plan/design docs consulted:** `paad/architecture-reviews/2026-05-29-smudge-architecture-report.md`
- **Environment note:** server unit/integration tests could not run in this sandbox without a `make ensure-native` rebuild (the documented host↔guest better-sqlite3 ABI crossing); reviewers that rebuilt confirmed the server suite passes, and both server and client `tsc` exit clean. This is an environment artifact, not a branch regression.
