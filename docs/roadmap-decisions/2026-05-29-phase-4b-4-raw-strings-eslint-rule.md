---
date: 2026-05-29
phase: "Phase 4b.4: Raw-Strings ESLint Rule"
model: claude-opus-4-8
design_file: docs/plans/2026-05-28-raw-strings-eslint-rule-design.md
plan_file: docs/plans/2026-05-28-raw-strings-eslint-rule-plan.md
pushback:
  total: 5
  critical: 3
  important: 1
  minor: 1
alignment:
  total: 1
  critical: 0
  important: 0
  minor: 1
---

# Phase 4b.4: Raw-Strings ESLint Rule — Decision Log

The design doc was written before this /roadmap run, so brainstorming was
skipped and the run began at pushback. Pushback was unusually productive:
every concrete claim in the design was checked against the codebase by
running the *actual proposed selectors* through the ESLint API rather than
trusting the design's prose, and three of the five findings are
Critical — the design's survey, its rule breadth, and its core fix
mechanism were each materially wrong.

## Pushback Findings

### [1] "Seven violation sites" was a ~3.5× undercount
- **Severity:** Critical
- **Category:** Omission
- **Summary:** The design claimed 7 existing violations (4 `✕` glyphs + 3 test fixtures) found by grepping for the literal `✕` character. Running the design's own six selectors through the ESLint API found ~18 production hits across 11 files and ~5 test hits across 4 files — the grep missed every non-`✕` glyph (`&times;`, `⠿`, `&#x2699;`, `&middot;`, `/`, `* * *`), the `Aa`/`ab|`/`.*` toggle labels, punctuation glue between interpolations, two template-literal attributes, and a 4th test fixture (`ChapterTitle.test.tsx:44`). §S3, the implementation order, and the DoD ("exactly 7 hits", "passes lint cleanly") were all factually wrong.
- **Resolution:** fixed-in-design — re-surveyed by running the selectors via the ESLint API (Q6); §S3 rewritten with the authoritative enumeration and the survey method recorded so it isn't repeated by grep.

### [2] Rule breadth (`\S`) was never considered against the rule's purpose
- **Severity:** Critical
- **Category:** Scope
- **Summary:** The design used a broad `\S` selector that flags any non-whitespace JSX text. But §String externalization exists "to prepare for i18n," and glyphs, separators, and punctuation are language-neutral — not i18n surface. A letters-only (`/\p{L}/u`) selector targets the real purpose, and a survey showed production has *zero* raw word-bearing strings, so the codebase is already clean for externalization. The broad rule's only bonus (catching a bare glyph with no accessible name) is already owned by aXe-core in Playwright. The broad rule would have demanded ~18 inline-disables documenting nothing translatable.
- **Resolution:** fixed-in-design — switched to letters-only (Q7); production fix scope dropped from ~18 to 2, and the punctuation-glue and template-literal-attr sub-issues dissolved entirely. Refines the earlier Q2 boundary.

### [3] The inline-disable fix mechanism does not actually suppress JSXText
- **Severity:** Critical
- **Category:** Feasibility
- **Summary:** §S3 instructed adding `// eslint-disable-next-line` directly above each glyph. Empirically (tested against the installed toolchain) ESLint reports a JSXText violation at the node's *start* — the line of the preceding `>` — so a comment above the visible text lands on the wrong line and suppresses nothing. The multi-attribute FindReplace buttons (prettier keeps their opening tag multiline) cannot use the simple `disable-next-line` form at all. The original `✕` approach would have failed the same way.
- **Resolution:** fixed-in-design — Q8: production glyphs are *named* (`const MATCH_CASE_GLYPH = "Aa"` → `{MATCH_CASE_GLYPH}`), which the rule does not flag, so no disable comment is needed; test fixtures use `eslint-disable-next-line` at placements individually verified to suppress. Refines Q5 (still no `strings.ts` namespace) and is strictly better.

### [4] Disable-comment separator `—` silently disables nothing
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The design's load-bearing reason strings used an em-dash (`// eslint-disable-next-line no-restricted-syntax — reason`). ESLint's directive description separator is two hyphens (`--`); with an em-dash, ESLint parses the entire tail as part of the rule list, the rule name no longer matches, and the directive suppresses nothing (verified: the em-dash form still fires). Following the design verbatim would have left every exemption inert and the rule "passing" for the wrong reason.
- **Resolution:** fixed-in-design — every disable comment switched to `-- <reason>`; the `--`-vs-`—` distinction documented as load-bearing in §S1, §S4, and the eslint.config.js comment block. (Objective correctness fix; no user decision required.)

### [5] Four §S2 negative test cases were false negatives
- **Severity:** Minor
- **Category:** Contradiction
- **Summary:** Several "rule does NOT fire" cases used a stray `x` text child (`<button className="px-2">x</button>`). Under either the broad or letters-only rule, the `x` is a letter and trips the JSX-text selector, so those cases would have *failed* as written — contradicting their stated intent of pinning that the attribute (className/role/etc.) is out of scope.
- **Resolution:** fixed-in-design — replaced the stray text children with `{label}` expression children and added explicit letters-only boundary pins (#19–#22: glyph-only text, separator glyph, punctuation glue, no-static-letter template).

## Alignment Findings

### [1] Contract test pinned only 4 of the 6 user-facing attribute names
- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** The design's §S2 calls for "one representative test per attribute name," but the plan's positive cases exercised only `aria-label`, `alt`, `placeholder`, and `title`. `aria-description` and `aria-roledescription` are in the selector regex but were untested, so a future typo dropping either from the regex would pass CI.
- **Resolution:** fixed-in-plan — added two positive cases (`aria-description`, `aria-roledescription`); counts synced to 11 positive + 13 negative across both design and plan.

## Summary

- Pushback raised 5 issues; all 5 resulted in design changes (fixed-in-design). Three were Critical (incomplete survey, unconsidered rule breadth, an infeasible fix mechanism) and one Important (an em-dash that silently neutralized every exemption) — each would have produced a green-but-wrong implementation. The remaining Minor finding fixed false-negative test cases.
- Alignment raised 1 issue (Minor, missing-coverage); it resulted in a plan change (two added test cases), with the design synced for count consistency.
