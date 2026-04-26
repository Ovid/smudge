# Agentic Code Review: ovid/miscellaneous-fixes

**Date:** 2026-04-26 03:11:45
**Branch:** ovid/miscellaneous-fixes -> main
**Commit:** 43e5a823bb47f59ea9021f2fae61d798b0f83ad8
**Files changed:** 17 | **Lines changed:** +2124 / -76 (code-only ~880 lines; remainder is plan/design docs)
**Diff size category:** Medium (code) / Large (with docs)

## Executive Summary

This is the third agentic review of the branch. The two earlier rounds (`ec541bb`, `2c9fdf4`) drove the bulk of substantive findings to closure: prior commits address S2 (private DOMPurify instance), S3 (ALLOWED_ATTR pin), S4 (surrogate-safe truncation), S5 (per-element validation), S6 (e2e UUID slug uniqueness), S21 (chapters cap + title truncation), I1 (validate-before-bound + drop dead `id`), I2 (reject empty `chapters: []`), I3 (correct scanner cite), and I14 (sanitizer URI hook). Specialists found no Critical issues and no new logic / concurrency / contract bugs in the current state; the most actionable remaining item is **I1** — the server's `TipTapDocSchema` is `.passthrough()` and the new e2e *proves* it stores hostile URIs, making the client sanitizer a load-bearing single-point-of-defense for every current and future render path.

## Critical Issues

None found.

## Important Issues

### [I1] `TipTapDocSchema.passthrough()` makes client sanitizer the only line of defense — load-bearing assumption

- **File:** `packages/shared/src/schemas.ts` (`TipTapDocSchema`), exercised by `e2e/sanitizer-snapshot-blob.spec.ts:88-99`
- **Bug:** The server's TipTap content schema is `z.object({...}).passthrough()` and validates only depth, not element attrs. The new e2e demonstrates that `data:image/svg+xml` and `javascript:alert(1)` URIs persist server-side intact. Client-side `sanitizeEditorHtml` is the only thing standing between persisted hostile content and the rendered DOM.
- **Impact:** Defense-in-depth gap that this branch *makes load-bearing*. Today both render call sites (`EditorPage.tsx:69`, `PreviewMode.tsx:76`) route through `sanitizeEditorHtml`, so XSS is unreachable. But every future export path (DOCX/EPUB/Markdown/PDF) and any new `dangerouslySetInnerHTML` site is now one missed call away from emitting an XSS-exploitable artifact, with persisted hostile content already in the database.
- **Suggested fix:** Two-pronged. Short term — add a server-side URI validator to `TipTapDocSchema` so the server refuses to store `data:`/`javascript:`/non-`/api/images/` `<img src>` values (lift `ALLOWED_URI_REGEXP` into `@smudge/shared`). Belt-and-braces, and limits blast radius if a future render path forgets to sanitize. Medium term — an ESLint `no-restricted-syntax` rule that flags `dangerouslySetInnerHTML` outside `sanitizer.ts`-routed paths. Out of scope for Cluster D, but worth filing.
- **Confidence:** High
- **Found by:** Security; verifier confirmed by reading `packages/shared/src/schemas.ts` and the e2e

## Suggestions

- **`packages/client/src/sanitizer.ts:74`** — `ALLOWED_URI_REGEXP = /^\/api\/images\//i` validates only the prefix. Values like `/api/images/javascript:alert(1)`, `/api/images/../../etc/passwd`, `/api/images/?x=javascript:` pass. `<img src>` cannot execute JS, so XSS is unreachable today. `ALLOWED_TAGS` (lines 30-47) does NOT include `<a>`, so `<a href>` is also moot. Latent if Link is later added to `editorExtensions`. Tighten the regex to require a UUID after `/api/images/` (mirrors the server's `IMAGE_SRC_RE` shape — would also unify the three URL forms in C&I finding C3 below). Confidence 70. Found by: Security, Contract & Integration.

- **e2e helper duplication across 8 files.** `createTestProject` exists in `e2e/dashboard.spec.ts:10`, `e2e/editor-save.spec.ts:9`, `e2e/export.spec.ts:25`, `e2e/find-replace.spec.ts:15`, `e2e/images.spec.ts:31`, `e2e/sanitizer-snapshot-blob.spec.ts:17`, `e2e/snapshots.spec.ts:9`, `e2e/velocity.spec.ts:10` — same body, only the title prefix differs. No `e2e/helpers/` directory exists. Each S6 commit copy-pasted the comment block 8x. Next change to project-creation defaults (e.g. `target_word_count`) needs 8 identical edits. Extract `e2e/helpers/projects.ts` exporting `createTestProject(request, prefix)`. Confidence 90. Found by: Contract & Integration.

- **e2e cleanup-after-failed-beforeEach.** All 8 e2e files declare `let project: TestProject;` (no `null` initializer) and call `deleteProject(request, project.slug)` in `afterEach` without a guard. If `createTestProject` ever throws after a previous test's project was already deleted, `afterEach` calls `delete` on a stale or undefined slug, masking the real failure with a TypeError or 404. Use `let project: TestProject | null = null;` plus `if (project)` guard in `afterEach`. Pairs with the helper-extraction suggestion above. Confidence 60. Found by: Concurrency & State.

- **`packages/server/src/images/images.references.ts:30-33`** — `^(?:https?://[^/]+)?/api/images/<uuid>` accepts any host. A pasted `https://evil.example/api/images/<real-uuid>` increments the local image's refcount, blocking legitimate delete with perpetual `IMAGE_IN_USE`. Single-user app, so the only paste-source is the user — no realistic exploit. Comment at lines 21-29 acknowledges this as intentional. Consider restricting the optional host alternation to same-origin (or dropping it entirely, since the only writer Smudge ships emits the relative form). Confidence 65. Found by: Security.

- **`packages/client/src/errors/scopes.ts:233-247`** — `extrasFrom` filters the entire `chapters` array before `slice(0, 50)`. A pathological 50K-entry envelope (within the 5MB Express body limit) does N work before bounding. Server contract makes this unreachable in normal traffic. Short-circuit to `chapters.slice(0, 51).filter(...)` (51 lets the all-or-nothing rule still see "more than cap" and reject) or accept the current ordering and add a comment. Confidence 60. Found by: Security.

- **`packages/client/src/errors/scopes.ts:170,178,203,216`** — labels `[I1]` and `[S2]` repeat across review rounds with different meanings (line 170 is "project deleted between gallery-open and upload"; line 178 is "server 400 for missing file"; line 203 is "validate full chapters array before bounding"; line 216 is round-2 "drop `id`"). Each annotation is locally unambiguous, but a grep for "I1" surfaces four matches. Cluster A reuses `[I1]` for `chapter.reorder REORDER_MISMATCH`. Consider renamespacing within the file (e.g. `D-I1`) on a follow-up touch-up. Confidence 65. Found by: Contract & Integration.

## Plan Alignment

Plan/design docs consulted: `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`.

### Implemented (Cluster D + opportunistic Cluster E carve-out)

- **Cluster D core:** [I14] sanitizer `ALLOWED_URI_REGEXP` + `uponSanitizeAttribute` hook (`sanitizer.ts:74,82-89`); [S21] `image.delete` chapters cap (50) + title truncation (200 codepoints) (`scopes.ts:230-248`); unit tests pinning the URI rejection contract and the implicit allowlist for `<svg>/<math>/<audio>/<video>/<source>/<track>/<base>` (`__tests__/sanitizer.test.ts`); e2e at `e2e/sanitizer-snapshot-blob.spec.ts`.
- **Second-review-round follow-ups:** [S1] sanitizer/server cross-reference comments; [S2] private `DOMPurify(window)` instance; [S3] export `ALLOWED_ATTR` and pin its shape; [S4] code-point safe truncation; [S5] tighten unit assertions to e2e regex; [S6] e2e `crypto.randomUUID()` slug uniqueness across 7 specs; [I1] validate-before-bound + drop dead `id`; [I2] reject `chapters: []`; [I3] correct scanner cite.

### Not yet implemented (deliberately deferred — partial implementation expected)

- **Cluster A (PR 2):** scope-coverage gaps — `chapter.reorder REORDER_MISMATCH`, `chapter.save network/404`, `trash.restoreChapter 404`.
- **Cluster B (PR 3):** AbortSignal threading across `projects.create`, `chapters.create`, `loadProject`, `search.replace`, `ExportDialog`.
- **Cluster C (PR 4):** consumer recovery completeness — `applyMappedError` helper, SnapshotPanel `possiblyCommitted`, `useTrashManager` re-fetch, [S8] graceful-degradation extras.
- **Cluster E (PR 5):** mapper internals + CLAUDE.md updates — only [S2] from this cluster has shipped.

### Deviations

- **[I1] vs [S8] direct contradiction acknowledged.** Commit `43e5a82` updated the Cluster C/E task list to document three reconciliation paths for the contradiction (this branch's [I1] enforces "valid.length !== chapters.length → undefined"; Cluster C's [S8] asks for the opposite — "Return `{ chapters: valid }` whenever `valid.length > 0`"). No longer silent — but a decision is still owed at PR 4 time.
- **Tag-namespace collision across rounds.** Commit messages and code comments reuse `[I1] [I2] [S1] [S2]` from the original Phase 4b.3 review with new meanings from the second review report. Each annotation is locally unambiguous but cross-round grepping surfaces collisions. The plan acknowledges this in `## Deviations` but has not renamespaced.
- **One-feature-per-PR rule (CLAUDE.md):** This PR is scoped to Cluster D plus the [S2] private-instance fix from Cluster E. The [S2] addition is defensible under "bug fix alongside the feature it affects" — it touches `sanitizer.ts` and is needed for the URI hook to be installed safely. PR body should explicitly note the cross-cluster carve-out.
- **CLAUDE.md untouched.** Correct — Cluster E (Task 5.5) owns the unified-error-mapping doc updates. No deviation.
- **No PR yet.** Implementation looks ready; the PR-body checklist + roadmap reference per CLAUDE.md PR-Scope rule still pending.

## Review Metadata

- **Agents dispatched:** 6 specialists in parallel — Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment. Plus 1 Verifier (single-pass).
- **Scope:** Changed code (`sanitizer.ts`, `scopes.ts`, `images.references.ts`, three test files, eight e2e specs) plus adjacent files (`apiErrorMapper.ts`, `ImageGallery.tsx:300-345`, `EditorPage.tsx:46,69`, `PreviewMode.tsx:3,76`, `images.service.ts deleteImage`, `api/client.ts` extras handling, `packages/shared/src/schemas.ts` TipTapDocSchema).
- **Raw findings:** 17 (across 6 specialists, with multiple duplicates).
- **Consolidated:** 12 unique.
- **Verified findings:** 7 (1 Important + 6 Suggestion).
- **Filtered out:** 5 (refuted false positives or working-as-designed once the comment block was read).
- **Steering files consulted:** `CLAUDE.md`.
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`.
- **DOMPurify version verified:** 3.4.0 — factory at `node_modules/dompurify/dist/purify.cjs.js:300` returns a fresh instance with isolated `hooks` map, confirming the [S2] private-instance design is sound and HMR-safe.

### Filtered findings (with verification rationale)

- **C2 (Singleton-pollution test marginally weak)** — *Refuted.* The test's contract holds: `addHook` is on the private `purifier` from `DOMPurify(window)`, not on the imported singleton. The test fails loud if anyone regresses to `DOMPurify.addHook`.
- **C4 (`_resolveErrorInternal` direct import vs comment)** — *Working as designed.* The underscore-prefix + comment is the project's documented escape hatch for algorithm-level tests against synthetic scopes; registry-binding tests do go through `mapApiError`. No bug.
- **SEC4 (Title is the only field length-capped)** — *Confirmed correct.* `id` was dropped per commit `4a6ae36`; output today is `{ title: <slice 200>, trashed? }` only. Comments match reality. No bug.
- **Logic & Correctness specialist** found zero confidence-≥-60 issues; explicitly verified `extrasFrom` ordering, hook attribute coverage, regex behavior on URL-encoded/CRLF/whitespace inputs, prototype-pollution guard, and `ImageGallery.handleDelete` abort sequencing.
- **Error Handling & Edge Cases specialist** found zero confidence-≥-60 issues; empirically tested DOMPurify attribute normalization with hostile casing/whitespace, sparse-array filter behavior, and `null`/string `err.extras` short-circuiting.
