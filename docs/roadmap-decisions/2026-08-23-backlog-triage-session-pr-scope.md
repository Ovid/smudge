# Decision: backlog-triage sessions are one PR, one entry per commit

**Date:** 2026-08-23
**Raised by:** `/paad:agentic-review` of `ovid/backlog` @ `55edd3e1`, finding I11
**Scope:** `CLAUDE.md` §Pull Request Scope — the one-feature rule
**Sibling:** `2026-08-19-architecture-fix-session-pr-scope.md`, which does the
same job for `/paad:fix-architecture` sessions and whose rules this document
adopts by reference rather than restating.

## The gap

`CLAUDE.md` §Pull Request Scope states two rules — a PR delivers a single
feature _or_ a single refactor, and each roadmap phase is a PR — and says
exceptions "require an explicit decision recorded in the phase's decision log;
the rule defaults to enforcement."

A **backlog-triage session** fits neither rule, and the one standing exception
does not reach it. That exception is written for architecture-report sessions:
its rule 1 reads "A fix session's branch closes findings from a single
`paad/architecture-reviews/` report", and its round-4 amendment permits a
backlog fix only "in a file the session already has open … A backlog fix
elsewhere in the tree is still out of scope", a bound the document restates
twice.

`ovid/backlog` @ `55edd3e1` closed **eleven** `paad/code-reviews/backlog.md`
entries with no architecture report, no roadmap phase, and no decision-log
entry, spanning `packages/client`, `packages/server`, `Makefile`, `README.md`,
`CLAUDE.md`, `.github/copilot-instructions.md` and a spec under
`docs/superpowers/`. There is no shared open-file set the rule-1 carve-out
could have covered — the entries are unrelated by construction, because that is
what a backlog is.

So the escape hatch as written was **unreachable for this class of work** —
precisely the gap the 2026-08-19 document was created to close for architecture
sessions, recurring one class over. A backlog-triage branch is a recurring
shape in this repository; left unrecorded, the next one re-derives the same
violation and the review that finds it cannot tell sanctioned practice from
drift.

**The honest counterargument, recorded because it is strong.** Every commit on
that branch closes exactly one entry, is individually revertable, and is
traceable by id — which is the isolation the one-feature rule is actually
after. The rules doc itself concedes that its rules "describe a tidier practice
than the one being run". This decision is therefore closer to writing down what
the branch already did well than to licensing something risky.

## Decision

Backlog-triage sessions are a **recorded, standing exception** to the
one-feature rule, bounded as follows.

1. **One triage pass, one branch.** The branch closes entries from
   `paad/code-reviews/backlog.md` and carries no feature work and no roadmap
   phase. Unlike the architecture-session rule, there is **no shared-file
   bound**: backlog entries are unrelated by construction, and requiring them to
   share an open file would make the exception unreachable again. The bound is
   the *source* — an entry must already exist in `backlog.md` before the branch
   starts. An issue discovered during the session is filed as a new entry and
   fixed on its own terms, not folded in silently.

2. **One entry per commit**, tagged `[backlog <id>]` in the subject, as all
   eleven commits on `ovid/backlog` already were. The entry id is the
   traceability unit the one-feature rule normally gets from the phase
   boundary. A commit closing two entries names both.

3. **Mark the entry closed in place; never delete it.** See §The rule-1
   contradiction below — this is the point on which this document
   *supersedes* its sibling rather than adopting it.

4. **Rules 3 through 6 of the architecture-session document apply unchanged**,
   with `paad/architecture-reviews/` report findings read as `backlog.md`
   entries: no entry whose fix is itself a feature; the mandatory Safety Net
   commit is an allowed untagged commit at the **base** of the branch; and
   code-review follow-up commits are traced by a report-qualified tag
   (`[r1 I4]`) rather than by a per-entry annotation, with mechanical
   follow-ups tagged by kind (`[chore]`, `[lint]`, `[typecheck]`, `[report]`).

5. **A review-response round is part of the same branch,** not a new one. The
   `[r1 …]` and `[r2 …]` commits answering the two 2026-08-23 reviews sit on
   `ovid/backlog` under rule 4's follow-up clause. (S2, review round 2: this
   said "nine", counted once when the paragraph landed at `9194a04d` and stale
   by the end of the same afternoon. A count of commits on the branch the
   document lives on rots on every push, so it is not stated — the same reason
   §Documentation Discipline rule 2 prefers a symbol to a line range.) A round-N commit may reverse a round-0
   commit on the same branch — `3460fc0a` reverts `fe7acdb7` — and that is the
   system working, not a scope violation: the review is what the branch is for.

## The rule-1 contradiction (finding S4)

The sibling document's rule 1 requires that a backlog fix "removes the backlog
entry it closes." `backlog.md`'s own §Entry lifecycle header says the opposite:
mark an addressed entry **in place** with a `FIXED <date> by <sha>` or
`Disposition` line, and "Delete an entry outright only if no commit tag and no
code comment names its id."

`ovid/backlog` follows the `backlog.md` rule, and so violates the letter of the
sibling's rule 1 on all eleven commits.

**The steering file is the stale party, not the branch.** The §Entry lifecycle
rule is the newer of the two and carries its evidence: eight ids have already
had to be re-filed retroactively because a commit tag or a code comment pointed
at an entry that had been deleted, and the seven stubs in `backlog.md`'s
closed-addresses section exist for exactly that reason. A citation is a
permanent address — an id resolving to nothing makes a commit's own PR-scope
license unverifiable, which is self-defeating for a rule about traceability.

**Resolution:** mark in place, always. Rule 3 above states it for this class of
session. The sibling document's rule-1 clause is superseded on this point; it
is not amended in place, per finding I11's instruction not to amend rule 1
again, and because rewriting a decision log after the fact is the failure mode
both documents exist to prevent.

## Recorded rather than fixed: the untagged tip commit (finding S3)

`55edd3e1 docs(backlog): mark the eleven entries closed this session` is
untagged, answers to eleven entries, and names none of them in its subject.
Rule 5 of the sibling document allows at most one untagged commit per session
and only at the **base** of the branch; this one was at the tip. Under rule 2's
placeholder-then-fill clause it should have been a rule-2 commit naming its
eleven ids, exactly as a SHA-filling commit on an architecture session must.

**It is not retagged.** The sibling document's own retag test permits amending
"when it is the tip and nothing cites it", and by the time the review was
answered neither half held: review-response commits sit after it, so the retag
means a rebase, and `55edd3e1` is cited throughout `backlog.md`'s `First seen` /
`Last seen` fields — across six entries — and in the filename of the review
report itself
(`paad/code-reviews/ovid-backlog-2026-08-23-10-29-10-55edd3e1.md`). A rebase
would stale every one of them to buy a tag, which is the trade the sibling
document declines four separate times for the same reason. (S2, review round 2:
this used to say "cited sixteen times ... on four entries". Both numbers were
right at `9194a04d` and wrong by the branch tip. The argument never needed
them — what it needs is that the citations exist and a rebase would stale them
— so the exact tally is gone rather than re-pinned to a number that rots
again.)

The rule is stated here so the next session writes the tag the first time: a
commit that records the closing of N entries **answers to those entries** and
takes their ids, even though it touches nothing but markdown. Decide the tag
from what the commit answers to, not from what it touched.

## Consequences

- `CLAUDE.md` §Pull Request Scope points at this document alongside its sibling.
- A backlog-triage branch no longer needs to choose between violating the
  one-feature rule and not existing.
- The next review of such a branch has a rule to check it against, so
  "sanctioned practice" and "drift" stop looking identical.
