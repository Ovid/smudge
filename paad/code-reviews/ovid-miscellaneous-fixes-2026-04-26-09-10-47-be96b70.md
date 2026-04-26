# Agentic Code Review: ovid/miscellaneous-fixes

**Date:** 2026-04-26 09:10:47
**Branch:** ovid/miscellaneous-fixes -> main
**Commit:** be96b702de1f96a681c0980c6da7faf9c7fa19bc
**Files changed:** 17 | **Lines changed:** +2270 / -84
**Diff size category:** Medium (code+tests ~1059 lines; remainder is plan docs)

## Executive Summary

Round 3 of code-review follow-ups for Phase 4b.3a. Two security/contract files received meaningful changes (`packages/client/src/sanitizer.ts`, `packages/client/src/errors/scopes.ts`); the remainder are doc-only comment, a new e2e test, e2e formatting, and ~1,600 lines of plan docs. Bug density is low — the substantive code is correct, well-commented, and verified against DOMPurify 3.4.0 source and the server emit path. **One Suggestion-level finding** survives verification: the `image.delete` extras validator accepts empty-string chapter titles, producing malformed `aria-live` copy on hostile envelopes.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1] Empty-string titles bypass `image.delete` extras validation** — `packages/client/src/errors/scopes.ts:274`. The validator accepts any `title` whose `typeof === "string"`, including `""`. Envelope `{ chapters: [{ title: "" }, { title: "" }] }` passes the round-2 `valid.length === 0` guard (length is 2) and produces an `announce` of `"This image is used in: , . Remove it from those chapters first."` — exactly the malformed copy the round-2 I2 reasoning was meant to prevent. Server `UpdateChapterSchema` enforces `z.string().trim().min(1)` (`packages/shared/src/schemas.ts:63`), so legitimate traffic never carries `""` — this is hostile-input territory only. **Fix:** add `|| obj.title.length === 0` to the title check at line 274. **Found by:** Error Handling & Edge Cases.

## Plan Alignment

Plan docs found at `docs/plans/2026-04-25-4b3a-review-followups-design.md` and `docs/plans/2026-04-25-4b3a-review-followups-plan.md` (Phase 4b.3a). Roadmap entry updated to mark Phase 4b.3 done and 4b.3a in-progress with the plan link.

- **Implemented:** I14 (sanitizer URI hardening), S1/S2/S3/S4/S5/S6/S21/I1/I2 (image.delete extras hardening), server-side regex divergence documented (S1).
- **Not yet implemented:** Other clusters (C/D/E) of the 4b.3a follow-up plan are not part of this branch — neutral, partial implementation is expected per the cluster-per-PR rule.
- **Deviations:** None contradicting the plan. The branch name `ovid/miscellaneous-fixes` and the diff scope (sanitizer + extras + e2e helpers + a `.claude/skills/roadmap/SKILL.md` tweak + plan docs) is broader than a single 4b.3a cluster, but the substantive code changes line up with cluster items called out in the plan.

## PR Shape (Informational, Non-Bug)

These were raised by the Contract & Integration specialist but do not meet the bug threshold; recording for future-PR consideration only:

- The branch bundles sanitizer URI hardening, `image.delete` extras hardening, e2e uniqueness fixes, a server doc comment, plan docs, and a `.claude/skills/roadmap/SKILL.md` skill update. CLAUDE.md "Pull Request Scope" prefers tighter PRs; the skill update in particular is orthogonal to 4b.3a follow-ups and could be a separate PR.
- The `${Date.now()}-${crypto.randomUUID()}` slug-uniqueness fix was copy-pasted (with the same explanatory comment) into 8 e2e specs. A shared `e2e/helpers.ts` would prevent silent drift if a future edit reverts one file.

Neither is a defect today; both are flagged so the next refactor PR can address them deliberately.

## Review Metadata

- **Agents dispatched:** 5 specialists in parallel — Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security
- **Scope:** changed files + adjacent — `sanitizer.ts`, `scopes.ts`, `apiErrorMapper.ts`, `api/client.ts`, `images.references.ts`, `images.service.ts`, `images.routes.ts`, `editorExtensions.ts`, `EditorPage.tsx`, `ImageGallery.tsx`, `PreviewMode.tsx`, `strings.ts`, sanitizer + apiErrorMapper test suites, the new e2e + the bulk-edited e2e specs, plus `node_modules/dompurify/dist/purify.js` for hook-semantic verification
- **Raw findings:** 4 (1 Logic — none, 1 Error Handling, 3 Contract & Integration, 0 Concurrency, 0 Security)
- **Verified findings:** 1 (Suggestion)
- **Filtered out:** 3 (process concern out of scope, refactor opportunity with no current defect, false positive that the reporting specialist self-flagged)
- **Steering files consulted:** `/Users/ovid/projects/smudge/CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`

### Notable verifications (correctness confirmed against source)

- DOMPurify 3.4.0's hardcoded `DATA_URI_TAGS` carve-out *does* let `<img src="data:...">` through the singleton even when `ALLOWED_URI_REGEXP` is set; the `uponSanitizeAttribute` hook closes that gap.
- `DOMPurify(window)` returns a fresh instance, not a singleton mutation — singleton pollution test is order-independent.
- `for (const cp of s)` with early `break` in `truncateCodePoints` does NOT materialize the full code-point array (unlike `Array.from(s).slice(...).join("")`); the bound is genuinely O(max).
- `slice(0, 51)` boundary case: `[50 valid, 1 invalid at index 50]` correctly triggers all-or-nothing reject (valid:50 ≠ candidates:51).
- Server emits `{ id, title, trashed: !!ch.deleted_at }` — the client validator's optional `id`/`trashed` matches.
- `sanitizer.ts` is never imported server-side, so `DOMPurify(window)` cannot fail at SSR boundaries.
