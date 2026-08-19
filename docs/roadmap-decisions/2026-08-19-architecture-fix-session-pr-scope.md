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
5. **The Safety Net commit is an allowed untagged commit.** The
   `/paad:fix-architecture` skill requires pinning the current behaviour with
   tests *before* any fix commit lands, and that commit belongs to no single
   finding. It carries no `[F-NN]` tag and needs no `Status:` block. There is
   at most one per session, at the head of the branch.
6. **Code-review follow-ups are traced by commit tag, not by a `Status:`
   block.** A fix-session branch will itself be reviewed (`/paad:agentic-review`),
   and the resulting fixes are neither architecture findings nor feature work.
   They follow rule 2's *shape* — one finding per commit, tagged `[I n]` or
   `[S n]` after the code-review report that raised them — but rule 3 does not
   apply to them: `paad/code-reviews/` reports carry no `Status:` convention,
   and adding one would double the doc surface for an artifact that is read
   once, next to the branch, and superseded by the following review. For
   follow-ups, `git log --oneline main..HEAD` is the traceability surface.
   A follow-up that changes a *shipped finding's* deliverable must still update
   that finding's `Status:` block — see rule 3 and the F-07 precedent, whose
   guard was rewritten twice by review follow-ups after its first Status entry
   was recorded.

## Why this rather than splitting

Splitting per finding would produce three PRs whose only shared context is the
report that motivated them, and each would be re-reviewed without that context.
The one-feature rule exists to stop the failure the
`ovid/snapshots-find-and-replace` branch demonstrated: 17,000 insertions of two
tangled features across 16 review rounds. A fix session has the opposite shape
— several small, mutually independent, individually revertable changes, each
already traceable to a numbered finding. The per-commit finding ID gives
reviewers the isolation the rule is actually after.

## Amendments

Rules 5 and 6 were added on 2026-08-19 (code review of this branch, finding
S2): only 6 of that branch's 12 commits fitted rule 2 as first written, and
since `CLAUDE.md` §Pull Request Scope now points a future session at this file
*instead of* the one-feature rule, a session reading it literally would have
found its own mandatory Safety Net commit unauthorised.

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
