# Agentic Code Review: ovid/miscellaneous-fixes

**Date:** 2026-04-25 18:18:13
**Branch:** ovid/miscellaneous-fixes -> main
**Commit:** 2c9fdf4db1ce3e26ead42d53672c6e4979dcbcf1
**Files changed:** 10 | **Lines changed:** +2000 / -6
**Diff size category:** Large (bulk is plan/design docs; actual code changes are ~95 lines across 3 files plus tests)

## Executive Summary

This branch implements Phase 4b.3a Cluster D from the review-followups plan: tightening the client sanitizer's URI policy via a private DOMPurify instance with an `uponSanitizeAttribute` hook, and bounding the `image.delete` 409 error envelope's `chapters` array. The targeted invariants (S1, S2, S3, S4, S6, S21, I1, I2, I14) are correctly implemented with strong test coverage. The most consequential finding is **F15** — `chapters[i].id` is copied verbatim without a length cap, leaving a documented S21 bound (50 entries × 200-char title) one slot short of complete. F7 (empty `chapters: []` produces a malformed screen-reader announcement) and F10 (a misleading server-contract comment) are real but low-likelihood. No critical issues.

## Critical Issues

None found.

## Important Issues

### [I1] `chapters[i].id` is unbounded — bypasses S21's bounded-extras intent
- **File:** `packages/client/src/errors/scopes.ts:227-231`
- **Bug:** S21 caps the array at 50 entries and S4 truncates `title` to 200 code points, but `id` is copied through verbatim. The S21 design comment claims "30KB max", but only `title` is enforced. A malformed/hostile envelope of 50 entries × 1MB `id` strings produces ~50MB extras. The API client's `MAX_EXTRAS_KEYS` cap does not recurse into arrays.
- **Impact:** Real DoS surface against the UI/announcer for a hostile or compromised server, contradicting the documented S21 contract. Note: server-side `images.service.ts` always emits valid UUIDs, so legitimate traffic is unaffected.
- **Suggested fix:** Either drop `id` entirely (no consumer reads it today — see [S2] below), or bound it the same way:
  ```ts
  ...(c.id !== undefined ? { id: Array.from(c.id).slice(0, 64).join("") } : {}),
  ```
- **Confidence:** High
- **Found by:** Security

### [I2] Empty `chapters: []` produces a malformed announcement
- **File:** `packages/client/src/errors/scopes.ts:217-232`, `packages/client/src/components/ImageGallery.tsx:334`
- **Bug:** The validator accepts `chapters: []` (`Array.isArray` passes, `valid.length === chapters.length` is `0 === 0`). The consumer reads `extras?.chapters` (truthy for `[]`) and passes the empty array to `S.deleteBlocked([])` which interpolates `chapters.join(", ")` — producing `"This image is used in: . Remove it from those chapters first."` with a stray colon-space-period.
- **Impact:** Server contract (`images.service.ts:186`) only emits the envelope when `referencingChapters.length > 0`, so this is hostile/malformed-server territory. But screen readers announce a confusing fragment. Low likelihood, real bug if it ever fires.
- **Suggested fix:** Reject empty arrays in the validator:
  ```ts
  if (chapters.length === 0) return undefined;
  ```
  Validator-side is the right place — it's already the gatekeeper; the consumer doesn't need to learn the empty-array rule.
- **Confidence:** High
- **Found by:** Error Handling, Contract & Integration

### [I3] Misleading comment cites the wrong server scanner
- **File:** `packages/client/src/errors/scopes.ts:199-201`
- **Bug:** The S21 comment justifies the 50-chapter cap by referencing `scanImageReferences` ("filters to non-deleted chapters in a single project"). But the 409 IMAGE_IN_USE envelope is built in `images.service.ts:154-197` (`deleteImage`), which calls `listAllChapterContentByProject` and explicitly **includes trashed chapters** (`trashed: !!ch.deleted_at`). `scanImageReferences` is the read-only GET path.
- **Impact:** Doc accuracy. Future maintainers reasoning about the cap will look at the wrong code path. The cap itself remains correct in practice.
- **Suggested fix:** Rewrite the comment to cite `listAllChapterContentByProject` (the actual delete-side scanner) and acknowledge trashed chapters are included.
- **Confidence:** High
- **Found by:** Contract & Integration

## Suggestions

- **[S1]** `Array.from(title).slice(0, 200).join("")` truncates by code point, not grapheme — combining marks/ZWJ sequences can be split. The S4 comment honestly claims only surrogate-pair correctness, so no false advertising; cosmetic only. `packages/client/src/errors/scopes.ts:229`. Found by Logic & Correctness, Error Handling.
- **[S2]** `id?` field in the narrowed shape is dead plumbing — only `title` and `trashed` are read by `ImageGallery.tsx:334-338`. Dropping it also closes [I1] in one edit. `packages/client/src/components/ImageGallery.tsx:335`. Found by Contract & Integration.
- **[S3]** No test pins `ALLOWED_ATTR.length === 2` — future widening (e.g. adding `srcset`) wouldn't be caught. One-line fix: export `ALLOWED_ATTR`, add `expect(ALLOWED_ATTR).toEqual(["src", "alt"])`. `packages/client/src/sanitizer.ts:49`. Found by Security.
- **[S4]** Sanitizer is the only render defense; no enforcement (ESLint, branded type) prevents a future `dangerouslySetInnerHTML` site from skipping `sanitizeEditorHtml`. Today both call sites are correct. `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/components/PreviewMode.tsx`. Found by Security.
- **[S5]** Substring assertions like `not.toContain("data:")` are weaker than the e2e's S6 regex `/<img[^>]*\bsrc=/i`. Replace unit-test `toContain` with the same regex shape. `packages/client/src/__tests__/sanitizer.test.ts:112`, `e2e/sanitizer-snapshot-blob.spec.ts:143-144`. Found by Security.
- **[S6]** `Sanitizer Test ${Date.now()}` title risks collision under Playwright sharding (millisecond resolution). Append `crypto.randomUUID()` for stronger uniqueness. Same pattern exists in other e2e files for consistency. `e2e/sanitizer-snapshot-blob.spec.ts:19`. Found by Error Handling.

## Plan Alignment

Plan/design docs consulted: `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`.

### Implemented (Cluster D + opportunistic slices)
- [I14] sanitizer `ALLOWED_URI_REGEXP` + `uponSanitizeAttribute` hook closing the DATA_URI_TAGS carve-out — `sanitizer.ts:70-92`, with unit tests at `sanitizer.test.ts:109-119` and e2e at `sanitizer-snapshot-blob.spec.ts`.
- [S2] private DOMPurify instance via `DOMPurify(window)` — `sanitizer.ts:12`. Regression test pins no-pollution at `sanitizer.test.ts:166-170`.
- [S21] image.delete chapters cap (50) + title truncation (200 chars) — `scopes.ts:227-231`, tested at `apiErrorMapper.test.ts:473-492`.
- [S3] explicit allowlisted shape (`id?`, `title`, `trashed?`) — `scopes.ts:218-231`, tested at `apiErrorMapper.test.ts:514-532`.
- [S4] code-point safe truncation — `scopes.ts:229`, tested at `apiErrorMapper.test.ts:538-549`.
- [I1] (Cluster D variant) full-array shape validation before bounding — `scopes.ts:226`, tested at `apiErrorMapper.test.ts:499-506`.
- [I2] (Cluster D variant) implicit-allowlist tests for `<svg>`/`<math>`/media tags/`<base>` — `sanitizer.test.ts:127-157`.
- [S1] (Cluster D variant) cross-reference comments documenting the intentional sanitizer-vs-server-regex asymmetry — `sanitizer.ts:57-69`, `images.references.ts:21-29`.
- [S6] e2e regex assertion `/<img[^>]*\bsrc=/i` tightening — `sanitizer-snapshot-blob.spec.ts:151`.

### Not yet implemented (Clusters A, B, C, and most of E)
Partial — expected, since the plan calls for D → A → B → C → E across separate PRs:
- **Cluster A** (PR 2): scope-coverage gaps — `chapter.reorder REORDER_MISMATCH`, `chapter.save network/404`, etc.
- **Cluster B** (PR 3): AbortSignal threading across `projects.create`, `chapters.create`, `loadProject`, `search.replace`, `ExportDialog`, etc.
- **Cluster C** (PR 4): consumer recovery completeness — `applyMappedError` helper, SnapshotPanel `possiblyCommitted`, `useTrashManager` re-fetch, [S8] graceful-degradation extras, etc.
- **Cluster E** (PR 5): mapper internals + CLAUDE.md updates — only [S2] from this cluster has shipped.

### Deviations
- **[I1]/[S8] direct contradiction.** This branch's [I1] enforces "valid.length !== chapters.length → undefined" (full-array rejection). Cluster C's [S8] (still unimplemented) explicitly asks for the opposite — "Return `{ chapters: valid }` whenever `valid.length > 0`. Loses no information; gains graceful degradation." When Cluster C lands, the [I1] guard at `scopes.ts:226` will need to be reconciled with [S8]. The plan does not flag this contradiction; it should.
- **CLAUDE.md update missing.** Plan Task 5.5 (Cluster E) calls for editing `§Key Architecture Decisions / "Unified API error mapping"` to mention `committedCodes`, `ScopeExtras<S>`, `applyMappedError`, plus a `§Pull Request Scope` exception note. `git diff main...HEAD -- CLAUDE.md` is empty. Tracked for Cluster E — not a deviation in this PR's scope, but a pending DoD item.
- **Plan-numbering collisions.** The plan re-uses `[I1]`, `[I2]`, `[S1]`, `[S2]` inside Cluster D's tests/hardening with different meanings than the original review labels (e.g. Cluster D's `[I1]` is "validate full chapters array before bounding"; Cluster A's `[I1]` is "chapter.reorder REORDER_MISMATCH"). Commit messages mix the two namespaces. Not a code defect — but future readers tracking the source review by label will be confused. Consider relabeling Cluster D's intra-tests items (e.g. `D-S1`, `D-I2`) on a follow-up plan touch-up.
- **Roadmap `<!-- plan: -->` placement.** The roadmap SKILL parser comment expects the plan annotation on the line "immediately after the `---` separator that follows that phase's section." The current placement at `docs/roadmap.md:669` is on the line after the `## Phase 4b.3a:` heading. Verify the SKILL parser still detects it.

## Review Metadata

- **Agents dispatched:** 6 specialists in parallel — Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment. Plus 1 Verifier.
- **Scope:** Changed code (`sanitizer.ts`, `scopes.ts`, `images.references.ts`, three test files) plus adjacent files (`apiErrorMapper.ts`, `ImageGallery.tsx`, `EditorPage.tsx`, `PreviewMode.tsx`, `images.service.ts`).
- **Raw findings:** 25 (across all 6 specialists, with multiple duplicates).
- **Consolidated:** 18 unique.
- **Verified findings:** 9 (3 Important + 6 Suggestion).
- **Filtered out:** 9 (false positives, acknowledged trade-offs documented in code, or working-as-designed).
- **Steering files consulted:** `CLAUDE.md` (note: §"Unified API error mapping" is stale — does not mention `committedCodes` even though the field exists; tracked under Cluster E).
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`.
- **DOMPurify version verified:** 3.4.0 (`node_modules/dompurify/package.json`). Hook ordering vs `_isValidAttribute` ladder confirmed against `node_modules/dompurify/dist/purify.cjs.js`.

### Filtered findings (with verification rationale)

For traceability — these were reported by specialists but rejected after the verifier read the code:

- *Hook check for `href`/`xlink:href` is dead.* False — DOMPurify fires the hook BEFORE the ALLOWED_ATTR drop, so the hook does see the attrs. Defense-in-depth is intentional.
- *`Array.from(title).slice(...)` allocation DoS.* Low-severity FP — server bounds chapter titles at 500 chars, multiplied by the 50-cap is sub-millisecond.
- *`DOMPurify(window)` breaks SSR/Node.* Smudge is jsdom-locked client-only with no SSR plans; no `@vitest-environment node` overrides exist.
- *Whitespace asymmetry between hook and IS_ALLOWED_URI.* Hook regex `/^\/api\/images\//i` is anchored; leading non-breaking-space fails the regex anyway.
- *`ALLOWED_URI_REGEXP` accepts `/api/images/../`.* Explicitly acknowledged trade-off in design doc — sanitizer's threat model is XSS, not path traversal; server enforces the latter.
- *e2e setup `expect(stored).toContain("javascript:alert(1)")` is brittle.* Working as intended — the test exists specifically to prove the server passes through hostile content and the client sanitizer is the closing defense.
- *S2 isolation test depends on DOMPurify defaults.* Test pins observable behavior of the package-default singleton; if a future DOMPurify version tightens the data: default, the test breaks at the right place.
- *Hook + ALLOWED_URI_REGEXP option are dual enforcement.* Documented at `sanitizer.ts:72-77` — the hook closes DOMPurify's hardcoded DATA_URI_TAGS carve-out that the option alone wouldn't catch.
- *e2e `.first()` could race re-renders.* Each snapshot row has exactly one View button; the test creates exactly one snapshot. No race surface.
