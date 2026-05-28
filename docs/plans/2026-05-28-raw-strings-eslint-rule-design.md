# Phase 4b.4 — Raw-Strings ESLint Rule: Design

**Date:** 2026-05-28
**Phase:** 4b.4 (roadmap.md)
**Branch:** `raw-strings-eslint-rule`
**Companion plan:** `docs/plans/2026-05-28-raw-strings-eslint-rule-plan.md` (forthcoming)

## Goal

Make the "all UI strings live in `packages/client/src/strings.ts`" rule
(CLAUDE.md §String externalization) enforceable by lint instead of by
reviewer vigilance. Add a `no-restricted-syntax` ESLint rule that flags
raw string literals in JSX text children and in the six user-facing JSX
attributes (`aria-label`, `aria-description`, `aria-roledescription`,
`title`, `placeholder`, `alt`). Fix the seven existing violation sites
(4 decorative `✕` glyphs + 3 test fixtures) so the rule runs clean on
the existing tree.

## Why Now

The externalization rule has been repeatedly violated despite being a
documented CLAUDE.md requirement. Until lint enforces it, every PR risks
reintroducing raw strings, and every reviewer spends time catching them by
hand. The save-pipeline branch (16 rounds of review, merged 2026-04-19)
showed how load-bearing invariants drift when only review enforces them;
this phase is the lint correlate of that lesson for §String externalization.

## Scope

### S1. The ESLint rule

A new entry in the existing `no-restricted-syntax` array in
`eslint.config.js`, scoped to the same `packages/client/**/*.{ts,tsx}`
block that holds the Phase 4b.2 sequence-ref selector. **Severity:
`"error"`**, matching the seq-ref rule (equivalent to `"warn"` under
`--max-warnings 0`, but `"error"` is semantically honest).

**Six selectors covering the two AST shapes:**

| # | Selector | Catches |
|---|---|---|
| 1 | `JSXText[value=/\S/]` | `<button>Save</button>` |
| 2 | `JSXElement > JSXExpressionContainer > Literal[value=/\S/]` | `<button>{"Save"}</button>` (bypass) |
| 3 | `JSXElement > JSXExpressionContainer > TemplateLiteral` | `` <button>{`Save`}</button> `` (bypass) |
| 4 | `JSXAttribute[name.name=/^(aria-label\|aria-description\|aria-roledescription\|title\|placeholder\|alt)$/][value.type='Literal']` | `<button aria-label="Save">` |
| 5 | `JSXAttribute[name.name=/^.../] > JSXExpressionContainer > Literal` | `<button aria-label={"Save"}>` |
| 6 | `JSXAttribute[name.name=/^.../] > JSXExpressionContainer > TemplateLiteral` | `` <button aria-label={`Save ${x}`}> `` |

**Why six selectors instead of one consolidated `:matches()` form:**
esquery's `:matches`/`:has` combinators are supported but brittle —
separate selectors give each its own targeted error message and let
future selector edits be checked against the fixture test (§S2) one
shape at a time.

**Error message shape** (per-selector text customized for the shape;
shared tail):

> Raw UI string in JSX. UI strings must live in
> `packages/client/src/strings.ts` (CLAUDE.md §String externalization).
> For decorative glyphs paired with an aria-label, add
> `// eslint-disable-next-line no-restricted-syntax — decorative glyph;
> aria-label provides accessible name`.

**Comment block above the selectors** in `eslint.config.js` explains:
the boundary (user-perceivable text only, not Tailwind/role/event keys),
why six selectors instead of one, the inline-disable convention for
decorative glyphs and test fixtures, and a pointer to
`eslintRawStringsRule.test.ts` (the contract test).

**Boundary rationale.** The six attribute names are exactly the set of
HTML/ARIA attributes whose value surfaces to the user via screen readers
(`aria-label`, `aria-description`, `aria-roledescription`), tooltips
(`title`), input ghost text (`placeholder`), or non-text alternatives
(`alt`). Excluded by design: `className`, `role`, `id`, `key`, `type`,
`data-testid`, event-handler attributes, `aria-labelledby` /
`aria-describedby` (refer to element IDs, not visible strings),
`aria-valuetext` and `aria-keyshortcuts` (currently unused in Smudge;
add if/when adopted).

### S2. Contract test (`eslintRawStringsRule.test.ts`)

Mirror `packages/client/src/__tests__/eslintSequenceRule.test.ts`
exactly — programmatic ESLint API (`new ESLint({cwd, overrideConfigFile})`)
against inline code snippets. No separate fixture file.

**Shared harness refactor (lands in this phase).** The existing
`eslintSequenceRule.test.ts` carries a ~25-line block (`getLinter()`,
`lint()`, `beforeAll` warmup) that's worth extracting to a shared helper
before adding the second consumer — otherwise the next selector rule
duplicates it again. Extract to
`packages/client/src/__tests__/eslintRuleHarness.ts` exporting
`{ createLinter, lintCode, FIXTURE_PATH }`. Migrate
`eslintSequenceRule.test.ts` to use the harness in the same PR. The
migration is mechanical and does not touch the rule under test.

**Positive cases (rule fires, one message each):**

| # | Code | Selector |
|---|---|---|
| 1 | `<button>Save</button>` | 1 |
| 2 | `<button>{"Save"}</button>` | 2 |
| 3 | `` <button>{`Save`}</button> `` | 3 |
| 4 | `<button aria-label="Save">x</button>` | 4 |
| 5 | `<button aria-label={"Save"}>x</button>` | 5 |
| 6 | `` <button aria-label={`Save ${x}`}>x</button> `` | 6 |
| 7 | `<img alt="Logo" />` | 4 (`alt`) |
| 8 | `<input placeholder="Search" />` | 4 (`placeholder`) |
| 9 | `<span title="Tooltip">x</span>` | 4 (`title`) |

One representative test per attribute name confirms the regex fires for
each (`aria-description` and `aria-roledescription` covered by parallel
cases, abbreviated above).

**Negative cases (rule does NOT fire, pinning design intent):**

| # | Code | Why allowed |
|---|---|---|
| 10 | `<button>{STRINGS.foo.save}</button>` | MemberExpression child |
| 11 | `<button>{label}</button>` | Identifier (prop) child |
| 12 | `<button>{"\n  "}{label}</button>` | `[value=/\S/]` filter on whitespace-only JSXText |
| 13 | `<button className="px-2">x</button>` | `className` not in user-facing attr regex |
| 14 | `<button role="alert">x</button>` | `role` not in regex |
| 15 | `<input type="text" />` | `type` not in regex |
| 16 | `<button aria-labelledby="some-id">x</button>` | refers to an element ID, not visible text |
| 17 | `if (e.key === "Escape") {}` | not JSX |
| 18 | `<button aria-label={STRINGS.dismiss}>x</button>` | MemberExpression in user-facing attr |

**Mirroring `eslintSequenceRule.test.ts`'s "by design" comment block:**
cases #14, #15, #16 each get a paragraph above the test explaining the
design choice. The #16 comment carries the same kind of "consciously
update this test first if you want to tighten the selector" language
that the seq-ref rule's mirrored-form test carries.

### S3. Production fixes (7 sites)

**Decorative `✕` glyph (4 sites in production code):**

| File | Approx. line |
|---|---|
| `packages/client/src/components/ActionErrorBanner.tsx` | 20 |
| `packages/client/src/components/ProjectSettingsDialog.tsx` | 326 |
| `packages/client/src/components/Sidebar.tsx` | 301 |
| `packages/client/src/pages/EditorPage.tsx` | 1878 |

Each gets the canonical comment immediately above:

```tsx
{/* eslint-disable-next-line no-restricted-syntax — decorative glyph; aria-label provides accessible name */}
✕
```

**During the fix, verify each `✕` site has a sibling accessible name
sourced from `STRINGS`** on the enclosing button or element. If any
site is missing one, the inline-disable is wrong — the right fix is to
add the missing accessible name, not to silence the rule. This converts
a possible WCAG bug into the moment the rule catches it.

**Test fixtures (3 sites in test code):**

| File | Approx. line | Shape |
|---|---|---|
| `packages/client/src/__tests__/EditorPageFeatures.test.tsx` | 139 | `<Route path="/" element={<div>Home</div>} />` |
| `packages/client/src/__tests__/EditorPageFeatures.test.tsx` | 2099 | Same shape, second occurrence |
| `packages/client/src/__tests__/ReferencePanel.test.tsx` | 12 | `<div data-testid="panel-content">Gallery content</div>` |

Each gets:

```tsx
{/* eslint-disable-next-line no-restricted-syntax — test fixture (not user-facing) */}
<div>Home</div>
```

**Comment shape is load-bearing.** The two reason strings —
`decorative glyph; aria-label provides accessible name` and
`test fixture (not user-facing)` — become the searchable mark of an
audited exemption. Future authors copy them verbatim rather than
inventing variants. `git grep "eslint-disable-next-line
no-restricted-syntax"` then surfaces the entire exempt set for audit
(after the fixes, exactly 7 hits in `packages/client/src/` plus the
2 existing seq-ref disables elsewhere in the tree).

### S4. CLAUDE.md edits

**Edit 1: §String externalization** — single sentence becomes the rule
specification.

Current text:

> All UI strings in `packages/client/src/strings.ts` as constants, never
> raw literals in components. Prepares for future i18n without
> architectural changes.

Replacement:

> All UI strings in `packages/client/src/strings.ts` as constants, never
> raw literals in components. Enforced by `no-restricted-syntax`
> selectors in `eslint.config.js` (Phase 4b.4) covering JSX text
> children and the user-facing attributes `aria-label`,
> `aria-description`, `aria-roledescription`, `title`, `placeholder`,
> `alt`. Decorative glyphs paired with an accessible name use inline
> `// eslint-disable-next-line no-restricted-syntax — decorative glyph;
> aria-label provides accessible name`; test fixtures use
> `— test fixture (not user-facing)`. Both exemption-reason strings are
> load-bearing — `git grep "eslint-disable-next-line
> no-restricted-syntax"` is the audit surface. Prepares for future i18n
> without architectural changes.

**Edit 2: §Save-Pipeline Invariants Rule 4** — currently contains the
stale Phase 4b.4 reference to the AbortController inline-disable
conversion (the work that Q1 split out into Phase 4b.17). Approximate
patch:

> …Phase 4b.4's ESLint rule replaces this file-level allowlist with
> inline `// eslint-disable-next-line` on each of the surviving lines.

becomes:

> …Phase 4b.17's allowlist conversion replaces this file-level
> allowlist with inline `// eslint-disable-next-line` on each of the
> surviving lines.

**No other CLAUDE.md sections need updating** for this phase:
§API Design (no endpoints), §Data Model (no schema), §Testing
Philosophy (the harness pattern is an extension of existing precedent,
not a new layer), §Pull Request Scope (no new hazard surfaced),
§Target Project Structure (no new directories).

### S5. Roadmap admin — new Phase 4b.17 entry

Q1's decision to split the AbortController inline-disable conversion
out of 4b.4 requires this phase to create a placeholder row + section
for the spun-out work. Since 4b.16 is currently the last 4b.X row, the
new phase number is **4b.17**.

**Edit 1 — Phase Structure table.** Insert a new row immediately after
the existing 4b.16 row:

> | 4b.17 | AbortController ESLint Rule | Add ESLint rule banning
> hand-rolled `useRef<AbortController>` allocations; convert
> `migrationStructuralCheck.test.ts`'s `PHASE_4B_3B_ALLOWLIST` +
> companion assertion to inline `// eslint-disable-next-line`
> annotations on each of the 4 surviving allocation sites. Split from
> Phase 4b.4 on 2026-05-28 per §Pull Request Scope one-feature rule. |
> Planned |

**Edit 2 — Phase section.** Insert after Phase 4b.16 and before Phase
4c. No `<!-- plan: -->` comment — it gets one when a future `/roadmap`
run brainstorms 4b.17.

```markdown
## Phase 4b.17: AbortController ESLint Rule

### Goal

Replace the file-level `PHASE_4B_3B_ALLOWLIST` in
`packages/client/src/__tests__/migrationStructuralCheck.test.ts` with an
ESLint rule banning hand-rolled `useRef<AbortController>` allocations.
Surviving justified allocations carry inline
`// eslint-disable-next-line` annotations with their existing
justification comment, collocating the audit trail with the code it
justifies.

### Why Now

The file-level allowlist requires lockstep updates across the
allowlist `Set` and each file's own comments whenever a site is
migrated or added. An ESLint rule with inline disables makes the
disable comment itself the documented exception.

### Scope

- Add a `no-restricted-syntax` selector banning
  `useRef<AbortController>` allocations using an AST shape that covers
  the realistic drift forms already pinned by
  `USE_REF_ABORT_CONTROLLER_PATTERN`'s regex test cases.
- Migrate the 4 surviving sites (`useProjectEditor.ts`,
  `useSnapshotState.ts`, `useTrashManager.ts`, `HomePage.tsx`) to use
  inline `// eslint-disable-next-line` + their existing justification
  comment.
- Delete `PHASE_4B_3B_ALLOWLIST` and the companion "allowlist actually
  contains" assertion from `migrationStructuralCheck.test.ts`. The
  broader migration checks (binding extraction, import patterns)
  remain.
- Update CLAUDE.md §Save-Pipeline Invariants Rule 4 to reflect the new
  enforcement mechanism.

### Out of Scope

- Migrating any of the 4 surviving allocations to
  `useAbortableAsyncOperation` — those are documented second-tier
  recovery patterns; migration is a separate per-site decision.

### Definition of Done

- ESLint rule fires on any new `useRef<AbortController>` allocation.
- The 4 surviving sites pass lint with inline disables.
- `migrationStructuralCheck.test.ts` no longer references
  `PHASE_4B_3B_ALLOWLIST`.
- CLAUDE.md §Save-Pipeline Invariants Rule 4 updated.

### Dependencies

- Phase 4b.4 (extracted
  `packages/client/src/__tests__/eslintRuleHarness.ts` that this phase
  reuses for its programmatic-ESLint contract test). The
  `no-restricted-syntax` precedent itself dates from Phase 4b.2's
  sequence-ref rule.
```

## Implementation Order (TDD)

Matches Approach A from brainstorm (and CLAUDE.md §Testing Philosophy
"ALL CODE MUST USE RED-GREEN-REFACTOR if feasible").

1. **Refactor — extract harness.** Create
   `packages/client/src/__tests__/eslintRuleHarness.ts` with
   `{ createLinter, lintCode, FIXTURE_PATH }`. Migrate
   `eslintSequenceRule.test.ts` to use it. Verify
   `npm test -w packages/client` is green. *No production change yet.*

2. **Red.** Add `eslintRawStringsRule.test.ts` with the 9 positive +
   9 negative cases from §S2. All positive cases fail (rule not yet
   added); all negative cases pass (no rule firing).

3. **Green.** Add the six `no-restricted-syntax` selectors to
   `eslint.config.js`. Each selector's error message is targeted to
   the shape it catches. All test cases pass.

4. **Refactor — production fixes.** Add the 7 inline-disable
   annotations (§S3): 4 production `✕` sites + 3 test fixtures.
   During the production-side fixes, verify each `✕` has a sibling
   accessible name from `STRINGS`. Run `make lint-check` — must exit 0.

5. **CLAUDE.md edits (§S4).** Both edits land together in a single
   commit.

6. **Roadmap admin (§S5).** Insert the new Phase 4b.17 row + section
   in `docs/roadmap.md` in a separate commit.

7. **Final verification.** `make all` is green:
   `lint-check` + `typecheck` + coverage thresholds + `make e2e`.

## Definition of Done

Roadmap DoD (carried forward verbatim):

- `make lint` fails on a new raw UI string.
- Current client code passes lint cleanly.
- No behavior change visible to the user.

Verification commands per criterion:

| Criterion | Verified by |
|---|---|
| `make lint` fails on new raw UI string | `eslintRawStringsRule.test.ts` positive cases + a manual reproduction (add a raw string to a real component, run `make lint-check`) |
| Current client code passes lint cleanly | `make lint-check` exits 0 after the 7 inline-disable fixes |
| No behavior change visible to the user | `make test` + `make e2e` both green; visual diff at the 4 `✕` sites is only a comment added (text content unchanged) |

Additional verification (beyond roadmap DoD):

- All 18 cases in `eslintRawStringsRule.test.ts` pass (9 positive, 9
  negative). The negative cases are the durable contract for the
  rule's boundary.
- `eslintSequenceRule.test.ts` continues to pass after harness extraction.
- `git grep "eslint-disable-next-line no-restricted-syntax"
  packages/client/src/` returns exactly 7 hits. The PR description
  pins this count so future drift is obvious.
- Coverage thresholds (95/85/90/95) hold. The new test file adds lines
  without changing production code paths, so coverage should rise
  slightly, not fall.

## Out of Scope

Carried forward from the roadmap:

- Server-side strings (covered by the API error mapper, Phase 4b.3).
- `strings.ts` restructuring or namespacing.
- i18n extraction (Phase 7f).

Added during brainstorm:

- **Custom-component prop scanning.** `<MyComponent message="Save" />`
  does NOT trip the rule — the selector matches only the six known DOM
  attribute names. Catching strings passed to custom components would
  require per-component prop allowlisting (heavy bookkeeping) or
  banning all string-typed props (false-positive nightmare). Deferred
  indefinitely.
- **Glyph extraction to an icon system.** Replacing `✕` with
  `<CloseIcon />` SVG components or moving glyphs to a
  `STRINGS.glyphs.*` namespace is a separate UI-polish concern (likely
  Phase 7a or later). This phase uses inline-disable per Q5.
- **The AbortController inline-disable conversion itself.** Split into
  Phase 4b.17 per Q1; this phase only creates the placeholder
  row + section.
- **String concatenation patterns in JSX (`<button>{"a " + b}</button>`).**
  Rare in modern React. The selector set does NOT cover
  `BinaryExpression` inside `JSXExpressionContainer`. If it shows up
  later, add a sibling selector then; do not speculate now.
- **Type-level string literals (`type Status = "draft" | "final"`).**
  Already non-JSX; matches no selector. No exemption needed.
- **Strings inside non-component `.ts` files (hooks, utils, types).**
  Out of band — those files have no JSX and the selectors are
  AST-shape-based.
- **Migrating existing `STRINGS.*` consumers to a different shape
  (e.g. `useStrings()` hook).** The §String externalization rule
  already accepts `STRINGS.foo.bar` and `STRINGS.foo.bar(arg)`; both
  stay as-is.

## Dependencies

- **Phase 4b (merged 2026-04-19).** The save-pipeline branch is where
  the §String externalization invariant lived without lint enforcement
  for the most rounds of review; this phase is the lint correlate of
  that lesson.
- **Phase 4b.2 (merged earlier).** Established the
  `no-restricted-syntax` precedent in `eslint.config.js` and the
  programmatic-ESLint test pattern in `eslintSequenceRule.test.ts`.
  Both directly extended here.
- **Independent of 4b.1, 4b.3, 4b.5–4b.16.** May land last among the
  4b.X cleanups.

## Decisions Log (brainstorm Q&A)

Captured during the 2026-05-28 brainstorm; consulted during pushback
and alignment.

| # | Decision | Rationale |
|---|---|---|
| Q1 | Raw-strings rule only; AbortController inline-disable conversion split into new Phase 4b.17 | CLAUDE.md §Pull Request Scope one-feature rule. The two ESLint rules address independent invariants. |
| Q2 | Rule boundary: JSX text children + `aria-label`, `aria-description`, `aria-roledescription`, `title`, `placeholder`, `alt` | The "what the user perceives" boundary. Excludes `className`, `role`, event keys (technical strings). |
| Q3 | Mechanism: custom `no-restricted-syntax` selectors in existing `eslint.config.js` | Matches Phase 4b.2 precedent. Zero new dependencies. |
| Q4 | Apply rule to test files too; use inline-disable for the 3 fixture cases | Simpler config (no rule-merge dance). Test-fixture surface is tiny. Catches future fixture-rot. |
| Q5 | `✕` glyph: inline-disable at each of the 4 sites with canonical comment shape | No new `strings.ts` namespace required. Comment shape `— decorative glyph; aria-label provides accessible name` becomes load-bearing. |
| Approach | TDD (Approach A): harness extract → red → green → production fix → CLAUDE.md → roadmap | Matches CLAUDE.md §Testing Philosophy and the seq-ref rule precedent. The fixture test becomes the durable contract. |
| §5 numbering | Spun-out phase = 4b.17 (sequential 4b.X slot) | Existing 4b.X cleanups follow sequential numbering; 4b.4a would imply a different relationship. |
