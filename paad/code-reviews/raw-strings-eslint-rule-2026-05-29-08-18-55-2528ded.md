# Agentic Code Review: raw-strings-eslint-rule

**Date:** 2026-05-29 08:18:55
**Branch:** raw-strings-eslint-rule -> main
**Commit:** 2528dedb341601eb48640822a878a0de5de8b7af
**Files changed:** 14 | **Lines changed:** +1486 / -46
**Diff size category:** Large (by line count; ~1,300 of the insertions are the three intent docs — the actual code surface is small)

## Executive Summary

Phase 4b.4 adds a letters-only `no-restricted-syntax` ESLint rule (six esquery selectors) that flags raw word-bearing UI strings in JSX, extracts a shared ESLint test harness, names the FindReplacePanel toggle glyphs, and exempts four test fixtures. The change is clean, well-tested (28/28 rule tests pass, whole client tree lints at exit 0), and fully spec-compliant with no out-of-scope additions. No Critical or Important issues. Three Suggestion-level findings remain, all latent selector/test-coverage gaps with no live violation in the current tree — the rule works correctly for the common cases and these are hardening opportunities, not bugs in the merged result.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1] Selectors miss raw strings in ternary/logical JSX children & attributes** (`eslint.config.js`, Logic & Correctness, conf Medium/75). `<div>{cond ? "Yes" : "No"}</div>`, `<div>{cond && "Saved"}</div>`, and the same forms in `aria-label={...}` all escape the rule — the `JSXExpressionContainer > Literal`/`TemplateLiteral` selectors require the literal to be a *direct* child, but a `ConditionalExpression`/`LogicalExpression` intervenes. Common React idiom; not listed in the design's Out-of-Scope. Latent (existing ternaries use `STRINGS`). Fix: use a descendant combinator (`JSXElement > JSXExpressionContainer Literal[value=/\p{L}/u]`) or add explicit `ConditionalExpression`/`LogicalExpression`-operand selectors, plus positive test cases for the ternary and `&&` forms.
- **[S2] Fragment-wrapped literal/template children not flagged** (`eslint.config.js`, Logic & Correctness, conf Medium/70). `<>{"Save"}</>` and `` <>{`Save`}</> `` produce 0 hits because a fragment parses as `JSXFragment`, not `JSXElement`, and those selectors anchor to `JSXElement >`. Note `<>Save</>` (bare text) *is* caught (the `JSXText` selector has no parent constraint), so the gap is specifically the container-wrapped forms inside a fragment. Fragments appear in 6 production component files. Latent. Fix: broaden the parent, e.g. `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[...]`; a descendant-combinator fix for S1 that also includes `JSXFragment` resolves both.
- **[S3] Positive-case assertions under-specify (test rigor)** (`packages/client/src/__tests__/eslintRawStringsRule.test.ts`, Logic & Correctness, conf Medium/62). `rawStringMessages()` filters only by `ruleId === "no-restricted-syntax"` and positives assert `>= 1`; the seq-ref selector and all six raw-string selectors share that ruleId, so a positive could in principle pass via the wrong selector. Confirmed *not* masking today — each positive currently fires exactly one distinct selector message and all six are represented, so breaking any single selector still fails its case. Hardening only: assert on the selector-specific `message` text (e.g. `/Raw UI string/`) rather than just the ruleId.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance (6 specialists, parallel) + 1 Verifier
- **Scope:** `eslint.config.js`; `packages/client/src/__tests__/eslintRuleHarness.ts`; `packages/client/src/__tests__/eslintRawStringsRule.test.ts`; `packages/client/src/__tests__/eslintSequenceRule.test.ts`; `packages/client/src/components/FindReplacePanel.tsx`; `packages/client/src/__tests__/{ChapterTitle,EditorPageFeatures,ReferencePanel}.test.tsx`; docs (`CLAUDE.md`, `docs/roadmap.md`, `docs/roadmap-decisions/*`, `docs/plans/2026-05-28-raw-strings-eslint-rule-{design,plan}.md`)
- **Raw findings:** 3 (before verification)
- **Verified findings:** 3 (after verification)
- **Filtered out:** 0
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 0
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md` (no contradictions found — the §String externalization edit matches the implemented rule)
- **Intent sources consulted:** `docs/plans/2026-05-28-raw-strings-eslint-rule-design.md`, `docs/plans/2026-05-28-raw-strings-eslint-rule-plan.md`, `docs/roadmap-decisions/2026-05-29-phase-4b-4-raw-strings-eslint-rule.md`, `docs/roadmap.md` (Phase 4b.4), recent commit messages, branch name
- **Verifier warnings:** none
