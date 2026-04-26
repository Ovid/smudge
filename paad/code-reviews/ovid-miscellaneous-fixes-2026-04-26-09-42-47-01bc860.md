# Agentic Code Review: ovid/miscellaneous-fixes

**Date:** 2026-04-26 09:42:47
**Branch:** `ovid/miscellaneous-fixes` -> `main`
**Commit:** `01bc8609dd5bacaf724d860d284914cf2a666235`
**Files changed:** 22 | **Lines changed:** +2786 / -84
**Diff size category:** Medium (real code ~200 lines; rest is plan docs, e2e formatting, and prior review reports)

## Executive Summary

The branch has been through three or more rounds of inline review and the central security claims (DOMPurify private-instance isolation, hook-closes-DATA_URI_TAGS-carve-out, surrogate-safe truncation, cap+1 validation window) hold up against the actual library source and the surrounding code. No critical defects were found. Three **Important** findings concern user-visible behavior or future-defense gaps: the 50-chapter cap on the `IMAGE_IN_USE` envelope is reachable in normal Smudge use without a "and N more" affordance (CI-3), the server emits the same envelope unbounded (CI-4), and the TipTap doc schema's `passthrough()` lets hostile URIs persist in the DB so the new client sanitizer is now the only defense (PA-5).

## Critical Issues

None found.

## Important Issues

### [I1] 50-chapter cap on `IMAGE_IN_USE` envelope is reachable; no "and N more" affordance
- **File:** `packages/client/src/errors/scopes.ts:289` (cap), `packages/client/src/strings.ts:340` (template)
- **Bug:** The validator silently truncates `chapters` to 50 entries; the rendered string `"This image is used in: <list>. Remove it from those chapters first."` carries no truncation marker.
- **Impact:** A book with a recurring graphical element (drop caps, character portraits used across every chapter title page, scene-break ornaments) trivially has >50 references. The user removes the image from the listed 50, retries, hits `IMAGE_IN_USE` again with the next batch, and has no way to learn the list was truncated. The source comment at `scopes.ts:217-219` claims ">50 referencing chapters is unreachable in normal Smudge use" — that's not true for any non-trivial book using a repeated image.
- **Suggested fix:** Either bump the cap higher, or render `"and N more"` when the input had 51+ candidates. Pairs naturally with [I2] — let the server send `total` and the client surfaces the remainder.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I2] Server emits `referencingChapters` unbounded; no server-side cap
- **File:** `packages/server/src/images/images.service.ts:169-184`
- **Bug:** `deleteImage` builds the chapter list with no cap; the 409 envelope is shipped intact to the client. Express body limit is 5 MB (`packages/server/src/app.ts:41`, `MAX_CHAPTER_CONTENT_LIMIT_STRING`) for *requests*, not responses.
- **Impact:** A project with hundreds of chapters all referencing one image (automated import, recurring ornament) ships a multi-MB 409 envelope to the client; only the client cap-at-50 + 200-codepoint title truncation prevents it from blowing up the UI. The defense-in-depth is asymmetric: client side is hardened, server side is not.
- **Suggested fix:** Cap server-side at e.g. 50 and include a `total` count. Update the validator to surface the remainder count and the strings template to render "and N more". This also fixes [I1] honestly.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I3] `TipTapDocSchema.passthrough()` lets hostile URIs persist; sanitizer is now the only defense
- **File:** `packages/shared/src/schemas.ts:47-55`
- **Bug:** Element `attrs` are `z.record(z.unknown())` — the schema does not validate URI shapes. The new e2e (`e2e/sanitizer-snapshot-blob.spec.ts:98-99`) explicitly asserts that `data:image/svg+xml` and `javascript:alert(1)` URIs persist verbatim in storage, proving the sanitizer is now the load-bearing defense at render time.
- **Impact:** Any future code path that renders persisted chapter or snapshot content without routing through `sanitizeEditorHtml` re-exposes the XSS surface (e.g. a future export pipeline, an admin debug view, an HTML email digest of a chapter). The plan's `§Out-of-scope` does not file server-side URI validation as future work.
- **Suggested fix:** Lift `ALLOWED_URI_REGEXP` (or the wider server-side `IMAGE_SRC_RE`) into `@smudge/shared`, validate `<img src>` shapes server-side at chapter PATCH time, and refuse persistence of unsupported URI schemes. At minimum, file the hardening explicitly as a Cluster G or follow-up issue.
- **Confidence:** Medium (real risk; reachability depends on future code paths that haven't been written yet)
- **Found by:** Plan Alignment (also flagged in prior `paad/code-reviews/...03-11-45-43e5a82.md` review as `[I1]`)

## Suggestions

- **[S1] Sanitizer regex `/i` flag makes path case-insensitive** — `packages/client/src/sanitizer.ts:91-92`. `/API/IMAGES/<uuid>` passes the sanitizer but Express routes are case-sensitive and would 404. Tighten to `^\/api\/images\/(?:[0-9a-fA-F]{8}-...)$` (drop top-level `/i`).
- **[S2] Sanitizer regex tail `(?:[?#].*)?$` is unbounded** — same file, same line. Hostile content can ship multi-MB query/fragment strings on `<img src>`. Asymmetric vs the validator's 200-codepoint title cap on the same PR. Cap the tail (e.g. `[^\s]{0,256}`) or add a `data.attrValue.length` guard in the hook. Found by Error-Handling and Security agents (2 specialists).
- **[S3] `obj.id !== undefined && typeof obj.id !== "string"` rejects envelopes over a discarded field** — `packages/client/src/errors/scopes.ts:281`. Wrong-type `id` triggers all-or-nothing fallback even though `id` is dropped from output. Either ignore `id` validation entirely or downgrade to "drop bad id, keep entry".
- **[S4] `obj.title.length === 0` doesn't reject whitespace-only titles** — `packages/client/src/errors/scopes.ts:282`. Server's `z.string().trim().min(1)` does. Mirror with `obj.title.trim().length === 0` (or accept the cosmetic gap and pin via comment).
- **[S5] e2e load-bearing assumption on `TipTapDocSchema.passthrough()`** — `e2e/sanitizer-snapshot-blob.spec.ts:98-99`. If server schema later rejects hostile URIs, test fails on the verify-step assertion rather than exercising the sanitizer. Either split the test or add a code-level comment in `chapters.routes.ts` so a future hardening PR sees the dependency.
- **[S6] `page.locator("div.prose").first()` couples to a Tailwind class** — `e2e/sanitizer-snapshot-blob.spec.ts:132`. Add `data-testid="snapshot-rendered-content"` to the snapshot view in `EditorPage.tsx` and select on it.
- **[S7] `truncateCodePoints` duplicates `truncateGraphemes`** — `packages/client/src/errors/scopes.ts:11-21` vs `packages/server/src/utils/grapheme.ts:16-24`. Different semantics (code points vs graphemes via `Intl.Segmenter`). The codebase has a precedent for grapheme-aware string handling (CLAUDE.md cites it for `countWords`). Either lift the server helper to `packages/shared/` and pick one, or document why code-point truncation is sufficient here.
- **[S8] Cast in `ImageGallery.tsx:335` is structural, not type-imported** — couples the call site to the validator's shape implicitly. Export `type ImageDeleteBlockedChapter = { title: string; trashed?: boolean }` from `scopes.ts` and import it.
- **[S9] `IMAGE_IN_USE` is a string literal while `SNAPSHOT_ERROR_CODES.*` are constants** — `packages/client/src/errors/scopes.ts:206`. `packages/shared/src/constants.ts` has `SNAPSHOT_ERROR_CODES`/`SEARCH_ERROR_CODES` but no `IMAGE_ERROR_CODES`. Add one and import.
- **[S10] No direct unit test for `truncateCodePoints`** — only exercised via the validator's 200-cap path. Add `expect(truncateCodePoints("abc", 200)).toBe("abc")` plus an emoji-short-input regression to lock the contract.
- **[S11] Branch scope is wider than plan's "Cluster D = PR 1"** — bundles `[S6]` slug-uniqueness, prettier reformatting, skill updates. Plan + CLAUDE.md `§Pull Request Scope` discipline. Either log the bundling in the PR body or split before merge.
- **[S12] `[I1]/[S8]` plan contradiction documented but unresolved** — `docs/plans/2026-04-25-4b3a-review-followups-plan.md:946-952`. Decide before Cluster C lands.
- **[S13] `CLAUDE.md §Unified API error mapping` (lines 90-104) doesn't mention `committedCodes`** — extension exists in `scopes.ts:124,139,406` but is undocumented. Plan assigns this to Cluster E (Task 5.5); flagged for completeness.

## Plan Alignment

Plan documents consulted: `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`.

- **Implemented:** `[I14]` `ALLOWED_URI_REGEXP` UUID-shaped + `uponSanitizeAttribute` hook on private DOMPurify instance; `[S2]` private DOMPurify instance (Cluster E carve-out, defensible); `[S21]` `image.delete extrasFrom` cap + truncation + allowlist + drops + empty/empty-string rejection; Cluster D unit + e2e tests; `[S1]` server/client URI regex divergence comment.
- **Not yet implemented (expected partial):** Cluster A (chapter.reorder/save/trash scopes), Cluster B (AbortSignal threading), Cluster C (`applyMappedError`/`ScopeExtras<S>`/14 items), most of Cluster E (only `[S2]` shipped early).
- **Deviations:** Branch bundles items beyond Cluster D's stated scope (see [S11]); `[I1] / [S8]` contradiction documented but unresolved (see [S12]); CLAUDE.md `§Unified API error mapping` block stale on `committedCodes` (see [S13]); `TipTapDocSchema.passthrough()` defense-in-depth gap not filed as future work (see [I3]).

Roadmap-phase boundary: `docs/roadmap.md` marks Phase 4b.3a as **In Progress**; this branch is one of five planned PRs (Cluster D + carve-out). Boundary respected per CLAUDE.md `§Pull Request Scope`, modulo [S11].

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** changed code (`packages/client/src/sanitizer.ts`, `packages/client/src/errors/scopes.ts`, `packages/server/src/images/images.references.ts`, e2e + unit tests) plus adjacent callers (`PreviewMode.tsx`, `EditorPage.tsx`, `ImageGallery.tsx`, `strings.ts`, `api/client.ts`, `apiErrorMapper.ts`), the DOMPurify 3.x source for lifecycle verification, and the prior `paad/code-reviews/` reports against this branch.
- **Raw findings:** 22 (before verification + dedup)
- **Verified findings:** 16 (3 Important, 13 Suggestions)
- **Filtered out:** 6 (3 rejected — `EH-1` defensive style, `EH-4` unreachable in current callers, `PA-3` internal bookkeeping; 2 deduped — `EH-3` + `SEC-1`, `EH-7` + `CC-1`; 1 finding from Logic specialist withdrawn at conf<60)
- **Steering files consulted:** `CLAUDE.md`, `docs/roadmap.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, prior `paad/code-reviews/ovid-miscellaneous-fixes-*` reports
