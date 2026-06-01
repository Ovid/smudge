# Agentic Code Review: tiptap-depth-guard-regression-test

**Date:** 2026-06-01 11:09:01
**Branch:** tiptap-depth-guard-regression-test -> main
**Commit:** fc946ea66d5208c0fe52b2e0ab901d1a08d924c0
**Files changed:** 6 | **Lines changed:** +963 / -4
**Diff size category:** Medium (one 164-line test file + roadmap/design/plan docs; no production code)

## Executive Summary

This is a **test-only** change implementing roadmap Phase 4b.13: a single consolidated
regression test (`packages/server/src/__tests__/tiptap-depth-walkers.test.ts`) that pins the
cross-cutting contract that all six TipTap-JSON walkers honor the shared `MAX_TIPTAP_DEPTH = 64`
cap and bail safely on over-depth structures. The review found **no defects**. Four specialist
agents hand-traced and empirically confirmed that every one of the six walker assertions is
genuinely *discriminating* — each flips to failing if that walker's `if (depth > MAX…)` bail is
removed, and none is a silent no-op. The test is correct, deterministic, well-isolated, and fully
aligned with its design/plan docs. Overall confidence: high.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- (Hygiene, out of scope for this PR) A stale build artifact `packages/shared/dist/tiptap-depth.{d.ts,js}`
  exists with no corresponding `src/tiptap-depth.ts` (the source is `tiptap-safety.ts`). It is dead —
  nothing imports `tiptap-depth` — and does not affect this test, which resolves through the
  `@smudge/shared` barrel → `src`. The design doc already notes this. Confidence 70.
- (Decision-log cosmetic, not in this test) The Phase 4b.11 reconciliation note in `docs/roadmap.md`
  states `grep -rn 'res.status(404)' packages/server/src` "returns zero matches"; it actually returns
  1 — a descriptive *comment* in `errors/appError.ts`, not a handler. The substantive claim (no
  hand-written 404 blocks remain in routes) holds. Confidence 75.

## Plan Alignment

Design/plan docs found and consulted:
`docs/plans/2026-06-01-tiptap-depth-guard-regression-test-design.md`,
`…-plan.md`, `docs/roadmap-decisions/2026-06-01-phase-4b-13-…md`, `docs/roadmap.md`.

- **Implemented:** All six Definition-of-Done coverage items are present.
  - Six walkers covered via their stated public entry points — exactly those named, none missing/extra:
    `validateTipTapDepth`, `countWords` (extractText), `extractImageIds` (walk), `searchInDoc`
    (collectLeafBlocks), `canonicalContentHash` (canonicalize), `replaceInDoc` (canonicalJSON).
  - One discriminating cap-activation assertion per walker, each with a documented "if the bail were
    removed…" negative control, matching the design's assertions table.
  - No pathologically-deep fixture (`OVER_CAP_DEPTH = 100`, not the rejected ~20k) — honors Decision 3 / pushback [2].
  - Test-file "NEW WALKER?" header documents the "import the constant + bail + add a case here" rule,
    including the seventh-walker dedup-report I5 trigger.
  - Pushback resolutions honored: two divergent marks for `canonicalJSON` (not a single uniform mark,
    pushback [1]); `blockquote` container nesting so `collectLeafBlocks` does not short-circuit on
    `LEAF_BLOCKS` (pushback [3]); logger spy + `__resetWarnedFallbackDigestsForTests()` for the
    canonicalize warn path.
  - No production-code change: `git diff main --stat` shows only the new test file plus docs; all six
    bail lines confirmed intact in production source.
- **Not yet implemented:** Nothing missing from the DoD. (`make all` green at PR close is a process gate.)
- **Deviations:** None at confidence ≥ 60.

## Verification Performed

- Working tree clean (`git status --porcelain` empty).
- All six guard lines present in production source:
  - `packages/shared/src/tiptap-safety.ts:29` — `if (depth > MAX_TIPTAP_DEPTH) return false;`
  - `packages/shared/src/wordcount.ts:26` — `if (depth > MAX_TIPTAP_DEPTH) return "";`
  - `packages/server/src/images/images.references.ts:55` — `if (depth > MAX_TIPTAP_DEPTH) return;`
  - `packages/shared/src/tiptap-text.ts:78` — `if (depth > MAX_WALK_DEPTH) return [];` (collectLeafBlocks)
  - `packages/shared/src/tiptap-text.ts:497` — `if (depth > MAX_WALK_DEPTH) return "null";` (canonicalJSON)
  - `packages/server/src/snapshots/content-hash.ts:19` — `if (depth > MAX_TIPTAP_DEPTH) throw new CanonicalizeDepthError();`
- Test run: 7/7 passed in 7ms.
- Per-walker depth-counting traced and empirically confirmed (caps removed → exactly the six assertions
  flip; constant check has no bail). Notable subtleties verified: `canonicalize` increments on both
  object AND array levels (throws `CanonicalizeDepthError` at ~depth 65, so `JSON.parse` succeeds first
  and `reason:"depth"` — not `"parse"` — fires); `canonicalJSON` counts mark-attribute nesting, and the
  divergent `v:"A"`/`v:"B"` leaf at ~depth 102 truncates to `"null"` under the cap so the two marks merge.

### Note for Ovid — environment health, not a defect

Two agents transiently observed the test failing as if every cap were absent on a *first* invocation,
non-reproducible thereafter. Root cause is the investigation's own mid-RED state / a stale `dist`
(host↔container `node_modules` crossing per CLAUDE.md), not committed code — HEAD, main, and the clean
working tree all carry the correct guards and the test passes stably. The full server suite also shows
~31 pre-existing failures in `purge.test.ts` / `images.reaper.test.ts` (filesystem/native-binding
territory) unrelated to this branch's diff. Recommend `make ensure-native` + a `dist` rebuild before
trusting a full `make test` run.

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness — per-walker two-direction trace + empirical cap-removal confirmation
  - Contract & Integration — import/export resolution, signatures, return shapes, `logger.warn` call shape, duplication
  - Test Isolation / Shared State / Edge Cases — `warnedFallbackDigests` reset, logger-spy lifecycle, determinism, fixture safety at depth 100
  - Plan Alignment — DoD coverage, pushback-resolution fidelity, scope, roadmap bookkeeping
- **Scope:** the new test plus all six walker sources (`tiptap-safety.ts`, `wordcount.ts`, `tiptap-text.ts`,
  `images.references.ts`, `content-hash.ts`), the `@smudge/shared` barrel, `logger.ts`, the existing
  `content-hash.test.ts`, and the design/plan/decision docs.
- **Raw findings:** 0 blocking (2 cosmetic/hygiene suggestions, both out of scope for this test)
- **Verified findings:** 0
- **Filtered out:** 0
- **Steering files consulted:** CLAUDE.md (zero-warnings rule, save-pipeline invariants, API design — none implicated by a test-only change)
- **Plan/design docs consulted:** the four Phase 4b.13 docs listed above
