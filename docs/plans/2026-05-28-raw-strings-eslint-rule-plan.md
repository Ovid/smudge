# Raw-Strings ESLint Rule (Phase 4b.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce CLAUDE.md §String externalization by lint — add a letters-only `no-restricted-syntax` rule that flags raw word-bearing UI strings in JSX text and the six user-facing attributes, and bring the client tree to a clean baseline.

**Architecture:** Six `no-restricted-syntax` selectors (each filtered to `/\p{L}/u`) added to the existing `packages/client/**/*.{ts,tsx}` block in `eslint.config.js`. A programmatic-ESLint contract test pins the rule's boundary. A shared test harness is extracted first so the new test and the existing seq-ref test share one linter setup. Existing violations are fixed by naming the two flagged production glyphs (so they are no longer raw literals) and adding audited `eslint-disable-next-line` exemptions at four test fixtures.

**Tech Stack:** ESLint 9 flat config, esquery selectors, `@typescript-eslint/parser`, Vitest, the programmatic `ESLint` API.

**Source design:** `docs/plans/2026-05-28-raw-strings-eslint-rule-design.md` (corrected via pushback 2026-05-29: letters-only Q7, named-glyph Q8, `--` separator, verified disable placements).

**Scope guardrails (CLAUDE.md):**
- One-feature PR rule: this phase is one PR. The AbortController ESLint rule is a *separate* phase (4b.17) — this plan only **creates the 4b.17 roadmap placeholder** (Task 7), it does not implement it.
- TDD red/green/refactor; coverage floors 95/85/90/95 must hold; zero warnings in test output.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/client/src/__tests__/eslintRuleHarness.ts` | **Create** | Shared programmatic-ESLint harness: `createLinter()`, `lintCode()`, `FIXTURE_PATH`, `FIXTURE_PATH_TSX`. |
| `packages/client/src/__tests__/eslintSequenceRule.test.ts` | Modify | Migrate to import the harness (mechanical; rule under test unchanged). |
| `packages/client/src/__tests__/eslintRawStringsRule.test.ts` | **Create** | Contract test: 11 positive + 13 negative cases pinning the letters-only boundary. |
| `eslint.config.js` | Modify | Add the six letters-only selectors + comment block to the existing `no-restricted-syntax` array. |
| `packages/client/src/components/FindReplacePanel.tsx` | Modify | Name the `Aa`/`ab\|`/`.*` toggle glyphs as file-local consts. |
| `packages/client/src/__tests__/ChapterTitle.test.tsx` | Modify | Add one `eslint-disable-next-line` exemption. |
| `packages/client/src/__tests__/EditorPageFeatures.test.tsx` | Modify | Add two `eslint-disable-next-line` exemptions. |
| `packages/client/src/__tests__/ReferencePanel.test.tsx` | Modify | Add one `eslint-disable-next-line` exemption. |
| `CLAUDE.md` | Modify | §String externalization rule spec + §Save-Pipeline Rule 4 stale-ref fix. |
| `docs/roadmap.md` | Modify | New Phase 4b.17 row + section (placeholder for the spun-out work). |

---

## Task 1: Extract the shared ESLint test harness (refactor, no behavior change)

**Files:**
- Create: `packages/client/src/__tests__/eslintRuleHarness.ts`
- Modify: `packages/client/src/__tests__/eslintSequenceRule.test.ts`

- [ ] **Step 1: Create the harness**

Create `packages/client/src/__tests__/eslintRuleHarness.ts`:

```ts
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Monorepo root = four levels up (packages/client/src/__tests__/ → repo
// root). The flat-config `packages/client/**/*.{ts,tsx}` pattern is matched
// relative to the ESLint cwd, so cwd must be the repo root for the block to
// apply regardless of whether the test runs from the repo root (`make test`)
// or the workspace (`npm test -w packages/client`).
export const REPO_ROOT = resolve(__dirname, "../../../..");

// Fixtures must live under packages/client/src/ so the client config block
// matches. Use the .tsx path for rules that need JSX parsing.
export const FIXTURE_PATH = resolve(REPO_ROOT, "packages/client/src/fixture.ts");
export const FIXTURE_PATH_TSX = resolve(REPO_ROOT, "packages/client/src/fixture.tsx");

// ESLint's flat-config load + TS parser init is several seconds cold. Share
// one instance across a suite and warm it in beforeAll.
let linter: ESLint | null = null;
export function createLinter(): ESLint {
  linter ??= new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: resolve(REPO_ROOT, "eslint.config.js"),
  });
  return linter;
}

export async function lintCode(
  code: string,
  filePath: string = FIXTURE_PATH,
): Promise<ESLint.LintResult[]> {
  return createLinter().lintText(code, { filePath });
}
```

- [ ] **Step 2: Migrate `eslintSequenceRule.test.ts` to the harness**

Replace the top of the file (the `import`s, the `__dirname`/`REPO_ROOT`/`getLinter`/`lint`/`beforeAll` block, lines 1–37) with:

```ts
import { beforeAll, describe, it, expect } from "vitest";
import { lintCode } from "./eslintRuleHarness";

beforeAll(async () => {
  await lintCode("export {};");
}, 30_000);
```

Then in each `it(...)` body, rename the local call `lint(code)` → `lintCode(code)`. The four test bodies and their assertions are otherwise unchanged.

- [ ] **Step 3: Run the seq-ref test to verify it still passes**

Run: `npm test -w packages/client -- eslintSequenceRule`
Expected: PASS (4 tests). No behavior change — same rule, same assertions, harness-sourced linter.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/__tests__/eslintRuleHarness.ts packages/client/src/__tests__/eslintSequenceRule.test.ts
git commit -m "refactor(test): extract shared ESLint rule harness (Phase 4b.4)"
```

---

## Task 2: Red — add the contract test for the raw-strings rule

**Files:**
- Create: `packages/client/src/__tests__/eslintRawStringsRule.test.ts`

- [ ] **Step 1: Write the contract test**

Create `packages/client/src/__tests__/eslintRawStringsRule.test.ts`:

```ts
import { beforeAll, describe, it, expect } from "vitest";
import { lintCode, FIXTURE_PATH_TSX } from "./eslintRuleHarness";

// Wrap a JSX expression in a valid TSX module with every identifier
// predeclared, so only no-restricted-syntax can fire on the JSX itself.
// Assertions filter by ruleId, so incidental react-hooks / unused-vars
// messages are irrelevant.
function mod(jsx: string): string {
  return `
    const STRINGS: any = {};
    const label = "";
    const x = "";
    const count = 0;
    const a = "";
    const b = "";
    export const C = () => (${jsx});
  `;
}

async function rawStringMessages(code: string) {
  const results = await lintCode(code, FIXTURE_PATH_TSX);
  return results[0]!.messages.filter((m) => m.ruleId === "no-restricted-syntax");
}

beforeAll(async () => {
  await lintCode("export {};", FIXTURE_PATH_TSX);
}, 30_000);

describe("no-restricted-syntax raw-UI-string rule (letters-only)", () => {
  describe("positive cases (rule fires)", () => {
    const positives: Array<[string, string]> = [
      ["JSX text child", `<button>Save</button>`],
      ["string literal in JSX-child container", `<button>{"Save"}</button>`],
      ["template literal child", "<button>{`Save`}</button>"],
      ["aria-label string literal", `<button aria-label="Save">{label}</button>`],
      ["aria-label literal-in-container", `<button aria-label={"Save"}>{label}</button>`],
      ["aria-label template literal", "<button aria-label={`Save ${x}`}>{label}</button>"],
      ["alt attribute", `<img alt="Logo" />`],
      ["placeholder attribute", `<input placeholder="Search" />`],
      ["title attribute", `<span title="Tooltip">{label}</span>`],
      ["aria-description attribute", `<button aria-description="Removes the chapter">{label}</button>`],
      ["aria-roledescription attribute", `<div aria-roledescription="slide carousel">{label}</div>`],
    ];
    for (const [name, jsx] of positives) {
      it(`fires on ${name}`, async () => {
        const msgs = await rawStringMessages(mod(jsx));
        expect(msgs.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("negative cases (rule does not fire)", () => {
    const negatives: Array<[string, string]> = [
      ["STRINGS member child", `<button>{STRINGS.foo.save}</button>`],
      ["identifier child", `<button>{label}</button>`],
      ["whitespace-only literal child", `<button>{"\\n  "}{label}</button>`],
      ["className attribute", `<button className="px-2">{label}</button>`],
      ["role attribute", `<button role="alert">{label}</button>`],
      ["type attribute", `<input type="text" />`],
      ["aria-labelledby attribute", `<button aria-labelledby="some-id">{label}</button>`],
      ["aria-label STRINGS member", `<button aria-label={STRINGS.dismiss}>{label}</button>`],
      ["glyph-only JSX text (letters-only)", `<button>✕</button>`],
      ["separator glyph (letters-only)", `<span aria-hidden="true">·</span>`],
      ["punctuation glue (letters-only)", `<span>{count}: {label}</span>`],
      ["template with no static letter (letters-only)", "<span title={`${a}: ${b}`} />"],
    ];
    for (const [name, jsx] of negatives) {
      it(`does not fire on ${name}`, async () => {
        const msgs = await rawStringMessages(mod(jsx));
        expect(msgs).toHaveLength(0);
      });
    }
    // #22: not JSX at all — a string comparison in a key handler.
    it("does not fire on a non-JSX string comparison", async () => {
      const code = `export function f(e: any) { if (e.key === "Escape") {} }`;
      const msgs = await rawStringMessages(code);
      expect(msgs).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify the RED state**

Run: `npm test -w packages/client -- eslintRawStringsRule`
Expected: the 9 **positive** cases FAIL (`expected 0 to be >= 1` — the rule is not added yet); all 13 **negative** cases PASS (nothing fires because no rule exists). This is the correct red state — negatives pass vacuously, positives fail.

- [ ] **Step 3: Commit the red test**

```bash
git add packages/client/src/__tests__/eslintRawStringsRule.test.ts
git commit -m "test(eslint): add raw-UI-string rule contract test — red (Phase 4b.4)"
```

---

## Task 3: Green — add the six letters-only selectors

**Files:**
- Modify: `eslint.config.js` (the `no-restricted-syntax` array inside the `packages/client/**/*.{ts,tsx}` block, currently ending at the seq-ref object around line 72)

- [ ] **Step 1: Add the selectors**

In `eslint.config.js`, the `no-restricted-syntax` rule is an array whose only element today is the seq-ref selector object. Add the comment block and six new selector objects **after** the existing seq-ref object (still inside the same array). The array becomes:

```js
      "no-restricted-syntax": [
        "error",
        {
          // ...existing sequence-ref selector object (unchanged)...
          selector:
            "BinaryExpression[operator=/^[!=]==$/][left.type='Identifier'][right.type='MemberExpression'][right.property.name='current']",
          message:
            "Sequence-ref staleness check detected. Use useAbortableSequence (packages/client/src/hooks/useAbortableSequence.ts): start() bumps and returns a token, capture() reads current epoch, abort() invalidates outstanding tokens, and unmount auto-aborts.",
        },
        // ── Raw UI-string rule (Phase 4b.4) ────────────────────────────────
        // Flags WORD-BEARING string literals (text containing a Unicode
        // letter, \p{L}) in JSX text children and the six user-facing
        // attributes. Letters-only BY DESIGN: glyphs, separators, and
        // punctuation are language-neutral (not i18n surface), and bare-glyph
        // accessible-name coverage is owned by aXe-core (Playwright), not this
        // rule. Six selectors (one per AST shape) rather than one :matches()
        // form, so each gets a targeted message and the contract test
        // (packages/client/src/__tests__/eslintRawStringsRule.test.ts) can pin
        // them one shape at a time. EXEMPTIONS: name a decorative glyph as a
        // const → {GLYPH} (the rule does not fire on member/identifier
        // expressions); test fixtures use
        // `// eslint-disable-next-line no-restricted-syntax -- test fixture
        // (not user-facing)` — the separator is TWO hyphens `--` (an em-dash
        // silently disables nothing). ESLint reports a JSXText violation at the
        // opening-tag line, so a disable comment must sit above the opening
        // tag, not above the visible text.
        {
          selector: "JSXText[value=/\\p{L}/u]",
          message:
            "Raw UI string in JSX text. UI strings must live in packages/client/src/strings.ts (CLAUDE.md §String externalization). Name a decorative glyph as a const → {GLYPH}; a test fixture uses `// eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing)`.",
        },
        {
          selector: "JSXElement > JSXExpressionContainer > Literal[value=/\\p{L}/u]",
          message:
            "Raw UI string literal in a JSX child. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXElement > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.cooked=/\\p{L}/u]",
          message:
            "Raw UI string in a JSX-child template literal. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|title|placeholder|alt)$/][value.value=/\\p{L}/u]",
          message:
            "Raw UI string in a user-facing JSX attribute. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|title|placeholder|alt)$/] > JSXExpressionContainer > Literal[value=/\\p{L}/u]",
          message:
            "Raw UI string literal in a user-facing JSX attribute. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|title|placeholder|alt)$/] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.cooked=/\\p{L}/u]",
          message:
            "Raw UI string in a user-facing JSX attribute template literal. Use packages/client/src/strings.ts (CLAUDE.md §String externalization).",
        },
      ],
```

(Keep the existing seq-ref comment block above its selector intact — only the six objects + the `Raw UI-string rule` comment block are new.)

- [ ] **Step 2: Run the contract test to verify GREEN**

Run: `npm test -w packages/client -- eslintRawStringsRule`
Expected: all 24 cases PASS (11 positive fire, 13 negative do not).

- [ ] **Step 3: Run the seq-ref test to verify no regression**

Run: `npm test -w packages/client -- eslintSequenceRule`
Expected: PASS (4 tests). The new selectors don't touch the seq-ref behavior.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "feat(eslint): add letters-only raw-UI-string no-restricted-syntax rule — green (Phase 4b.4)"
```

---

## Task 4: Refactor — name the production glyphs

**Files:**
- Modify: `packages/client/src/components/FindReplacePanel.tsx`

The `Aa` (line ~206) and `ab|` (line ~219) toggle labels are raw word-bearing JSX text and now fire the rule (`.*` at ~232 has no letter and does not fire, but is named too for consistency). Each button already has a `STRINGS`-sourced `aria-label`, so the accessible name is unchanged — only the visible glyph becomes a named const.

- [ ] **Step 1: Add the glyph constants**

In `FindReplacePanel.tsx`, immediately after `const S = STRINGS.findReplace;` (line 10), add:

```ts
// Decorative typography-toggle glyphs, named so the no-restricted-syntax
// raw-UI-string rule does not flag them as raw JSX text. The translatable
// accessible name lives in each button's aria-label (STRINGS.findReplace.*).
const MATCH_CASE_GLYPH = "Aa";
const WHOLE_WORD_GLYPH = "ab|";
const REGEX_GLYPH = ".*";
```

- [ ] **Step 2: Replace the raw glyph children**

In the three toggle buttons, replace the raw text child with the named const:

- `Aa` (in the `case_sensitive` button) → `{MATCH_CASE_GLYPH}`
- `ab|` (in the `whole_word` button) → `{WHOLE_WORD_GLYPH}`
- `.*` (in the `regex` button) → `{REGEX_GLYPH}`

Each button's opening tag (including `aria-label={S.matchCase}` / `{S.wholeWord}` / `{S.regex}`) is unchanged.

- [ ] **Step 3: Verify lint is clean on the production file**

Run: `npx eslint packages/client/src/components/FindReplacePanel.tsx`
Expected: exit 0, no `no-restricted-syntax` messages.

- [ ] **Step 4: Verify FindReplacePanel tests still pass**

Run: `npm test -w packages/client -- FindReplacePanel`
Expected: PASS. The rendered text is identical (`{MATCH_CASE_GLYPH}` evaluates to `"Aa"`, etc.). If a test queries by the visible glyph text it still matches.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/FindReplacePanel.tsx
git commit -m "refactor(find-replace): name toggle glyphs to satisfy raw-string rule (Phase 4b.4)"
```

---

## Task 5: Refactor — exempt the four test fixtures

**Files:**
- Modify: `packages/client/src/__tests__/ChapterTitle.test.tsx`
- Modify: `packages/client/src/__tests__/EditorPageFeatures.test.tsx`
- Modify: `packages/client/src/__tests__/ReferencePanel.test.tsx`

Each placement below was verified (2026-05-28) to actually suppress the violation. The separator is `--` (two hyphens). Test fixtures are not user-facing and are never translated, so they take the inline exemption rather than externalization.

- [ ] **Step 1: ChapterTitle.test.tsx (~line 43)**

The mock returns a single `<div>` with `aria-label="Chapter content"` and `Mock editor` text — two violations, both reported on the opening-tag line. A trailing comment on the `return (` line above suppresses both. Change:

```tsx
    return (
      <div role="textbox" aria-multiline="true" aria-label="Chapter content">
```

to:

```tsx
    return ( // eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing)
      <div role="textbox" aria-multiline="true" aria-label="Chapter content">
```

- [ ] **Step 2: EditorPageFeatures.test.tsx (~line 139 and ~line 2099)**

Both occurrences are `<Route path="/" element={<div>Home</div>} />` inside `<Routes>`. Insert a JSX-sibling comment on the line directly above each `<Route path="/" ...>`:

```tsx
        <Route path="/projects/:slug" element={<EditorPage />} />
        {/* eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing) */}
        <Route path="/" element={<div>Home</div>} />
```

Apply the same insertion at both the ~139 and ~2099 sites.

- [ ] **Step 3: ReferencePanel.test.tsx (~line 12)**

The fixture is an object-property value (`children: <div ...>Gallery content</div>`), so use a plain `//` line comment above the property:

```tsx
    onResize: vi.fn(),
    // eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing)
    children: <div data-testid="panel-content">Gallery content</div>,
```

- [ ] **Step 4: Run lint-check on the whole client package**

Run: `make lint-check`
Expected: exit 0. (If any disable did not suppress — e.g. prettier relocated a trailing comment — the rule still fires here. Fallback: wrap that element's children in `{/* eslint-disable no-restricted-syntax -- test fixture (not user-facing) */} … {/* eslint-enable no-restricted-syntax */}`, then update the audit-grep expectation in Task 8 accordingly.)

- [ ] **Step 5: Run the three affected test files**

Run: `npm test -w packages/client -- ChapterTitle EditorPageFeatures ReferencePanel`
Expected: PASS. Comments only — no behavior change.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/__tests__/ChapterTitle.test.tsx packages/client/src/__tests__/EditorPageFeatures.test.tsx packages/client/src/__tests__/ReferencePanel.test.tsx
git commit -m "test(fixtures): exempt non-user-facing fixtures from raw-string rule (Phase 4b.4)"
```

---

## Task 6: CLAUDE.md edits

**Files:**
- Modify: `CLAUDE.md` (§String externalization; §Save-Pipeline Invariants Rule 4)

- [ ] **Step 1: Replace §String externalization**

Find:

```markdown
**String externalization.** All UI strings in `packages/client/src/strings.ts` as constants, never raw literals in components. Prepares for future i18n without architectural changes.
```

Replace with:

```markdown
**String externalization.** All UI strings in `packages/client/src/strings.ts` as constants, never raw literals in components. Enforced by `no-restricted-syntax` selectors in `eslint.config.js` (Phase 4b.4) that flag **word-bearing** literals (text containing a Unicode letter, `\p{L}`) in JSX text children and the user-facing attributes `aria-label`, `aria-description`, `aria-roledescription`, `title`, `placeholder`, `alt`. The rule is intentionally letters-only: glyphs, separators, and punctuation are language-neutral (not i18n surface), and bare-glyph accessible-name coverage is owned by aXe-core, not this rule. A decorative word-bearing glyph (e.g. the `Aa`/`ab|` find-replace toggles) is **named** — extracted to a constant and rendered as `{GLYPH}`, which the rule does not flag — keeping the visible symbol paired with its `STRINGS`-sourced `aria-label`. Test fixtures take an inline `// eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing)` (the description separator is two hyphens `--`; an em-dash silently disables nothing). ESLint reports a JSXText violation at the opening tag's line, so a disable comment must sit above the *opening tag* (or use the block `eslint-disable`/`eslint-enable` form) — a comment directly above the visible text does not suppress it. The exemption-reason string is load-bearing — `git grep "eslint-disable-next-line no-restricted-syntax" packages/client/` is the audit surface. Prepares for future i18n without architectural changes.
```

- [ ] **Step 2: Fix the stale Phase 4b.4 reference in §Save-Pipeline Invariants Rule 4**

In the §Key Architecture Decisions → Save-Pipeline Invariants Rule 4 paragraph, find:

```
Phase 4b.4's ESLint rule replaces this file-level allowlist with inline `// eslint-disable-next-line` on each of the surviving lines
```

Replace with:

```
Phase 4b.17's allowlist conversion replaces this file-level allowlist with inline `// eslint-disable-next-line` on each of the surviving lines
```

- [ ] **Step 3: Verify no other CLAUDE.md drift**

Confirm by inspection: §API Design (no endpoints), §Data Model (no schema), §Testing Philosophy (the harness is an extension of the seq-ref test precedent), §Target Project Structure (no new directories), §Pull Request Scope (no new hazard) need no edits.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): document raw-string rule + fix stale 4b.4→4b.17 ref (Phase 4b.4)"
```

---

## Task 7: Roadmap admin — create the Phase 4b.17 placeholder

**Files:**
- Modify: `docs/roadmap.md` (Phase Structure table; new phase section after Phase 4b.16, before Phase 4c)

This phase **creates the placeholder only** — it does not implement 4b.17. No `<!-- plan: -->` comment (a future `/roadmap` run brainstorms it).

- [ ] **Step 1: Add the Phase Structure table row**

Insert immediately after the existing `| 4b.16 | Dialog Lifecycle Hook | … | Planned |` row:

```markdown
| 4b.17   | AbortController ESLint Rule               | Add ESLint rule banning hand-rolled `useRef<AbortController>` allocations; convert `migrationStructuralCheck.test.ts`'s `PHASE_4B_3B_ALLOWLIST` + companion assertion to inline `// eslint-disable-next-line` annotations on each of the 4 surviving allocation sites. Split from Phase 4b.4 on 2026-05-28 per §Pull Request Scope one-feature rule.                                                                                                                                                                                                                                                                                          | Planned |
```

- [ ] **Step 2: Add the Phase section**

Insert after the Phase 4b.16 section and before `## Phase 4c`:

```markdown
---

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

- [ ] **Step 3: Verify the roadmap still parses cleanly**

Run: `grep -n "Phase 4b.17" docs/roadmap.md`
Expected: two hits (table row + section heading).

- [ ] **Step 4: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs(roadmap): add Phase 4b.17 placeholder (split from 4b.4)"
```

---

## Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Format, then full lint**

Run: `make format && make lint-check`
Expected: both exit 0. (Run `make format` first so any prettier reflow of the new disable comments is settled before the read-only `lint-check`.)

- [ ] **Step 2: Pin the audit-grep count**

Run: `git grep -c "eslint-disable-next-line no-restricted-syntax" packages/client/ | awk -F: '{s+=$2} END {print s}'`
Expected: `4` (ChapterTitle ×1, EditorPageFeatures ×2, ReferencePanel ×1; production uses named glyphs, no disables). If you took the Task 5 block-form fallback for any site, expect a correspondingly different count and note it in the PR description.

- [ ] **Step 3: Manual reproduction — the rule actually fails CI on a new raw string**

Temporarily add `<button>HELLO RAW STRING</button>` to any client component, then run `make lint-check`. Expected: FAIL with the raw-UI-string message. Revert the edit.

- [ ] **Step 4: Full CI pass**

Run: `make all`
Expected: lint + format + typecheck + coverage (95/85/90/95 hold — the new test files add covered lines without changing production paths) + e2e all green.

- [ ] **Step 5: Confirm scope discipline**

Verify the diff touches only the files in the File Structure table, and that no `useRef<AbortController>` / `PHASE_4B_3B_ALLOWLIST` change leaked in (that is Phase 4b.17, not this PR).

---

## Self-Review

**Spec coverage:**
- §S1 (six letters-only selectors) → Task 3.
- §S2 (contract test, 11 positive + 13 negative) → Task 2.
- §S2 (harness extraction + seq-ref migration) → Task 1.
- §S3 (production glyph naming + 4 test-fixture disables, verified placements) → Tasks 4, 5.
- §S4 (two CLAUDE.md edits) → Task 6.
- §S5 (Phase 4b.17 placeholder) → Task 7.
- DoD (lint fails on new raw string; clean baseline; no behavior change; audit count = 4; coverage holds) → Task 8.

**Placeholder scan:** none — every code/command step shows literal content.

**Type/name consistency:** `lintCode` / `createLinter` / `FIXTURE_PATH` / `FIXTURE_PATH_TSX` used consistently across Tasks 1–3; `MATCH_CASE_GLYPH` / `WHOLE_WORD_GLYPH` / `REGEX_GLYPH` consistent within Task 4; the `-- test fixture (not user-facing)` reason string identical across Task 5 sites and Task 6 docs.
