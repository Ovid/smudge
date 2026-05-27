---
date: 2026-05-27
phase: "Phase 4b.3d: Mapper Internals & CLAUDE.md Updates"
model: claude-opus-4-7
design_file: docs/plans/2026-05-27-mapper-internals-claude-md-updates-design.md
plan_file: docs/plans/2026-05-27-mapper-internals-claude-md-updates-plan.md
pushback:
  total: 8
  critical: 0
  important: 3
  minor: 5
alignment:
  total: 0
---

# Phase 4b.3d: Mapper Internals & CLAUDE.md Updates — Decision Log

## Pushback Findings

### [1] [S6] feasibility: is the dev-log throw a real hazard or theoretical?
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The original 4b.3 review cited "`import.meta.env?.DEV` access can throw in some test environments" as the justification for wrapping the dev-log in try/catch. Pushback's check found no reproduction in the review and no env-intercepting setup in this repo's Vitest config (`packages/client/vitest.config.ts`) or test setup (`packages/client/src/__tests__/setup.ts`). Under standard Vite+Vitest, `import.meta.env` is a plain object and `.DEV` is a plain property read that cannot throw absent an unusual Proxy / throwing-getter setup, neither of which is present. The proposed test ("mock `import.meta.env` to throw on access") was itself dependent on Vitest infrastructure that does not exist.
- **Resolution:** fixed-in-design — [S6] dropped from the phase entirely. If a real reproduction surfaces later, a follow-up phase can address it.

### [2] [S13] helper location: file-local vs separate module?
- **Severity:** Important
- **Category:** Omission
- **Summary:** The original design specified the `refreshTrashList` helper as "file-local — not exported" inside `useTrashManager.ts`. But the design also required a direct unit test for the four return-kind branches, and a file-local function cannot be imported by a test file. The test would have to invoke the helper indirectly via the hook's public surface, defeating the purpose of a direct test.
- **Resolution:** fixed-in-design — helper extracted to its own file `packages/client/src/hooks/useTrashManager.refresh.ts`, exporting `refreshTrashList` and `RefreshTrashResult`. Both `useTrashManager.ts` callers import from the new file; the direct unit test imports it directly. Type-name accuracy fix also rolled in (`AbortableAsyncOperation` instead of `UseAbortableAsyncOperationReturn`).

### [3] [S14] test approach is underspecified
- **Severity:** Important
- **Category:** Ambiguity
- **Summary:** The original design's [S14] test plan was "assert that after `fetchSnapshots()` is called, a prior in-flight call's `.then` checks `token.isStale() === true`." But `fetchSnapshots` is a `useCallback` inside `SnapshotPanel` — there's no public surface for invoking it directly, and the "prior token is stale" predicate is internal. The test had to be a component-level observable test, not an internal-predicate assertion.
- **Resolution:** fixed-in-design — test reframed as a component-level chapter-switch test that renders `SnapshotPanel` with chapter A, holds chapter A's `api.snapshots.list` request via `pendingUntilAbort`, rerenders with chapter B, resolves chapter A's held promise with a recognisable label, and asserts the panel does not display chapter A's data. Matches the existing test pattern at `SnapshotPanel.test.tsx:~705`.

### [4] DoD vs. Out-of-Scope contradiction on Phase Structure table
- **Severity:** Minor
- **Category:** Contradiction
- **Summary:** The design's "Definition of Done" listed "Roadmap Phase Structure table: 4b.3c.2 → Done, 4b.3c.3 → Done, 4b.3d → In Progress" as a DoD item, but "Out of Scope" said "Phase Structure table updates land via /roadmap's step 5b as standard machinery, not as a design deliverable." Both statements were technically true (the updates happen, but not as a phase deliverable) but read as contradicting.
- **Resolution:** fixed-in-design — DoD line dropped. The table updates were already executed at /roadmap step 5b (commit 80ea1b7) and are out of scope as a design deliverable per the Out-of-Scope section.

### [5] `console.error` raw-err loss in [S13] callers
- **Severity:** Minor
- **Category:** Omission
- **Summary:** The current `openTrash` catch logs `console.error("Failed to load trash:", err)` — passing the raw `err` object gives DevTools native error-object inspection (stack trace, structured fields). The chosen Option A (helper drops raw-err binding; callers log `result.mapped.message` instead) loses this debug ergonomics. The mapped message is more triage-useful than a stack trace, but the trade-off was worth surfacing explicitly.
- **Resolution:** accepted-as-is — Option A confirmed; helper's discriminated-union return stays narrow. Acceptable trade-off: mapped message is the actionable signal for debugging.

### [6] [S22]/[S23] "same exception as [I15]" framing is loose
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The design originally said "[S22]/[S23] admin — recorded as `accepted-as-is` under the same one-feature-rule exception as [I15]." But [I15] is one finding ([I15] sanitizer/CONTRIBUTING/engines); [S22] is a separate finding (vitest worker cap); [S23] is another separate finding (ESLint test infra). They share the bundling-exception machinery but aren't literally "the same exception" — they're three independent findings under one umbrella.
- **Resolution:** fixed-in-design — reworded to "under the same bundling-exception clause that covers [I15]" with explicit enumeration of the three findings the clause covers.

### [7] Does §Pull Request Scope addition self-reference 4b.3d's own exception?
- **Severity:** Minor
- **Category:** Omission
- **Summary:** The design originally listed two exception acknowledgments to add to CLAUDE.md §Pull Request Scope (4b.3 bundling, 4b.3c three-way split). But this phase (4b.3d) is also invoking the bundling exception. The §Pull Request Scope addition could either (a) cite only historical exceptions and let the 4b.3d decision-log entry stand alone, or (b) self-reference 4b.3d's exception in the same paragraph it's establishing. Self-reference is slightly awkward but useful for future contributors searching CLAUDE.md for prior-art examples.
- **Resolution:** fixed-in-design — design changed to three acknowledgments (4b.3, 4b.3c, 4b.3d) instead of two. CLAUDE.md becomes a one-stop list of prior-art bundling exceptions.

### [8] CLAUDE.md target paragraph length vs draft
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The design set a target of "~230 words" for the §Unified API error mapping expansion. The draft text was 233 words. The count was useful as a sizing signal during brainstorming but became a small ambiguity at the spec level — is 233 within tolerance? Is the count a constraint or guidance?
- **Resolution:** fixed-in-design — word-count target dropped from both the §Unified API error mapping section ("Single paragraph") and the Definition of Done ("CLAUDE.md §Unified API error mapping paragraph expanded"). Phrasing settles at plan-execution time using the draft as the starting point.

## Alignment Findings

Alignment raised no issues.

The plan (`docs/plans/2026-05-27-mapper-internals-claude-md-updates-plan.md`) traces every design item to at least one task; every plan task traces back to a design item; no orphan tasks or gold-plating. TDD format is RGR for new behaviour (Tasks 1 and 4); refactor-with-tests-as-net for behaviour-preserving refactors (Tasks 2 and 3); docs and verification tasks (5 and 6) appropriately skip the RGR format per the alignment skill's rules. The plan reflects all 8 pushback resolutions, including the [S6] drop, the [S13] file-extraction, the [S14] component-level test, the §PR Scope self-reference, and the word-count target removal.

## Summary

- **Pushback raised 8 issues.** 7 resulted in design changes (`fixed-in-design`); 1 was `accepted-as-is` (raw-err console inspection trade-off). 0 dismissed as invalid, 0 dismissed as out-of-scope, 0 deferred. The 3 Important findings ([S6] feasibility, [S13] helper location, [S14] test approach) each materially changed the implementation shape — [S6] was dropped entirely; [S13] gained its own file; [S14] gained a different test pattern. The 5 Minor findings tightened wording, removed a contradiction, and added a CLAUDE.md self-reference that benefits future contributors.
- **Alignment raised no issues.** The plan was already coherent with the post-pushback design at every requirement, every task, and every design decision.
- The 4b.3 bundling-exception machinery (per CLAUDE.md §Pull Request Scope) is invoked for this phase: three small refactors + docs in one PR. [S22]/[S23] (vitest worker cap and ESLint test infra) are recorded as `accepted-as-is` under the same bundling-exception clause, with no PR comment and no code change.
