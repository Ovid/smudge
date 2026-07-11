# Phase 4b.17: AbortController ESLint Rule — Design

**Date:** 2026-07-11
**Phase:** 4b.17 (roadmap `docs/roadmap.md`)
**Status:** Design — brainstormed, pending plan
**Author:** Ovid / Claude (collaborative)

## Goal

Replace the file-level `PHASE_4B_3B_ALLOWLIST` in
`packages/client/src/__tests__/migrationStructuralCheck.test.ts` with an ESLint
`no-restricted-syntax` rule that bans hand-rolled `useRef<AbortController>`
allocations. The justified survivors carry inline
`// eslint-disable-next-line no-restricted-syntax -- <reason>` annotations, so the
disable comment itself becomes the documented exception — collocated with the
code it justifies instead of a central census in a test file.

This finishes the enforcement story begun in Phase 4b.3b: consumer call sites
route `AbortController`-based cancellation through
`useAbortableAsyncOperation`, and the small set of documented second-tier /
simultaneously-live-controller survivors are the only remaining hand-rolled
refs.

**Writer-facing impact: none.** This is a pure internal guardrail /
maintainability change. It is worth stating plainly rather than dressing up.

## Why Now

The file-level allowlist requires lockstep updates across the allowlist `Set`
and each file's own justification comments whenever a site is migrated, added,
renamed, or split. The F-2 refactor (2026-05-29) that split `useProjectEditor`
into `useChapterCrud` + `useChapterMetadata` is exactly this: the allowlist had
to be hand-edited to move entries. An ESLint rule with inline disables makes the
disable comment the exception record — no second file to keep in sync.

## Scope correction (important)

The roadmap prose for this phase is **stale**. It says "the 4 surviving sites
(`useProjectEditor.ts`, `useSnapshotState.ts`, `useTrashManager.ts`,
`HomePage.tsx`)" and "4 surviving allocations." The F-2 split (2026-05-29) broke
`useProjectEditor.ts` into `useChapterCrud.ts` + `useChapterMetadata.ts`, and
`useChapterMetadata.ts` holds **two** refs. The reality on disk — already
reflected by `PHASE_4B_3B_ALLOWLIST` — is **6 allocations across 5 files**:

| File | Ref |
|------|-----|
| `hooks/useChapterCrud.ts` | `createRecoveryAbortRef` |
| `hooks/useChapterMetadata.ts` | `statusRecoveryAbortRef` |
| `hooks/useChapterMetadata.ts` | `titleRecoveryAbortRef` |
| `hooks/useSnapshotState.ts` | `restoreFollowupAbortRef` |
| `hooks/useTrashManager.ts` | `restoreRecoveryAbortRef` |
| `pages/HomePage.tsx` | `createRecoveryAbortRef` |

The plan and the roadmap prose should be written against **6 allocations / 5
files**, not the stale "4 / 4."

## Design

### The rule

A new `no-restricted-syntax` selector appended to the existing client-block
array in `eslint.config.js` (the same home as the seq-ref and raw-strings
rules). No custom rule plugin — the AST shape is fully expressible as a
selector, and `typescript-eslint` is the active parser for the client block, so
TS type nodes (`TSTypeReference`, `TSTypeParameterInstantiation`) are in the AST
for esquery to match.

**Selector:**

```
CallExpression[callee.name='useRef'] > TSTypeParameterInstantiation TSTypeReference[typeName.name='AbortController']
```

The **descendant** combinator (space, not `>`) after
`TSTypeParameterInstantiation` is load-bearing. One selector covers every drift
form the old regex needed a 40-line spec to pin:

- `useRef<AbortController>` — direct `TSTypeReference`
- `useRef<AbortController | null>` — `TSTypeReference` inside a `TSUnionType`
- `useRef<AbortController | undefined>` and `| null | undefined` — same
- `useRef<Record<string, AbortController>>` — nested deep (future per-key
  cancellation patterns)
- multi-line generic forms — AST is formatting-agnostic

`[typeName.name='AbortController']` is exact, so `useRef<AbortControllerWrapper>`
and `useRef<MyAbortController>` correctly do not match.

**Feasibility note (load-bearing).** Every existing `no-restricted-syntax`
selector in `eslint.config.js` targets a plain-JS node (`BinaryExpression`,
`JSXText`, `Literal`). **None matches a TypeScript-only node**, so this repo has
no precedent proving esquery + the `typescript-eslint` parser traverse type
nodes (`TSTypeParameterInstantiation`, `TSTypeReference`) or that the
`CallExpression > TSTypeParameterInstantiation` **child** edge resolves. This is
the one place the phase can fail. It is de-risked two ways:

1. **RED-first.** The contract test is written and made to fail *before* any
   inline disable is added — it must prove the selector actually fires on
   `useRef<AbortController>`. (See "Contract test.")
2. **Documented fallback selector.** If the child combinator does not resolve,
   switch to the descendant form straight from the call:
   `CallExpression[callee.name='useRef'] TSTypeReference[typeName.name='AbortController']`.
   This is very slightly looser (it would also match a `TSTypeReference` inside a
   type-assertion argument such as `useRef(x as AbortController)`), but no such
   call exists in the tree; try the tighter child form first, fall back only if
   needed.

**Secondary safety net.** `make lint` runs `--max-warnings 0`, and ESLint 9 flat
config defaults `reportUnusedDisableDirectives` to `"warn"`. So a selector that
silently never matches turns the 6 inline disables into 6 *unused-directive*
failures — a broken rule cannot slip through as a green no-op. This is a
backstop, not a substitute for the RED-first proof.

**Known, deliberate gap.** The selector keys on `callee.name='useRef'`. A
hypothetical `React.useRef<AbortController>` (a `MemberExpression` callee) would
slip through. There are **zero** such calls in the tree today (all 75 `useRef<`
sites are the bare form). Per the same "add a selector when it shows up, don't
speculate" discipline the seq-ref and raw-strings rules already document, no
member-expression selector is added now; the gap is recorded in the rule's
comment so a future drift surfaces as a forcing function rather than silent
scope creep.

**Message.** Points the developer at `useAbortableAsyncOperation` /
`useAbortableSequence` and states that a justified survivor uses
`// eslint-disable-next-line no-restricted-syntax -- <reason>` (the `--`
separator is two hyphens; an em-dash silently disables nothing).

**Rule scope (intentional change).** The rule lives in the client block
(`files: ["packages/client/**/*.{ts,tsx}"]`), which **includes** client test
files — the test-scope block at `eslint.config.js:26` only turns off
`no-non-null-assertion`, so `no-restricted-syntax` still applies to tests. This
is *wider* than the deleted tree-walk, which explicitly excluded `__tests__/`
and `*.test.*`, and it is desirable: a test that hand-rolls a real
`useRef<AbortController>` should also be caught. Verified safe today — the only
`useRef<AbortController>` occurrences in test code are string literals and
comments (all being deleted), and the AST selector matches `CallExpression`
nodes, not strings. Consequence for the contract test: the disabled fixture must
place its `eslint-disable-next-line` on a genuinely matching line, or
`reportUnusedDisableDirectives: "warn"` + `--max-warnings 0` turns it into a
`lintText` failure.

### Inline disables

Each of the 6 surviving allocations gets a
`// eslint-disable-next-line no-restricted-syntax -- <reason>` on the line
directly above it. All 6 are single-line `const … = useRef<AbortController | null>(null);`
allocations, so `disable-next-line` placement is unambiguous. The existing prose
justification block above each ref stays; the disable's `-- reason` is a short
tag echoing it:

| File | Ref | Reason tag |
|------|-----|-----------|
| `useChapterCrud.ts` | `createRecoveryAbortRef` | second-tier create-recovery |
| `useChapterMetadata.ts` | `statusRecoveryAbortRef` | second-tier status-recovery |
| `useChapterMetadata.ts` | `titleRecoveryAbortRef` | second-tier title-recovery |
| `useSnapshotState.ts` | `restoreFollowupAbortRef` | simultaneously-live controller |
| `useTrashManager.ts` | `restoreRecoveryAbortRef` | second-tier restore-recovery |
| `HomePage.tsx` | `createRecoveryAbortRef` | second-tier create-recovery |

Three of these sites (`useSnapshotState.ts`, `useTrashManager.ts`,
`HomePage.tsx`) carry a stale forward-reference comment — *"Phase 4b.4 replaces
this file-level allowlist entry with an inline `eslint-disable`…"* — written
before this work was split out to Phase 4b.17. When the disable lands, that
sentence is **reconciled** (replaced by the actual `eslint-disable` line): a
comment predicting a future edit that has now happened would be a lie in the
code, contrary to this phase's hygiene goal. The rest of each ref's
justification prose is preserved.

### Test cleanup

In `migrationStructuralCheck.test.ts`, **delete**:

- `PHASE_4B_3B_ALLOWLIST`
- both companion assertions: the tree-walk grep (`no file … contains raw
  useRef<AbortController>`) and `Phase 4b.3b allowlist entries actually contain
  useRef<AbortController>`
- the `USE_REF_ABORT_CONTROLLER_PATTERN` regex constant
- the `useRef<AbortController> regex catches all realistic drift forms (S1)`
  spec

**Keep** untouched (all unrelated to the AbortController allocation ban):

- the `*SeqRef` naming check
- the `useAbortableSequence` import check
- the `.run()`-binding checks and their helper tests
  (`extractAbortableAsyncOperationBindings`, `importPatternFor`,
  `stripCommentsFromTsSource`, the delegation-helper test)

Decision (brainstorm): **full replace, no naming-grep backstop.** Unlike the
seq-ref rule — whose ESLint selector could not express the cross-statement
bump-counter pattern, so a `*SeqRef` naming grep was retained — the AST selector
here is strictly *more* precise than the deleted regex for the typed-allocation
pattern. Adding a `*AbortRef` naming grep would be a new speculative check with
real false-positive surface, working against the phase's goal of reducing
structural-test maintenance. YAGNI.

### Contract test

A new `packages/client/src/__tests__/eslintAbortControllerRule.test.ts` using
the existing `eslintRuleHarness` (`.ts` fixture — no JSX needed). Mirrors
`eslintSequenceRule.test.ts`.

**Written RED first.** This test is the proof that the selector matches TS type
nodes at all (see the feasibility note under "The rule"). It is authored and run
*before* any inline disable is added: the "fires on `useRef<AbortController>`"
assertion must fail with no rule, then pass once the selector lands. Only after
the rule is confirmed firing are the 6 disables added — otherwise each disable
is an unused directive and fails `--max-warnings 0`.

- **Fires** on: `useRef<AbortController>(null)`, `useRef<AbortController | null>(null)`,
  `useRef<Record<string, AbortController>>(...)`, and a multi-line generic form.
- **Does not fire** on: `useRef<AbortControllerWrapper>(null)`,
  `useRef<MyAbortController>(null)`, `useRef<string>(null)`, and a line carrying
  the inline `// eslint-disable-next-line no-restricted-syntax -- …` comment.

### CLAUDE.md

Update §Save-Pipeline Invariants Rule 4's final sentence. Replace the current
"Hand-rolled `useRef<AbortController>` allocations at consumer call sites are
banned, enforced by `migrationStructuralCheck.test.ts` — which also owns the
short allowlist of justified second-tier-recovery survivors (consult the test;
don't duplicate its census here)." with wording that the ban is enforced by the
ESLint `no-restricted-syntax` rule, and each justified survivor carries an inline
`eslint-disable` comment that *is* its audit record (no central allowlist to
consult).

## Out of Scope

- Migrating any of the 6 survivors to `useAbortableAsyncOperation` — those are
  documented second-tier-recovery / simultaneously-live-controller patterns;
  each migration is a separate per-site decision.
- A `React.useRef<AbortController>` member-expression selector (no live call
  form; documented gap only).
- A `*AbortRef` naming-convention backstop grep (rejected above).

## Definition of Done

- ESLint rule fires on any new `useRef<AbortController>` allocation (contract
  test proves it).
- The 6 surviving sites pass lint with inline disables.
- `migrationStructuralCheck.test.ts` no longer references
  `PHASE_4B_3B_ALLOWLIST` or `USE_REF_ABORT_CONTROLLER_PATTERN`; the broader
  migration checks remain.
- CLAUDE.md §Save-Pipeline Invariants Rule 4 updated.
- `make all` green at PR close (lint, format, typecheck, coverage, e2e).
- No behavior change visible to the user.

## Dependencies

- Phase 4b.4 — the extracted `packages/client/src/__tests__/eslintRuleHarness.ts`
  this phase reuses for the contract test. The `no-restricted-syntax` precedent
  itself dates from Phase 4b.2's sequence-ref rule.

## PR Scope

Single refactor, one PR (CLAUDE.md §Pull Request Scope). No feature bundling; no
second unrelated change. The rule + 6 inline disables + test cleanup + contract
test + CLAUDE.md edit are one coherent unit.
