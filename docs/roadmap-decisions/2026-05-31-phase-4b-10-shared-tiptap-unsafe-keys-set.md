---
date: 2026-05-31
phase: "Phase 4b.10: Shared TipTap Unsafe-Keys Set"
model: claude-opus-4-8
design_file: docs/plans/2026-05-31-shared-tiptap-unsafe-keys-set-design.md
plan_file: docs/plans/2026-05-31-shared-tiptap-unsafe-keys-set-plan.md
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

# Phase 4b.10: Shared TipTap Unsafe-Keys Set — Decision Log

## Pushback Findings

### [1] RED test was a tautological constant-mirror; the prototype-pollution strip was untested
- **Severity:** Important
- **Category:** Omission
- **Summary:** The design's planned RED test only asserted that `CANONICAL_UNSAFE_KEYS` is exported and contains the three expected keys — a constant-mirror that restates the implementation and must be edited in lockstep with it, never catching a real bug (the kind of trivial test CLAUDE.md's testing philosophy warns against). A codebase check confirmed that the actual stripping behavior this phase exists to consolidate had **zero** coverage in either consumer (`grep` for `__proto__`/`prototype`/`poison` was empty in both `tiptap-text.test.ts` and `content-hash.test.ts`).
- **Resolution:** `fixed-in-design` — replaced the membership-mirror with a behavioral test on `canonicalContentHash` (a doc carrying crafted `__proto__`/`prototype`/`constructor` attrs must hash identically to the clean doc, and a changed *safe* key must still move the hash), keeping only a minimal export-wiring assertion as the TDD RED anchor.

### [2] Barrel export routing for `CANONICAL_UNSAFE_KEYS` left ambiguous
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The design said to export the constant "via schemas' re-export or directly — whichever matches the existing pattern." Routing it through `./schemas` (to mirror how `MAX_TIPTAP_DEPTH` flows out) would force the Zod module to import and re-export a constant it never consumes, partly defeating the reason the safety module is kept zero-dependency.
- **Resolution:** `fixed-in-design` — export `CANONICAL_UNSAFE_KEYS` **directly** from `./tiptap-safety` in `index.ts`; explicitly do not launder it through `./schemas`. Moving the depth pair's export to match was recorded as out of scope.

## Alignment Findings

### [1] Design overclaimed `tiptap-text` strip coverage
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** The design's Testing section stated the new server behavioral test "directly covers the equivalent strip on the canonicalize path." But `content-hash.ts`'s `canonicalize()` and `tiptap-text.ts`'s `canonicalJSON()` are independent code; the server test exercises only the former. `canonicalJSON` is not exported, so existing `tiptap-text` tests merely execute the filter line without ever passing an unsafe key through it. The doc asserted coverage that did not exist.
- **Resolution:** `fixed-in-design` — accepted the asymmetry (both consumers import the same, now-verified shared constant; a second behavioral test would require exporting an internal function or a contrived fixture for an identical filter) and tightened the design wording to state the `tiptap-text` path is covered transitively via the shared constant, not by a dedicated test.

## Summary

- Pushback raised 2 issues; both resulted in design changes (1 Important: swapped a trivial test for a behavioral one closing a real coverage gap; 1 Minor: resolved an export-routing ambiguity). 0 dismissed.
- Alignment raised 1 issue (Minor); it resulted in a design wording change that stopped the doc from overclaiming test coverage. 0 orphaned tasks; every design requirement traced to a task and every task back to a requirement.
- **Independence note:** per the trivial-phase carve-out, this run's pushback and alignment were executed **in-context** (not via an isolated subagent). The subagent-isolation guidance was itself added to the `/roadmap` skill *during* this run (committed separately on branch `roadmap-skill-subagent-isolation`), so it did not govern this run; future non-trivial phases should dispatch both reviews to a fresh-context subagent.
