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
- **Summary:** The design's `numberInRange` codec specified "`Number(raw)`; finite → clamp; NaN → reject." But `Number("")` and `Number("   ")` both evaluate to `0`, which is finite — so an empty or whitespace-only stored width would take the _clamp_ branch and silently become the minimum (180px / 240px) rather than falling back to the sensible default (260px / 320px). This was an undocumented third behavior delta, and unlike the two the design did list, it was a regression in quality: it converts garbage into a plausible-looking legitimate value. An empty string is exactly what a partially-failed write or a storage-clearing extension leaves behind, so it is not an exotic input. Shipping it would have reproduced the precise bug class of 4c.0 review item [I1] — a loose parse producing a wrong-but-plausible value — inside the very phase written to generalize the fix for it.
- **Resolution:** `fixed-in-design` — added an explicit `raw.trim() === "" → undefined` guard before coercion, keeping "is this a number at all?" separate from "is this number in range?", with a pinning test case in the plan (Task 1 and Task 2).

### [2] The design froze "the public API" but only named half of it

- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The design promised both hooks would keep their "exact public API — same returned member names, same signatures," and that no consumer component would be touched. But the returned members are not the whole surface: both hooks also export module-level bounds constants that components import directly. `Sidebar.tsx` takes `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` for its drag clamp, its keyboard clamps, and — most importantly — the `aria-valuemin` / `aria-valuemax` it announces on the resize separator; `ReferencePanel.tsx` does the same with its `PANEL_*` pair. Under the refactor those bounds become arguments to a codec factory, and the tempting tidy-up is to inline them there and drop the exports, silently breaking the components' clamps and their ARIA bounds. TypeScript catches the deletion, which is why this is Minor rather than Important — but an a11y-relevant export deserves to be named in the contract rather than rediscovered by `tsc`.
- **Resolution:** `fixed-in-design` — the design's §Call Sites now names the exported constants as frozen surface, cites the exact `Sidebar.tsx` / `ReferencePanel.tsx` line numbers that consume them, and flags the ARIA coupling; the plan repeats the warning as a code comment in Tasks 4 and 5.

### [3] `usePersistedState` would split-brain if `key` ever changed at runtime

- **Severity:** Minor
- **Category:** Omission
- **Summary:** The hook reads storage exactly once, in the lazy `useState` initializer, but its setter's `useCallback` deps include `key`. A `key` that changed between renders would leave the two halves disagreeing: state still holding the value read from the _old_ key while writes land on the _new_ one, with no re-read and no reset. The failure is silent and would present as "the setting didn't load" while quietly persisting correctly. Unreachable today (all four keys are module-level string literals), but the hook is being introduced as the sanctioned way to add future settings, and a per-project key (`smudge:panel-width:${projectId}` — a plausible Phase 8a want) walks straight into it.
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

### [3] The plan was red-green-_commit_, not red-green-**refactor**

- **Severity:** Minor
- **Category:** tdd-format
- **Summary:** Every task ran write-failing-test → watch-it-fail → minimal-implementation → watch-it-pass → commit. That is RED and GREEN faithfully, but no task carried a REFACTOR step, and CLAUDE.md §Testing Philosophy states "ALL CODE MUST USE RED-GREEN-REFACTOR if feasible." Refactor is precisely the step that gets skipped once the tests are green, which is why it belongs in the written plan rather than being left to discipline. The step is only meaningful for the three tasks that create code, though: Tasks 4–5 _are_ the refactor (the whole phase is one), and Tasks 6–7 are documentation and verification with no code to refactor.
- **Resolution:** `fixed-in-plan` — added an explicit REFACTOR step to Tasks 1–3 naming concrete things to look for (the shared codec-literal shape; the double `serialize` call in the setter and why it should be left alone; whether `read()` earns its extraction), and a Ground Rules note recording that Tasks 4–7 omit the step by decision rather than oversight. The plan states that "looked, found nothing worth changing" is a legitimate outcome — the look is the point, not a mandatory edit.

## Implementation Findings

Four decisions were taken during execution that the design did not anticipate.
Most were surfaced by the per-task code-quality review and are recorded here
because they change what the design says.

### [I1] A rejected write keeps the last known-good value, not the fallback

- **Severity:** Important
- **Category:** design-deviation (user-approved)
- **Summary:** The design and plan both specified the setter as
  `codec.parse(codec.serialize(next)) ?? codec.fallback`. That `?? fallback` arm
  was the one branch no test covered, and it is destructive: a write the codec
  cannot represent (a `NaN` width out of a resize handler reading a torn-down
  rect) would not be ignored — it would **reset the setting to the factory
  default and persist that**, wiping the user's real 400px width. A fallback is
  the floor for absent-or-corrupt _storage_, not a reset button for a bad _live
  write_.
- **Resolution:** `fixed-in-code` — changed to `?? valueRef.current`, so an
  unrepresentable write is ignored and state and storage keep the last
  known-good value. `valueRef.current` is itself a fixed point of the round
  trip, so the fixed-point invariant still holds. This is not a read/write
  asymmetry: the rule is "keep the last known-good value," and at read time the
  fallback _is_ the last known-good value, because there is nothing else to
  keep. Same rule, both directions. The uncovered branch is now pinned by test.
  The user was asked and approved the deviation from the approved design.

### [I2] "Public API unchanged" held for the member list, not the signatures

- **Severity:** Minor
- **Category:** design-gap
- **Summary:** The design froze both hooks' public APIs, and pushback finding
  [2] widened that to include the exported bounds constants. Both held. But the
  _setter signatures_ silently widened: `handleSidebarResize` went from
  `(newWidth: number) => void` to `usePersistedState`'s React-setter shape
  `(next: number | ((prev: number) => number)) => void`, and the same for
  `setPanelOpen` / `setActiveTab`. Every call site still compiles (a wider
  parameter type is assignable to a narrower one, and `tsc` is clean), and the
  full 1573-test client suite passes with no consumer edited — but the frozen
  surface was the member _list_, not the member _types_.
- **Resolution:** `accepted` — the widening is what makes `togglePanel` a
  one-liner over the functional setter, and narrowing it at the hook boundary
  would cost a cast or an explicit annotation to buy nothing. Recorded rather
  than fixed.

### [I3] The helper belongs in `hooks/`, not `utils/` — the design's premise was false

- **Severity:** Important
- **Category:** design-deviation
- **Summary:** The design placed the helper at
  `packages/client/src/utils/persistedSetting.ts`, justifying it as "joining
  `abortable.ts` and `editorSafeOps.ts` in the established `utils/` home for
  cross-cutting helpers." That premise does not survive checking: neither of
  those files exports a React hook (`abortable.ts` exports `sleep`;
  `editorSafeOps.ts` exports `safeSetEditable` / `quiesceEditorForServerOp`).
  All 28 of the client's hooks live in `hooks/`, including the two CLAUDE.md
  names as canonical patterns (`useAbortableSequence`, `useDialogLifecycle`),
  and §Target Project Structure lists `hooks/` as their home. `usePersistedState`
  would have been the only hook in the repo outside it. The cost was not
  aesthetic: the phase's own Task 7 audit command
  (`git grep -n "localStorage" packages/client/src/hooks/`) was **structurally
  blind to the helper it audits**, and would have passed just as happily if a
  future author hand-rolled `localStorage` into `utils/`. The CLAUDE.md entry
  would then have enshrined the wrong path as the reference for every future
  setting.
- **Resolution:** `fixed-in-code` — moved to
  `packages/client/src/hooks/usePersistedState.ts` (renamed to match the `use*`
  convention every neighbour follows), with the colocated test alongside it, per
  the `useAbortableSequence.test.ts` / `useDialogLifecycle.test.tsx` precedent.
  CLAUDE.md and the roadmap's Scope section point at the real path. Caught by the
  final whole-phase review; the per-task reviews could not see it, because each
  was scoped to a diff that took the file's location as given.

### [I4] `numberInRange` clamps its own fallback

- **Severity:** Minor
- **Category:** design-gap
- **Summary:** The design and plan both had `numberInRange` return its
  `fallback` as given (plan Task 1 ships a plain `fallback,`). The shipped code
  clamps it: `fallback: clamp(fallback, min, max)`. This adds a property to the
  codec contract that neither document states — **`fallback` must be a fixed
  point of `parse ∘ serialize`** — and it is load-bearing, because the hook's
  whole promise is that state is always a value a reload would parse back. An
  out-of-range fallback breaks that directly: `read()` would hand back 900 while
  every write normalized to 480, so state and reload silently disagree with no
  write in between. Unreachable today (all four fallbacks are already in range),
  which is why it slipped the log — but the hook is the sanctioned way to add
  future settings, and the next author picking a fallback outside their own
  bounds is exactly the caller it protects.
- **Resolution:** `accepted` — kept, and now stated as an explicit codec
  contract in the hook's doc comment ("two properties every codec MUST hold")
  and in CLAUDE.md, with a test that constructs `numberInRange(180, 480, 900)`
  and asserts the fallback is both clamped and a fixed point of its own parse.
  Recorded here late: this was the one implementation-time deviation that
  reached CLAUDE.md and the tests without reaching the log. Surfaced by the
  whole-phase review as `[S4]`.

## Post-Review Decisions

The whole-phase agentic review
(`paad/code-reviews/persisted-setting-storage-helper-2026-07-12-22-13-22-bc71226.md`)
returned no Critical and no Important findings. Two of its seven suggestions
changed code and are recorded here because they amend what the design, the plan,
_and_ CLAUDE.md say.

### [I5] The codec is pinned at mount; the module-scope contract is deleted, not policed

- **Severity:** Minor
- **Category:** design-deviation (user-approved)
- **Summary:** The shipped hook told callers that codecs **must** be constructed
  at module scope, and nothing enforced it. The failure was silent and cascading:
  an inline codec is a fresh object each render → `codec` in the setter's
  `useCallback` deps churns the setter identity → `togglePanel` churns →
  EditorPage's `useCallback`s churn → re-created props into memoized editor
  children. Performance only, never correctness. But this repo enforces exactly
  this class of hook contract mechanically — the `no-restricted-syntax`
  AbortController ban with its rule-fires test, the `strings.ts` externalization
  rule — and an unenforced "must" in the steering file is how CLAUDE.md goes
  stale.
- **Resolution:** `fixed-in-code` — the codec now lives in a ref, pinned at
  mount, and is out of the setter's deps, so an inline codec cannot destabilize
  anything and there is no contract left to remember. Deleting the rule beat
  authoring an ESLint rule plus its proving test for one hook with two consumers.
  Pinning also makes the hook internally consistent: the **read** path already
  parsed with the mount-time codec and never re-reads, so honouring a _live_
  codec on the write path only bought the same split-brain the constant-`key`
  contract warns about (state parsed by the old codec, writes normalized by the
  new one). The residual — a future caller wanting a props-dependent codec gets
  it silently ignored — is a caller the old contract already forbade, and who
  today would have been half-honoured, which is worse. The user was asked and
  chose this over softening the CLAUDE.md wording. Review item `[S5]`.

### [I6] "Ignored" now means ignored in storage too — an amendment to [I1]

- **Severity:** Minor
- **Category:** doc-code-mismatch
- **Summary:** `[I1]` changed the rejected-write arm to `?? valueRef.current`,
  and the hook doc and CLAUDE.md both went on to promise that an unrepresentable
  write is **IGNORED**. It wasn't, quite: the coalesced value was then written to
  storage unconditionally. Against **empty** storage that persisted the in-memory
  fallback — `set(NaN)` on a fresh profile left `localStorage["smudge:sidebar-width"]`
  set to `"260"`, materializing today's default as if the user had chosen it and
  pinning it against any future change to `SIDEBAR_DEFAULT_WIDTH`. Nothing
  observable changes today, and the path is unreachable from the UI (both resize
  components clamp finite numbers before calling), so this was a doc/code
  mismatch on a defensive path rather than a live bug — but the defensive path is
  the whole reason the arm exists.
- **Resolution:** `fixed-in-code` — the setter returns early when `parse` rejects,
  touching neither state nor storage. `[I1]`'s rule is unchanged and now literally
  true in both halves. The existing test pre-seeded `"400"` and therefore could
  not see this; a second test starts from empty storage and asserts `setItem` is
  never called. Review item `[S3]`.

### Accepted out-of-scope change: CLAUDE.md §"Where the trade-offs go"

The design commit (`f23574d`) also added an eight-line CLAUDE.md subsection about
how `AskUserQuestion` must present trade-offs — a steering-preference change with
no connection to persisted settings, and a deviation from CLAUDE.md §Pull Request
Scope's one-feature rule. It is recorded here rather than reverted: the commit
message disclosed it, it has zero code coupling, and it governs how questions are
asked in _this_ conversation, which is where it was written. Noted so the "every
commit on this branch is 4b.18" claim stays auditable. Review item `[S6]`.

## Process Notes

A review finding worth keeping as process rather than decision: the
Task 4 reviewer reverted the migrated `useSidebarState` to its pre-phase
asymmetry (unclamped write, reject-on-read) and found **all 17 of its tests
still passed** — the phase had shipped a fix for a write-path bug with no test
on the write path at that hook. Two cases asserting state _and_ storage were
added, and verified to fail against the planted regression. `useReferencePanelState`
already had the equivalent coverage; the hook that actually had the bug did not.

The same shape recurred in the whole-phase review, twice: `[I6]` and `[I4]` were
both branches the tests _touched_ but did not _pin_ — `[I6]`'s test pre-seeded a
value and so could not see the empty-storage case, and `[I4]`'s clamp had no test
until the review asked for one. The lesson is the Task 4 lesson again: a test that
passes against the planted regression is not coverage.

## Summary

- Pushback raised 3 issues; all 3 resulted in design changes (1 Important, 2 Minor). The Important one — the `Number("") === 0` coercion trap — would have shipped a garbage-to-plausible-value conversion inside the phase whose stated purpose is preventing exactly that, in a codec deliberately designed to be the single validator for both the read and write paths.
- Alignment raised 3 issues (all Minor); 1 resulted in a design change and 2 in plan changes. Requirements coverage was complete in both directions before the review — every design requirement traced to a task and every task traced back to a requirement, with no scope creep and no orphaned tasks. The findings were about the _accuracy_ of the design's own risk accounting, the plan's self-containment for a zero-context executor, and conformance to the repository's mandated TDD format.
- Notable process note: during brainstorming, an early survey claimed the sidebar clamp asymmetry was a _live_ bug (that a user could drag the sidebar past 480px and have it reset to 260 on reload). Tracing the callers disproved this — `Sidebar.tsx:481-484` and `ReferencePanel.tsx:62-66` both clamp at the drag site — and the claim was retracted to the user _before_ the design was written, along with an explicit re-offer of the rejected alternative (Option B, free functions), since the retracted correctness argument had been part of the case for Option A. The user re-confirmed Option A on the remaining grounds (dedup value plus the codebase's established "one hook owns the pattern" convention). The design's §Alternatives Considered records this so the decision's real basis survives.
