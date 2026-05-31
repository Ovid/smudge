# Agentic Code Review: tiptap-extension-consolidation

**Date:** 2026-05-31 09:48:04
**Branch:** tiptap-extension-consolidation -> main
**Commit:** 665ddfc
**Files changed:** 15 | **Lines changed:** +755 / -63
**Diff size category:** Medium (≈692 of the inserted lines are docs; the code surface is ~10 changed lines plus file moves/deletes)

## Executive Summary

This branch (Phase 4b.8) consolidates two byte-for-byte-identical TipTap extension config arrays — one in the client, one in the server — into a single source of truth at `packages/shared/src/editorExtensions.ts`, exposed via a new `@smudge/shared/editor-extensions` subpath export. Four consumers are repointed, both local files and the server "parity test" are deleted, and a render smoke test moves into `shared`. All six specialist lenses returned **zero findings at confidence ≥ 60**; the consolidated config is verified byte-identical to both deleted declarations, all consumers are correctly repointed with no stale references, and no behavior change is introduced. This is a clean, low-risk refactor. Confidence: high.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

None found.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State (clean no-surface bail-out), Security (clean no-boundary bail-out), Spec Compliance
- **Scope:** Changed files — `packages/shared/src/editorExtensions.ts` (new), `packages/shared/package.json`, `packages/shared/src/__tests__/editorExtensions.test.ts` (moved), `packages/client/src/components/Editor.tsx`, `packages/client/src/components/PreviewMode.tsx`, `packages/client/src/hooks/useSnapshotController.ts`, `packages/server/src/export/export.renderers.ts`; deleted `packages/client/src/editorExtensions.ts` + `packages/server/src/export/editorExtensions.ts`. Adjacent — `packages/shared/src/index.ts` (barrel, confirmed NOT re-exporting), `packages/client/src/sanitizer.ts` (conceptual comments), client/server/shared tsconfig + vite + package.json.
- **Raw findings:** 0 (before verification)
- **Verified findings:** 0 (after verification)
- **Filtered out:** 0
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 0
- **Backlog:** 0 new entries added, 0 re-confirmed (23 total active in `paad/code-reviews/backlog.md`; none match this review's manifest)
- **Steering files consulted:** `/workspace/CLAUDE.md`
- **Intent sources consulted:** `docs/plans/2026-05-31-tiptap-extension-consolidation-design.md`, `docs/plans/2026-05-31-tiptap-extension-consolidation-plan.md`, `docs/roadmap-decisions/2026-05-31-phase-4b-8-tiptap-extension-consolidation.md`, `docs/roadmap.md`, recent commit messages
- **Verifier warnings:** none

## Notes (non-findings, for the author)

These were surfaced by specialists as observations below the reporting threshold — not bugs, recorded so they aren't lost:

- **Vite production-build resolution remains the one untested risk.** The design and plan both flag that the new `./editor-extensions` subpath has never been resolved by Vite's Rollup production path, and that `make all` does not run `vite build`. The Contract specialist judged the risk low because the `.` barrel export already resolves `.ts`-via-`exports` in the client Vite build today (and `PreviewMode.tsx` imports both the barrel and the new subpath). Static review cannot close this — **run `make build` before merge** as the plan's Task 6 requires.
- **Image node has no render assertion in the moved smoke test.** The shared smoke test asserts `<strong>`/`<h3>`/`<li>`/`<blockquote>` but exercises no image node, so `Image.configure({ inline: false, allowBase64: false })` has no direct rendering assertion in `shared`. This gap is pre-existing (the original server test had it too) — neither introduced nor worsened by this branch. The image config is exercised indirectly by `packages/server/src/export/export.images.test.ts`.
- **`export.images.test.ts` was unrunnable in this environment** due to a `better-sqlite3` `invalid ELF header` (the host↔guest native-binding mismatch documented in CLAUDE.md, fixed by `make ensure-native`). Unrelated to this diff; the non-DB renderer tests covering the same `generateHTML` path pass.
