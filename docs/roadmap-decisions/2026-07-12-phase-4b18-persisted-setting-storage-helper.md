---
date: 2026-07-12
phase: "Phase 4b.18: Persisted-Setting Storage Helper"
model: claude-opus-4-8
design_file: docs/plans/2026-07-12-persisted-setting-storage-helper-design.md
plan_file: docs/plans/2026-07-12-persisted-setting-storage-helper-plan.md
pushback:
  total: 3
  critical: 0
  important: 1
  minor: 2
alignment:
  total: 3
  critical: 0
  important: 0
  minor: 3
---

# Phase 4b.18: Persisted-Setting Storage Helper — Decision Log

## Pushback Findings

### [1] `Number("")` is `0`, not `NaN` — the clamp silently upgrades garbage to a legitimate width

- **Severity:** Important
- **Category:** Omission
- **Summary:** The design's `numberInRange` codec specified "`Number(raw)`; finite → clamp; NaN → reject." But `Number("")` and `Number("   ")` both evaluate to `0`, which is finite — so an empty or whitespace-only stored width would take the *clamp* branch and silently become the minimum (180px / 240px) rather than falling back to the sensible default (260px / 320px). This was an undocumented third behavior delta, and unlike the two the design did list, it was a regression in quality: it converts garbage into a plausible-looking legitimate value. An empty string is exactly what a partially-failed write or a storage-clearing extension leaves behind, so it is not an exotic input. Shipping it would have reproduced the precise bug class of 4c.0 review item [I1] — a loose parse producing a wrong-but-plausible value — inside the very phase written to generalize the fix for it.
- **Resolution:** `fixed-in-design` — added an explicit `raw.trim() === "" → undefined` guard before coercion, keeping "is this a number at all?" separate from "is this number in range?", with a pinning test case in the plan (Task 1 and Task 2).

### [2] The design froze "the public API" but only named half of it

- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The design promised both hooks would keep their "exact public API — same returned member names, same signatures," and that no consumer component would be touched. But the returned members are not the whole surface: both hooks also export module-level bounds constants that components import directly. `Sidebar.tsx` takes `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` for its drag clamp, its keyboard clamps, and — most importantly — the `aria-valuemin` / `aria-valuemax` it announces on the resize separator; `ReferencePanel.tsx` does the same with its `PANEL_*` pair. Under the refactor those bounds become arguments to a codec factory, and the tempting tidy-up is to inline them there and drop the exports, silently breaking the components' clamps and their ARIA bounds. TypeScript catches the deletion, which is why this is Minor rather than Important — but an a11y-relevant export deserves to be named in the contract rather than rediscovered by `tsc`.
- **Resolution:** `fixed-in-design` — the design's §Call Sites now names the exported constants as frozen surface, cites the exact `Sidebar.tsx` / `ReferencePanel.tsx` line numbers that consume them, and flags the ARIA coupling; the plan repeats the warning as a code comment in Tasks 4 and 5.

### [3] `usePersistedState` would split-brain if `key` ever changed at runtime

- **Severity:** Minor
- **Category:** Omission
- **Summary:** The hook reads storage exactly once, in the lazy `useState` initializer, but its setter's `useCallback` deps include `key`. A `key` that changed between renders would leave the two halves disagreeing: state still holding the value read from the *old* key while writes land on the *new* one, with no re-read and no reset. The failure is silent and would present as "the setting didn't load" while quietly persisting correctly. Unreachable today (all four keys are module-level string literals), but the hook is being introduced as the sanctioned way to add future settings, and a per-project key (`smudge:panel-width:${projectId}` — a plausible Phase 8a want) walks straight into it.
- **Resolution:** `fixed-in-design` — documented the constant-key contract in the hook's doc comment and in the CLAUDE.md entry, naming the escape hatch (derive per-entity settings by remounting via a `key` prop, not by varying the argument). Supporting a changing key was explicitly rejected as speculative machinery for a caller that does not exist.

## Alignment Findings

### [1] The design overstated the cost of the option chosen

- **Severity:** Minor
- **Category:** design-gap
- **Summary:** The design's §Risks claimed "two working hooks' test files (~500 lines) get reworked," and cited that test churn as the headline cost of the hook shape (Option A) over free functions (Option B). Writing the plan required reading both suites case by case, which disproved it: the actual churn is three cases rewritten (`"50"` and `"999"` in `useSidebarState.test.ts`; `"50"` in `useReferencePanelState.test.ts`, all three moving from reset-to-default to clamp-to-bound) and two added (an empty-string case in each file). Everything else in those ~500 lines passes verbatim — the exported-constants blocks, the return-shape blocks, the write-clamp tests, the `"garbage"` → `open: false` case, every `setItem`-throws case. Those survivors are not churn; they are the regression net proving the public APIs were preserved. This mattered beyond bookkeeping because test churn was the cost weighed when Option A was chosen over Option B, and it turned out to be roughly a tenth of what was advertised.
- **Resolution:** `fixed-in-design` — §Risks now states the measured churn (three rewritten, two added) and explains that the surviving cases are the regression net, so the record reflects the real cost of the decision rather than the estimated one.

### [2] The design lists two deliverables; the plan covered only one

- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** The design's §"Deliverables Beyond Code" names two items: the `docs/roadmap.md` §Phase 4b.18 body section (the phase previously existed only as a table row) and the CLAUDE.md §Key Architecture Decisions entry. The plan had a task for the second (Task 6) but nothing at all for the first — no task, no Definition-of-Done line, no mention. The reason was benign (the roadmap section was written during this `/roadmap` run and committed in `f23574d`), but the plan never said so, and the plan is the document an executor works from — possibly in a fresh session with no memory of this conversation. They would hit a design deliverable with no corresponding task and either re-do it, producing a duplicate section, or flag it as a planning bug.
- **Resolution:** `fixed-in-plan` — added an "Already Done (do not redo)" preamble naming the commit, plus a pre-ticked Definition-of-Done checkbox, so the plan's deliverable list matches the design's one-for-one and is self-contained for a zero-context executor.

### [3] The plan was red-green-*commit*, not red-green-**refactor**

- **Severity:** Minor
- **Category:** tdd-format
- **Summary:** Every task ran write-failing-test → watch-it-fail → minimal-implementation → watch-it-pass → commit. That is RED and GREEN faithfully, but no task carried a REFACTOR step, and CLAUDE.md §Testing Philosophy states "ALL CODE MUST USE RED-GREEN-REFACTOR if feasible." Refactor is precisely the step that gets skipped once the tests are green, which is why it belongs in the written plan rather than being left to discipline. The step is only meaningful for the three tasks that create code, though: Tasks 4–5 *are* the refactor (the whole phase is one), and Tasks 6–7 are documentation and verification with no code to refactor.
- **Resolution:** `fixed-in-plan` — added an explicit REFACTOR step to Tasks 1–3 naming concrete things to look for (the shared codec-literal shape; the double `serialize` call in the setter and why it should be left alone; whether `read()` earns its extraction), and a Ground Rules note recording that Tasks 4–7 omit the step by decision rather than oversight. The plan states that "looked, found nothing worth changing" is a legitimate outcome — the look is the point, not a mandatory edit.

## Summary

- Pushback raised 3 issues; all 3 resulted in design changes (1 Important, 2 Minor). The Important one — the `Number("") === 0` coercion trap — would have shipped a garbage-to-plausible-value conversion inside the phase whose stated purpose is preventing exactly that, in a codec deliberately designed to be the single validator for both the read and write paths.
- Alignment raised 3 issues (all Minor); 1 resulted in a design change and 2 in plan changes. Requirements coverage was complete in both directions before the review — every design requirement traced to a task and every task traced back to a requirement, with no scope creep and no orphaned tasks. The findings were about the *accuracy* of the design's own risk accounting, the plan's self-containment for a zero-context executor, and conformance to the repository's mandated TDD format.
- Notable process note: during brainstorming, an early survey claimed the sidebar clamp asymmetry was a *live* bug (that a user could drag the sidebar past 480px and have it reset to 260 on reload). Tracing the callers disproved this — `Sidebar.tsx:481-484` and `ReferencePanel.tsx:62-66` both clamp at the drag site — and the claim was retracted to the user *before* the design was written, along with an explicit re-offer of the rejected alternative (Option B, free functions), since the retracted correctness argument had been part of the case for Option A. The user re-confirmed Option A on the remaining grounds (dedup value plus the codebase's established "one hook owns the pattern" convention). The design's §Alternatives Considered records this so the decision's real basis survives.
