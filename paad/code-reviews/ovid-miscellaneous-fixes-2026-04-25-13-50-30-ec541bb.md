# Agentic Code Review: ovid/miscellaneous-fixes

**Date:** 2026-04-25 13:50:30
**Branch:** ovid/miscellaneous-fixes -> main
**Commit:** ec541bb592077fb12dcbc8f4a8183596aaad894c
**Files changed:** 9 | **Lines changed:** +1831 / -12 (code only: ~+237 / -12; remainder is plan/design docs)
**Diff size category:** Small (code) / Large (with docs)

## Executive Summary

The branch delivers PR 1 of Phase 4b.3a (Cluster D): two security hardenings — DOMPurify URI tightening (I14) and `image.delete` chapters bounding (S21) — plus accompanying unit and e2e tests. The implementation is substantively correct: server-side UUID gating, MIME allowlist, magic-byte verification, and prototype-pollution stripping in the API client mean the verified findings reduce to defense-in-depth polish, not exploitable bugs. The most actionable issue is **F4** — the truncation refactor weakened the original "all-or-nothing per-element shape" semantic to "first 50 only must be well-formed," which is a small but real regression of S5's hardening.

## Critical Issues

None found.

## Important Issues

### [I1] `valid.length === bounded.length` weakens S5 all-or-nothing narrowing

- **File:** `packages/client/src/errors/scopes.ts:217`
- **Bug:** Pre-S21 the check was `valid.length === chapters.length` (full all-or-nothing). After S21 it is `valid.length === bounded.length`, comparing only the first 50 elements. A hostile envelope of `[50 valid, 1 invalid]` now silently surfaces 50 chapters instead of triggering the fallback that S5 was added to enforce.
- **Impact:** Latent. Today the consumer `ImageGallery.tsx:334-338` only reads `title`/`trashed`, so no observable misbehavior. But the `extras` contract no longer guarantees "every entry passed shape narrowing" the way the S5 comment claims it does, and a future consumer that reads any other field would inherit the gap.
- **Suggested fix:** Validate the full `chapters` array before slicing, e.g. `if (!chapters.every(isValid)) return undefined;` then `slice(0, 50)`. Alternatively explicitly accept the new semantic in the comment (the existing comment says "preserves all-or-nothing" which is no longer accurate post-slice).
- **Confidence:** High (80)
- **Found by:** Logic & Correctness, Error Handling & Edge Cases (verifier confirmed)

### [I2] Sanitizer test suite missing coverage for `<svg>`, `<math>`, `<audio>`, `<video>`, `<source>`, `<track>`, `<base>`

- **File:** `packages/client/src/__tests__/sanitizer.test.ts`
- **Bug:** Tests pin the allowlist for `<a>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<style>`, `<link>`, `<meta>`, `<script>` — but not the mXSS-relevant `<svg>`/`<math>` namespaces nor the media tags whose `src`/`srcset` would otherwise hit the new URI hook. A future config tweak (e.g. switching from `ALLOWED_TAGS` to `FORBID_TAGS`) would remove the implicit allowlist with no failing test.
- **Impact:** Defense-in-depth coverage gap. Today these tags are stripped by the explicit `ALLOWED_TAGS` list, but no regression test pins that contract.
- **Suggested fix:** Add `it("strips <svg>/<math>/<audio>/<video>/<source>/<track>/<base>")` asserting these tags are absent from sanitized output.
- **Confidence:** High (80)
- **Found by:** Security (verifier confirmed)

## Suggestions

- **`packages/client/src/sanitizer.ts:45`** — Client `ALLOWED_URI_REGEXP = /^\/api\/images\//i` is asymmetric with the server's `IMAGE_REFERENCE_REGEX` at `packages/server/src/images/images.references.ts:20-23`, which accepts `^(?:https?://[^/]+)?/api/images/<uuid>`. Today no writer emits absolute URLs, but if one ever does, the server will count the reference (delete blocked with `IMAGE_IN_USE`) while the client sanitizer strips the `src` (broken `<img>` with no diagnostic). Either lift the regex into `@smudge/shared` so both sides use one source of truth, or document the divergence. (Confidence 85; Contract & Integration)

- **`packages/client/src/sanitizer.ts:53-60`** — `DOMPurify.addHook` mutates the package-level singleton at module load. Today only `sanitizer.ts` imports DOMPurify (verified via grep), so impact is zero. The "registered once at module load" comment holds in production but not under Vite HMR or test module re-import. Consider scoping to a private `DOMPurify(window)` instance or adding an ESLint `no-restricted-imports` rule for `dompurify` outside `sanitizer.ts`. (Confidence 70; Logic, Edge, C&I, Security agreed)

- **`packages/client/src/errors/scopes.ts:212-216`** — `{ ...obj, title: title.slice(0,200) }` spreads `Record<string, unknown>`, propagating any non-`title`/`trashed` fields the server emits. Outer `MAX_EXTRAS_KEYS=16` in `api/client.ts:91-102` does not recurse into `chapters[i]`, so a 50-entry array each carrying an unbounded `description` field bypasses the per-field cap. Today inert (`ImageGallery.tsx:334-338` only reads `title`/`trashed`), but inconsistent with S5's stated intent. Build a whitelisted-shape object instead: `{ title: title.slice(0, 200), ...(obj.trashed === true ? { trashed: true } : {}) }`. (Confidence 75; Edge + Security)

- **`packages/client/src/errors/scopes.ts:215`** — `title.slice(0, 200)` operates on UTF-16 code units and can split a surrogate pair, leaving a lone surrogate that the DOM renders as U+FFFD. Cosmetic only, but below the house standard CLAUDE.md cites for `Intl.Segmenter`-correct word counting. Use `Array.from(title).slice(0, 200).join("")` if perfection matters. (Confidence 75)

- **`packages/client/src/errors/scopes.ts:203`** — Cap of 50 is silent; `ImageGallery.tsx:335-338` renders the truncated list via `S.deleteBlocked(chapters)` with no "and N more" indicator. If a real-world image is referenced by >50 chapters, the user fixes 50, retries delete, hits another 409, and is forced to repeat. Add a count-only field (`extras.totalChapters: number`) or surface a "+N more" affordance. (Confidence 70)

- **`e2e/sanitizer-snapshot-blob.spec.ts:142-144`** — Negative-presence assertions (`not.toContain("data:image")`, `not.toContain("javascript:")`) would pass if a future regression left an empty `<img src="">` or partially-stripped attribute. The benign-text positive-presence check at line 137 gates rendering, which is good — but a stricter assertion (`not.toMatch(/<img[^>]*src=/i)`) would tighten the contract. (Confidence 65)

## Plan Alignment

Plan documents consulted: `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`.

- **Implemented:** Cluster D (PR 1) — [I14] sanitizer hardening, [S21] `extrasFrom` bounding, Cluster D unit tests, Cluster D e2e (`sanitizer-snapshot-blob.spec.ts`), and the roadmap-update bookkeeping.
- **Not yet implemented (expected — partial implementation by design):** Cluster A (PR 2: [I1], [I2], [S1] error-mapping items), Cluster B (PR 3: AbortSignal threading [S12], [I6]–[I12]), Cluster C (PR 4: 14 consumer-recovery items + `applyMappedError` helper), Cluster E (PR 5: [S6], [S9], [S13], [S14], CLAUDE.md edits).
- **Deviations:**
  - Plan §Task 1.1 specified only `ALLOWED_URI_REGEXP` as the DOMPurify config option; implementation also adds `DOMPurify.addHook("uponSanitizeAttribute", ...)` to defeat DOMPurify 3.x's hardcoded `DATA_URI_TAGS` carve-out (documented in the in-code comment). Justified by a failing test that wouldn't pass without it; worth noting because the hook also covers `href`/`xlink:href` which the plan did not call out.
  - Test file landed at `packages/client/src/__tests__/sanitizer.test.ts` (existing co-located convention) rather than the plan's literal `packages/client/src/sanitizer.test.ts`. Not substantive.
  - `extrasFrom` literal shape differs from the plan's example (returns `valid.length === bounded.length` rather than the plan's `valid.length > 0`) — intentional, preserves the all-or-nothing semantic but as I1 notes, only over the first 50.

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness
  - Error Handling & Edge Cases
  - Contract & Integration
  - Security
  - Plan Alignment
  - Verifier (single-pass)
- **Scope:** changed code (`sanitizer.ts`, `scopes.ts`, `apiErrorMapper.test.ts`, `sanitizer.test.ts`, `sanitizer-snapshot-blob.spec.ts`, `.claude/skills/roadmap/SKILL.md`) plus adjacent callers (`EditorPage.tsx:46-69`, `PreviewMode.tsx:3-76`, `ImageGallery.tsx:300-345`, `apiErrorMapper.ts`, `api/client.ts` extras handling, `images.references.ts`, `images.routes.ts`)
- **Raw findings:** ~16 (across 5 specialists)
- **Verified findings:** 8 (2 Important, 6 Suggestion)
- **Filtered out:** ~8 (rejected: regex path-traversal claim refuted by server-side `requireUuidParam`; "missing `javascript:` unit test" claim refuted — test exists at `sanitizer.test.ts:29-33`; under-confidence findings on test-quality nits)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:**
  - `docs/plans/2026-04-25-4b3a-review-followups-design.md`
  - `docs/plans/2026-04-25-4b3a-review-followups-plan.md`
