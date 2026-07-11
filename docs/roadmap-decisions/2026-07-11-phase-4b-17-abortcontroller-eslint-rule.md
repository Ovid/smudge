---
date: 2026-07-11
phase: "Phase 4b.17: AbortController ESLint Rule"
model: claude-opus-4-8
design_file: docs/plans/2026-07-11-abortcontroller-eslint-rule-design.md
plan_file: docs/plans/2026-07-11-abortcontroller-eslint-rule-plan.md
pushback:
  total: 2
  critical: 0
  important: 1
  minor: 1
alignment:
  total: 1
  critical: 0
  important: 0
  minor: 1
---

# Phase 4b.17: AbortController ESLint Rule — Decision Log

## Pushback Findings

### [1] esquery selector matching TS type nodes is unproven in-repo
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The whole rule hinges on esquery + the `typescript-eslint` parser traversing TypeScript-only AST nodes (`TSTypeParameterInstantiation`, `TSTypeReference`) and the `CallExpression > TSTypeParameterInstantiation` child edge resolving. Every existing `no-restricted-syntax` selector in `eslint.config.js` targets a plain-JS node (`BinaryExpression`, `JSXText`, `Literal`), so the repo has no precedent proving the TS-node match works. If the selector silently never matched, the rule would ship as a green no-op. A helpful backstop was confirmed — `make lint` runs `--max-warnings 0` and ESLint 9 flat config defaults `reportUnusedDisableDirectives` to `"warn"`, so a non-firing rule turns the 6 inline disables into 6 unused-directive failures — but that is a backstop, not proof.
- **Resolution:** fixed-in-design — added a RED-first requirement (the contract test must fail before the rule exists, proving the selector fires), a documented fallback selector (`CallExpression[callee.name='useRef'] TSTypeReference[typeName.name='AbortController']`) if the child combinator doesn't resolve, and a note on the unused-directive safety net; the plan encodes the RED-first ordering as Task 1.

### [2] New rule's file scope silently widens to include test files
- **Severity:** Minor
- **Category:** Omission
- **Summary:** The deleted tree-walk (`collectTsSources`) explicitly excluded `__tests__/` and `*.test.*`. The new rule lives in the client block (`packages/client/**/*.{ts,tsx}`), which includes client test files (the test-scope block at `eslint.config.js:26` only turns off `no-non-null-assertion`). Verified safe today: the only `useRef<AbortController>` occurrences in test code are string literals and comments (all being deleted), and the AST selector matches `CallExpression` nodes, not strings. The consequence worth recording is that the contract test's disabled fixture must sit on a genuinely matching line, or `reportUnusedDisableDirectives` + `--max-warnings 0` turns it into a `lintText` failure.
- **Resolution:** fixed-in-design — added a "Rule scope (intentional change)" note documenting the wider scope as desirable and the disabled-fixture placement constraint; the plan's Task 1 Step 5 places the fixture disable on a matching line.

## Alignment Findings

### [1] Plan reconciles stale comments the design never mentions
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** Plan Task 2 edits the stale "Phase 4b.4 replaces this file-level allowlist entry…" forward-reference comments in `useSnapshotState.ts`, `useTrashManager.ts`, and `HomePage.tsx` (correct — those comments predict a future 4b.4 edit that 4b.17 is now making). But the design said only "the existing prose justification block above each ref stays," reading as don't-touch-the-prose. Plan and design were out of step on this point.
- **Resolution:** fixed-in-design — added a paragraph to the design's "Inline disables" section recording that the three stale forward-reference comments are reconciled (replaced by the actual disable) when the disables land, with the rest of each ref's justification prose preserved.

## Summary

- Pushback raised 2 issues; both resulted in design changes (1 Important feasibility de-risk via RED-first + fallback selector; 1 Minor scope/omission note). None dismissed.
- Alignment raised 1 issue; it resulted in a design change (design-gap closed so the plan's comment-reconciliation is recorded intent).
- Notable side-finding, surfaced during brainstorming and baked into both docs: the roadmap prose's "4 surviving sites / 4 allocations" is stale — the F-2 split (2026-05-29) made it 6 allocations across 5 files. The plan's Task 5 corrects the roadmap prose.
