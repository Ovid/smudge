# Phase 4b.4 — Raw-Strings ESLint Rule: Design

**Date:** 2026-05-28
**Phase:** 4b.4 (roadmap.md)
**Branch:** `raw-strings-eslint-rule`
**Companion plan:** `docs/plans/2026-05-28-raw-strings-eslint-rule-plan.md` (forthcoming)

## Goal

Make the "all UI strings live in `packages/client/src/strings.ts`" rule
(CLAUDE.md §String externalization) enforceable by lint instead of by
reviewer vigilance. Add a `no-restricted-syntax` ESLint rule that flags
raw **word-bearing** string literals (text containing a Unicode letter,
`\p{L}`) in JSX text children and in the six user-facing JSX attributes
(`aria-label`, `aria-description`, `aria-roledescription`, `title`,
`placeholder`, `alt`). Fix the existing violation sites so the rule runs
clean on the existing tree: the **2 flagged production glyphs** (`Aa`/`ab|`
in `FindReplacePanel`) are extracted to named constants so the JSX child
becomes `{GLYPH}` (a member/identifier expression the rule does not flag —
no disable comment needed), and the **4 test-fixture sites** get an audited
`// eslint-disable-next-line` exemption.

**Letters-only, by design (Q7).** The rule fires only on text containing
an actual letter. §String externalization exists "to prepare for i18n"
(CLAUDE.md) — and glyphs (`✕`, `⠿`, `* * *`, the gear/`&times;`/`&middot;`
entities), separators (`/`, `·`), and punctuation glue between
interpolations (`{label}: {count}`, a trailing `.`) are **language-neutral**:
they carry nothing to translate. A broad `\S` selector would flag ~18
production sites of exactly these non-i18n shapes, demanding ~18
inline-disables that document nothing useful. The narrow `\p{L}` selector
targets the real i18n surface — and a survey of the tree (2026-05-28) found
**zero raw word-bearing UI strings in production**; the codebase is already
clean for the externalization purpose. The one a11y guarantee a broad rule
would add as a side effect — catching a bare glyph that lacks an accessible
name — is **already enforced by aXe-core in Playwright** (CLAUDE.md §Testing
Philosophy: axe's "button/element has an accessible name" check). Letters-only
therefore gives up nothing material; it stops the lint rule from conflating
i18n externalization with a11y labeling.

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

**Six selectors covering the two AST shapes, each filtered to
letter-bearing content** (`/\p{L}/u`). The Unicode-property regex with the
`u` flag is supported by esquery in the installed ESLint toolchain
(verified 2026-05-28 against `packages/client/**/*.tsx`):

| # | Selector | Catches | Skips (letters-only) |
|---|---|---|---|
| 1 | `JSXText[value=/\p{L}/u]` | `<button>Save</button>` | `<button>✕</button>`, `{a}: {b}` glue |
| 2 | `JSXElement > JSXExpressionContainer > Literal[value=/\p{L}/u]` | `<button>{"Save"}</button>` (bypass) | `<button>{"✕"}</button>` |
| 3 | `JSXElement > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.cooked=/\p{L}/u]` | `` <button>{`Save`}</button> `` (bypass) | `` {`${a}: ${b}`} `` (no static letters) |
| 4 | `JSXAttribute[name.name=/^(aria-label\|aria-description\|aria-roledescription\|title\|placeholder\|alt)$/][value.value=/\p{L}/u]` | `<button aria-label="Save">` | `aria-label="·"` |
| 5 | `JSXAttribute[name.name=/^.../] > JSXExpressionContainer > Literal[value=/\p{L}/u]` | `<button aria-label={"Save"}>` | `aria-label={"✕"}` |
| 6 | `JSXAttribute[name.name=/^.../] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.cooked=/\p{L}/u]` | `` <button aria-label={`Save ${x}`}> `` | `` title={`${a}: ${b}`} `` |

Note selectors 3 and 6 descend to the `TemplateElement` (the static
quasi) and apply the letter filter to its `value.cooked`, so a template
that only interpolates `STRINGS`/dynamic values between punctuation
(`` `${s.label}: ${count}` ``) does not fire while one with a static word
(`` `Save ${x}` ``) does. The exact selector strings are finalized in the
plan and pinned by the §S2 contract test.

**Why six selectors instead of one consolidated `:matches()` form:**
esquery's `:matches`/`:has` combinators are supported but brittle —
separate selectors give each its own targeted error message and let
future selector edits be checked against the fixture test (§S2) one
shape at a time.

**Error message shape** (per-selector text customized for the shape;
shared tail):

> Raw UI string in JSX. UI strings must live in
> `packages/client/src/strings.ts` (CLAUDE.md §String externalization).
> Name decorative glyphs (`const X = "…"` → `{X}`); for a test fixture, add
> `// eslint-disable-next-line no-restricted-syntax -- test fixture (not
> user-facing)`.

**Separator is load-bearing: use `--`, not `—`.** ESLint's disable-directive
description separator is two hyphens (`--`). An em-dash (`—`) is *not*
recognized — ESLint then parses the whole tail as part of the rule list, the
rule name no longer matches, and the directive **silently suppresses
nothing** (verified 2026-05-28: the em-dash form still fires). Every disable
comment in this phase uses `-- <reason>`.

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

Note: every negative case below uses a `{label}` expression child rather
than a stray text child — a bare `x` text child is itself a letter and
would (correctly) trip selector 1, which would make the case a false
"negative." This is a deliberate authoring fix over an earlier draft of
this table.

| # | Code | Why allowed |
|---|---|---|
| 10 | `<button>{STRINGS.foo.save}</button>` | MemberExpression child |
| 11 | `<button>{label}</button>` | Identifier (prop) child |
| 12 | `<button>{"\n  "}{label}</button>` | whitespace-only JSXText fails `/\p{L}/u` |
| 13 | `<button className="px-2">{label}</button>` | `className` not in user-facing attr regex |
| 14 | `<button role="alert">{label}</button>` | `role` not in regex |
| 15 | `<input type="text" />` | `type` not in regex |
| 16 | `<button aria-labelledby="some-id">{label}</button>` | refers to an element ID, not visible text |
| 17 | `if (e.key === "Escape") {}` | not JSX |
| 18 | `<button aria-label={STRINGS.dismiss}>{label}</button>` | MemberExpression in user-facing attr |
| 19 | `<button>✕</button>` | glyph-only JSXText fails `/\p{L}/u` (letters-only) |
| 20 | `<span aria-hidden="true">·</span>` | separator glyph, no letter (letters-only) |
| 21 | `<span>{count}: {label}</span>` | `: ` punctuation glue, no letter (letters-only) |
| 22 | `` <span title={`${a}: ${b}`} /> `` | template with no static letter (letters-only) |

**Mirroring `eslintSequenceRule.test.ts`'s "by design" comment block:**
cases #14, #15, #16 each get a paragraph above the test explaining the
design choice. The #16 comment carries the same kind of "consciously
update this test first if you want to tighten the selector" language
that the seq-ref rule's mirrored-form test carries. Cases #19–#22 are the
**letters-only boundary pins**: they document that glyphs, separators, and
punctuation are intentionally out of scope (language-neutral, not i18n
surface; bare-glyph a11y is covered by aXe-core). Tightening the rule to
`\S` later means consciously deleting these four pins first.

### S3. Existing-violation fixes (2 production + 4 test sites)

The full enumeration below was produced by running the §S1 letters-only
selectors through the programmatic ESLint API against
`packages/client/src/**/*.tsx` on 2026-05-28 (not by grepping for a single
glyph — the method that undercounted in an earlier draft). It is the
authoritative list; the §S2 negative cases pin why everything else is
*not* flagged.

**Disable-comment mechanics (verified 2026-05-28).** ESLint reports a
JSXText violation at the node's *start* position — which is the line of
the preceding `>` (or property `:`), **not** the line the visible text sits
on. Consequently the naïve "`// eslint-disable-next-line` on the line above
the glyph" **does not suppress the violation** (tested: still fires). What
*does* work, confirmed against the installed toolchain:

- `eslint-disable-next-line` placed on the line immediately **above the
  element's opening tag** (or, for an object-property value or a
  `return (` parent, a trailing `//` on the line above the violation's
  reported line) — works when the element/opening-tag fits the violation
  on one reported line.
- Block `{/* eslint-disable no-restricted-syntax */} … {/* eslint-enable */}`
  — works universally but is verbose.
- **Naming the literal** so the JSX child is `{GLYPH}` (a member/identifier
  expression) — the rule simply does not fire; no comment at all.

**Production (Q8 — name the glyphs, 0 disables):** the `Aa` and `ab|`
typography-toggle labels in `FindReplacePanel.tsx` are extracted to
file-local constants and rendered as `{MATCH_CASE_GLYPH}` / `{WHOLE_WORD_GLYPH}`.
`{Identifier}` matches no selector, so no disable comment is needed and the
fragile JSXText-disable mechanism is sidestepped entirely. For consistency
the third sibling `.*` (regex toggle, not flagged because it has no letter)
is named too (`REGEX_GLYPH`). Each button keeps its existing
`STRINGS`-sourced `aria-label` (`{S.matchCase}`, `{S.wholeWord}`,
`{S.regex}`) — the accessible name is unchanged.

```tsx
const MATCH_CASE_GLYPH = "Aa";
const WHOLE_WORD_GLYPH = "ab|";
const REGEX_GLYPH = ".*";
// …
<button aria-label={S.matchCase} /* … */>{MATCH_CASE_GLYPH}</button>
```

This refines Q5 (which assumed an inline-disable): naming achieves Q5's goal
("no new `strings.ts` namespace") *and* avoids the broken disable mechanism,
so it is strictly better. **During the fix, verify each button keeps its
`STRINGS`-sourced `aria-label`** — both already have one (verified
2026-05-28); naming the visible glyph must not drop the accessible name.

**Test fixtures (4 sites, 3 files — `eslint-disable-next-line`):** test
fixtures are not user-facing and are never translated, so they take the
audited inline exemption. Each placement below is verified to actually
suppress:

| File | Approx. line | Disable placement (verified) |
|---|---|---|
| `packages/client/src/__tests__/ChapterTitle.test.tsx` | 44 | trailing `// eslint-disable-next-line …` on the `return (` line above (suppresses **both** the `aria-label` and `Mock editor` violations — both report on line 44) |
| `packages/client/src/__tests__/EditorPageFeatures.test.tsx` | 139 | JSX-sibling `{/* eslint-disable-next-line … */}` above the single-line `<Route … />` (inside the `<Routes>` children) |
| `packages/client/src/__tests__/EditorPageFeatures.test.tsx` | 2099 | same shape, second occurrence |
| `packages/client/src/__tests__/ReferencePanel.test.tsx` | 12 | plain `// eslint-disable-next-line …` on the line above the `children:` object property |

`ChapterTitle.test.tsx:44` was missed by the original design survey; one
disable covers both its violations.

**Comment shape is load-bearing.** The exemption-reason string
`test fixture (not user-facing)` is the searchable mark of an audited
exemption. `git grep "eslint-disable-next-line no-restricted-syntax"
packages/client/` surfaces the exempt set for audit: after the fixes,
exactly **4 hits** (all test fixtures; production uses named glyphs, no
disables). There are currently **no** other `no-restricted-syntax` disables
in the tree (the seq-ref rule fires clean today), so 4 is the whole set.

(The second reason string from earlier drafts —
`decorative glyph; aria-label provides accessible name` — is no longer used
in the tree under Q8, since production glyphs are named rather than
disabled. It remains documented in CLAUDE.md §S4 as the recommended pattern
*if* a future glyph genuinely cannot be named, alongside the naming-first
guidance.)

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
> selectors in `eslint.config.js` (Phase 4b.4) that flag **word-bearing**
> literals (text containing a Unicode letter, `\p{L}`) in JSX text
> children and the user-facing attributes `aria-label`,
> `aria-description`, `aria-roledescription`, `title`, `placeholder`,
> `alt`. The rule is intentionally letters-only: glyphs, separators, and
> punctuation are language-neutral (not i18n surface), and bare-glyph
> accessible-name coverage is owned by aXe-core, not this rule. A
> decorative word-bearing glyph (e.g. the `Aa`/`ab|` find-replace toggles)
> is **named** — extracted to a constant and rendered as `{GLYPH}`, which
> the rule does not flag — keeping the visible symbol paired with its
> `STRINGS`-sourced `aria-label`. Test fixtures take an inline
> `// eslint-disable-next-line no-restricted-syntax -- test fixture (not
> user-facing)` (the description separator is two hyphens `--`; an em-dash
> silently disables nothing). Note: ESLint reports a JSXText violation at the opening
> tag's line, so a disable comment must sit above the *opening tag* (or use
> the block `eslint-disable`/`eslint-enable` form) — a comment directly
> above the visible text does not suppress it. The exemption-reason string
> is load-bearing — `git grep "eslint-disable-next-line
> no-restricted-syntax" packages/client/` is the audit surface. Prepares
> for future i18n without architectural changes.

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

2. **Red.** Add `eslintRawStringsRule.test.ts` with the 11 positive +
   13 negative cases from §S2 (one positive per attribute name, incl.
   `aria-description`/`aria-roledescription`; negatives #19–#22 pin the
   letters-only boundary). All positive cases fail (rule not yet added); all negative
   cases pass (no rule firing).

3. **Green.** Add the six letters-only `no-restricted-syntax` selectors
   (§S1, each filtered to `/\p{L}/u`) to `eslint.config.js`. Each
   selector's error message is targeted to the shape it catches. All test
   cases pass.

4. **Refactor — existing-violation fixes (§S3, Q8).** Production: extract
   the `Aa`/`ab|`/`.*` find-replace glyphs to file-local constants in
   `FindReplacePanel.tsx`, rendered as `{MATCH_CASE_GLYPH}` etc. (0 disable
   comments); verify each button keeps its `STRINGS`-sourced `aria-label`.
   Tests: add the 4 `// eslint-disable-next-line` exemptions at the verified
   placements. Run `make lint-check` — must exit 0.

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
| `make lint` fails on new raw UI string | `eslintRawStringsRule.test.ts` positive cases + a manual reproduction (add a raw word-bearing string to a real component, run `make lint-check`) |
| Current client code passes lint cleanly | `make lint-check` exits 0 after the production glyph-naming + 4 test-fixture disables |
| No behavior change visible to the user | `make test` + `make e2e` both green; the `FindReplacePanel` glyphs render identically (`{MATCH_CASE_GLYPH}` evaluates to the same `"Aa"`/`"ab\|"`/`".*"` text) |

Additional verification (beyond roadmap DoD):

- All 24 cases in `eslintRawStringsRule.test.ts` pass (11 positive — one
  per attribute name — and 13 negative). The negative cases — especially
  #19–#22 — are the durable contract for the rule's letters-only boundary.
- `eslintSequenceRule.test.ts` continues to pass after harness extraction.
- `git grep "eslint-disable-next-line no-restricted-syntax"
  packages/client/` returns exactly 4 hits (all test fixtures; production
  uses named glyphs, no disables). The PR description pins this count so
  future drift is obvious.
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

### Pushback resolutions (2026-05-29)

| # | Decision | Rationale |
|---|---|---|
| Q6 | Re-survey: enumerate violations by running the actual selectors via the ESLint API, not by grepping for `✕` | The original `✕`-grep survey undercounted production sites ~3.5× (found 4 of ~18) and missed a 4th test fixture (`ChapterTitle.test.tsx:44`). The design is the contract; it must match the tree before the plan is written. |
| Q7 | Letters-only selector (`/\p{L}/u`) instead of broad `\S` | §String externalization exists for i18n; glyphs/separators/punctuation are language-neutral and carry nothing to translate. Letters-only targets the real i18n surface (prod has zero raw word-bearing strings), cuts prod fixes from ~18 to 2, and the bare-glyph-a11y catch a broad rule would add is already owned by aXe-core. Supersedes/refines Q2's broad boundary. |
| Q7-followup | Fixed 4 broken negative test cases in §S2 (stray `x` text child) | A bare `x` child is a letter and would trip selector 1, making those "negative" cases false negatives. Replaced with `{label}` expression children; added letters-only boundary pins #19–#22. |
| Q8 | Production glyphs **named** (local consts → `{GLYPH}`), not inline-disabled; test fixtures use `eslint-disable-next-line` | Empirical test (2026-05-28) showed ESLint reports JSXText at the opening-tag line, so the design's "comment above the glyph" does **not** suppress it, and the multi-attribute FindReplace buttons can't use the simple `disable-next-line` form. Naming the glyph sidesteps the rule entirely (no comment), is cleaner, and refines Q5 (still no `strings.ts` namespace). Test fixtures keep the verified-working inline disable. Audit-grep count: 4 (test only), not 6. |
