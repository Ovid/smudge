# Decision: architecture-report fix sessions are one PR, one finding per commit

**Date:** 2026-08-19
**Raised by:** `/paad:agentic-review` of `ovid/architecture` @ `6e1ee51c`, finding S4
**Scope:** `CLAUDE.md` §Pull Request Scope — the one-feature rule

## The gap

`CLAUDE.md` §Pull Request Scope states two rules: a PR delivers a single
feature *or* a single refactor, and each roadmap phase is a PR. Exceptions
"require an explicit decision recorded in the phase's decision log; the rule
defaults to enforcement."

A `/paad:fix-architecture` session fits neither rule. It is not a feature and
not one refactor — it closes N independent findings from a
`paad/architecture-reviews/` report, each touching a different part of the
tree. It also has **no roadmap phase**, so there is no "phase's decision log"
in which to record the exception. The escape hatch as written is unreachable
for this class of work.

The branch under review (`ovid/architecture` @ `6e1ee51c`) shipped three
unrelated fixes — F-07, F-16, F-18. Prior `ovid/architecture` merges bundle
the same way. Repeated practice had silently overridden a steering-file rule,
which is the condition this project treats as a defect rather than a norm.

## Decision

Architecture-report fix sessions are a **recorded, standing exception** to the
one-feature rule, bounded as follows:

1. **One report, one branch.** A fix session's branch closes findings from a
   single `paad/architecture-reviews/` report. It carries no feature work and
   no fix unrelated to that report.
2. **One finding per commit.** Each finding gets its own
   `fix(architecture): [F-NN] …` commit plus its own
   `docs(report): [F-NN] record the fix commit SHA` commit. The finding ID is
   the traceability unit that the one-feature rule normally gets from the
   phase boundary.
3. **Every finding carries a `Status:` block** in the report, recording what
   was done, what was deliberately *not* done, and the fix commit SHA.
4. **A finding whose fix is itself a feature is out of scope** for a fix
   session — it goes to the roadmap and gets its own phase and PR.

## Why this rather than splitting

Splitting per finding would produce three PRs whose only shared context is the
report that motivated them, and each would be re-reviewed without that context.
The one-feature rule exists to stop the failure the
`ovid/snapshots-find-and-replace` branch demonstrated: 17,000 insertions of two
tangled features across 16 review rounds. A fix session has the opposite shape
— several small, mutually independent, individually revertable changes, each
already traceable to a numbered finding. The per-commit finding ID gives
reviewers the isolation the rule is actually after.

## Honest argument against

This is a carve-out written from inside the practice it legitimises, which is
exactly the pressure the "defaults to enforcement" wording was meant to
resist. If a fix session ever grows large enough that a reviewer cannot hold
the whole branch, the bound in (1) is not doing its job and the session should
be split by finding after all — line count is not a limit here, but reviewer
capacity is.

## Follow-through

`CLAUDE.md` §Pull Request Scope now points at this file so a future review
finds the precedent instead of re-deriving the violation.
