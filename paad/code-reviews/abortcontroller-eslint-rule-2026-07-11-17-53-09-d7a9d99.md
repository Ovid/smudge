# Agentic Code Review: abortcontroller-eslint-rule

**Date:** 2026-07-11 17:53:09
**Branch:** abortcontroller-eslint-rule -> main
**Commit:** d7a9d99b797013212773365d328f6397ad023699
**Files changed:** 15 | **Lines changed:** +892 / -164 (code: +178 / -164; the rest are docs)
**Diff size category:** Medium (deletion-heavy)

## Executive Summary

Clean, well-executed refactor (Phase 4b.17): it replaces ~157 lines of imperative,
hand-maintained vitest allowlist machinery that banned hand-rolled
`useRef<AbortController>` with a single declarative ESLint `no-restricted-syntax`
selector plus inline `eslint-disable` comments on the 7 justified survivors. **No
Critical or Important issues.** Verified empirically: `lint:check` is green
tree-wide, both edited test files pass, and the rule genuinely fires against the
real config (the new test loads `eslint.config.js` via `overrideConfigFile`, so it
guards the production rule, not a copy). The one confirmed defect is a
low-severity, undocumented coverage gap relative to the deleted regex (qualified
type names), plus a minor test-redundancy cleanup. Confidence in this assessment:
high — findings were empirically verified, not just AST-reasoned.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1] Undocumented coverage gap: qualified type names slip the rule.**
  `eslint.config.js:184` — the selector `TSTypeReference[typeName.name='AbortController']`
  does **not** fire on `useRef<globalThis.AbortController>` or
  `useRef<NodeJS.AbortController>`, because a qualified name parses to a
  `TSQualifiedName` (which has no `.name`, only `.left`/`.right`). The deleted regex
  `/useRef\s*<[^>]*\bAbortController\b/` *did* catch these textually. **Empirically
  confirmed** (linting `useRef<globalThis.AbortController | null>(null)` yields 0
  violations). Zero such sites exist today (`AbortController` is used bare
  everywhere), so this is not urgent — but the sibling `React.useRef` member-expression
  gap is explicitly documented in the same comment block while this one is silent.
  Fix: either document it alongside the existing "DELIBERATE GAP" note (cheapest,
  matches the codebase's "add a selector when it shows up" discipline) or add
  `[typeName.right.name='AbortController']` as a second selector. Found by: Logic &
  Correctness. Confidence: High (confirmed).

- **[S2] `React.useRef` / aliased-import gaps.** `eslint.config.js:184` keys on
  `callee.name='useRef'`, so `React.useRef<AbortController>` (documented) and
  `import { useRef as ur } from 'react'` (undocumented) would both slip. Grep
  confirms **zero** occurrences of either in the tree today, and the DOM-global
  member gap is already called out in the rule comment. No action needed beyond
  optionally naming the alias gap next to the member gap. Found by: Logic, Edge
  Cases.

- **[S3] Redundant test case (over-engineering / ponytail).**
  `eslintAbortControllerRule.test.ts` "multi-line generic form" (test 4) is
  AST-identical to the `| null` union case (test 2): esquery matches on the parsed
  AST, so whitespace/newlines are irrelevant — the descendant-through-union path is
  already pinned by test 2. The old regex test needed the multi-line case (regexes
  see newlines); the AST rule does not. Safe to drop test 4. The other combinator
  cases each earn their keep: plain (direct child), union (descendant through
  `TSUnionType`), nested (deeper descendant). Found by: Over-engineering lens.

## Plan Alignment

Design/plan docs consulted:
`docs/plans/2026-07-11-abortcontroller-eslint-rule-design.md`,
`docs/plans/2026-07-11-abortcontroller-eslint-rule-plan.md`,
`docs/roadmap-decisions/2026-07-11-phase-4b-17-abortcontroller-eslint-rule.md`.

- **Implemented:** ESLint rule banning hand-rolled `useRef<AbortController>`;
  deletion of the `PHASE_4B_3B_ALLOWLIST` + regex structural check + regex-contract
  test; inline `eslint-disable` on all 7 survivors; contract test that lints against
  the real config; CLAUDE.md Rule 4 + roadmap updated to describe the new model.
  Survivor count is internally consistent: roadmap "6 across 5 files" = second-tier
  survivors excluding the hook; +1 canonical `useAbortableAsyncOperation` hook = 7
  total disables.
- **Deviations:** None. The one intentional behavior shift — real-tree enforcement
  moves from `make test`/`make cover` (old vitest scan) to the `lint:check` step
  (`make all` + CI) — is deliberate and documented (CLAUDE.md Rule 4, commit
  558b494). CI runs `lint:check` on every push/PR to main (`.github/workflows/ci.yml`),
  so the merge gate is intact; only the *local* early-warning moves from `make test`
  to `make all`. Not a regression.

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness (selector correctness, old-vs-new coverage delta)
  - Contract & Integration (enforcement handoff, scope drift, survivor accounting, steering-file consistency)
  - Error Handling & Edge Cases + Over-engineering/ponytail (bypasses, disable-comment hygiene, test proportionality)
  - Verifier: performed inline by the orchestrator (empirical lint + test runs)
- **Scope decision (disclosed, not silently dropped):** Security and Concurrency
  specialists were **not** dispatched — this diff is an ESLint-config + test refactor
  with no runtime code path, no shared mutable state, and no input/output boundary,
  so those lenses would yield only noise.
- **Scope:** `eslint.config.js`, `eslintAbortControllerRule.test.ts` (new),
  `migrationStructuralCheck.test.ts` (edited), the 7 survivor files, plus adjacent
  `eslintRuleHarness.ts`, `Makefile`, `package.json`, `.github/workflows/ci.yml`,
  and CLAUDE.md.
- **Empirical verification performed:** `npm run lint:check` (green tree-wide);
  `eslintAbortControllerRule.test.ts` (8/8 pass); `migrationStructuralCheck.test.ts`
  (8/8 pass after deletion — no dangling refs); temp test confirming the qualified-name
  gap [S1] and confirming the rule fires on the plain form.
- **Raw findings:** 5 (before verification)
- **Verified findings:** 3 (all Suggestions)
- **Filtered out:** 2 (the "React.useRef gap" and "local-feedback-timing shift" were
  confirmed real but are already documented/deliberate, so folded into S2 / Plan
  Alignment rather than raised as defects)
- **Steering files consulted:** CLAUDE.md (updated by this branch; consistent with code)
- **Plan/design docs consulted:** the three Phase 4b.17 docs listed above
