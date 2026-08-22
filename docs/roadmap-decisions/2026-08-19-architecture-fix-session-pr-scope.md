# Decision: architecture-report fix sessions are one PR, one finding per commit

**Date:** 2026-08-19
**Raised by:** `/paad:agentic-review` of `ovid/architecture` @ `6e1ee51c`, finding S4
**Scope:** `CLAUDE.md` §Pull Request Scope — the one-feature rule

## The gap

`CLAUDE.md` §Pull Request Scope states two rules: a PR delivers a single
feature _or_ a single refactor, and each roadmap phase is a PR. Exceptions
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
   single `paad/architecture-reviews/` report. It carries no feature work.

   **Backlog fixes in files the session already has open are permitted**
   (review round 4, S4). `26da4b5d` and `525bb93f` close
   `paad/code-reviews/backlog.md` entries `4d5b9e81` and `1f9d4b27`, both in
   `useProjectEditor.ts` — a file this session was already reading. Rule 1 as
   first written forbade them, and the developer's standing preference is to
   fix a known bug where it is found rather than defer it to a clean branch.
   The bound is the file, not the intent: a backlog fix qualifies only if the
   session is already changing or closely reading that file, it is tagged
   `[backlog <id>]` so the log stays legible, and it removes the backlog entry
   it closes. A backlog fix elsewhere in the tree is still out of scope.

   The precedent comes with its evidence for the cost as well as the benefit:
   `525bb93f`'s fix introduced a reachable data-loss path that its symptom did
   not have (round 4, I1, closed by `0bc2c0c1`). A backlog fix landing late on
   a fix-session branch gets one review round at most, and this one needed it.

2. **One finding per commit.** Each finding gets its own
   `fix(architecture): [F-NN] …` commit plus its own
   `docs(report): [F-NN] record the fix commit SHA` commit. The finding ID is
   the traceability unit that the one-feature rule normally gets from the
   phase boundary.
   **A placeholder-then-fill batch is allowed** (review of `67c00204`, finding
   S4). A fix commit's SHA is not known until it exists, so the `Status commit`
   field cannot be written in the same commit that creates it. Two ways of
   closing that gap are legal: write the `Status:` block with a `PENDING`
   placeholder and fill the SHAs in a later commit, or write the whole block
   afterwards. Either way the filling commit is a **rule 2 commit, not a
   mechanical one** — it answers to the findings whose SHAs it records, so it
   is titled `docs(report): [F-NN][F-MM] record the fix commit SHAs` and names
   every finding in its subject, exactly as rule 6's batching allowance
   requires. It is **not** `[chore]`: rule 6 declines to require a `Status:`
   block on follow-ups *because* `git log --oneline main..HEAD` is the
   traceability surface, so a commit telling that surface there is no finding
   behind it undercuts the trade the rule rests on.

   The two commits that raised this — `63d567c8` and `67c00204` — are tagged
   `[chore]` and the batched one names none of its four findings. They were
   **not retagged**, for the reason rule 6 already gives twice: the rebase
   would invalidate `d9b0d9a9`, which sits after `63d567c8` and is recorded as
   F-25's `Status commit`, a worse traceability outcome than the one the rule
   protects. The rule is corrected here so the next session does not repeat it.

   **It was repeated anyway, and is recorded rather than fixed (2026-08-21,
   finding S3).** `d7595686` (recording F-24's `Status commit`) and `09aaba1e`
   (recording F-22's, F-28's and F-38's) are both SHA-filling commits — rule 2
   commits by the paragraph above — and both are tagged `[report]`. They are
   **not retagged**, for the reason already given twice here: rebasing from
   `d7595686` rewrites `80dcd33e`, `1129749a` and `68810d1b`, every one of
   which is recorded as a `Status commit` SHA in the report, so the retag would
   invalidate more traceability than it restores.

   `964bae82 [report] file the 2026-08-20 agentic-review report` is **not** a
   violation of this rule: filing a report the session produced answers to no
   finding, which is exactly the round-4 amendment's case for a kind tag.

   **Violated a third way and recorded rather than fixed (2026-08-21, review
   `6c71314a`, finding S8).** The two recurrences above are SHA-filling
   commits mis-tagged; this one is the gap the placeholder-then-fill clause
   exists to close, left open. `97c5160e` ships the F-03 code fix **and** ten
   lines of F-03's `Status:` block in one commit, using neither legal route —
   no `PENDING` placeholder, and no separate afterwards commit — and its
   `Status commit` SHA was inserted with `git commit --amend`. The consequence
   is confirmed, not theoretical: the report as shipped in `97c5160e` reads
   `**Status commit:** 29e40186`, a SHA that `git cat-file -t` resolves only
   because it survives in this clone's reflog. `git merge-base --is-ancestor
   29e40186 HEAD` fails, so that citation does not exist in a fresh clone. A
   later commit (`f8773951`) corrected the SHA, which is why the branch tip is
   sound; the amend is what made the correction necessary.

   The code review that raised the amend (`1b96b3b4`, finding I2) had two
   halves. The tag half was fixed by retagging; the bundling half was neither
   fixed nor recorded, which is asymmetric with how this branch treated rule
   5's violation. It is **not fixed now** for the reason given three times
   above: `97c5160e` is cited three times in F-03's `Status:` block, so a
   rebase to split it would stale every one of them.

   **Why it keeps happening, since correcting the rule twice has not stopped
   it:** both kinds of commit touch nothing but markdown under `paad/`, so
   "what did this commit touch" cannot tell them apart. Decide the tag from
   what the commit **answers to**. A commit that exists because a finding was
   fixed — including one that only writes down that fix's SHA — takes the
   finding IDs. A commit that exists because the session produced a document
   takes a kind tag.

3. **Every finding carries a `Status:` block** in the report, recording what
   was done, what was deliberately _not_ done, and the fix commit SHA.
4. **A finding whose fix is itself a feature is out of scope** for a fix
   session — it goes to the roadmap and gets its own phase and PR.
5. **The Safety Net commit is an allowed untagged commit.** The
   `/paad:fix-architecture` skill requires pinning the current behaviour with
   tests _before_ any fix commit lands, and that commit belongs to no single
   finding. It carries no `[F-NN]` tag and needs no `Status:` block. There is
   at most one per session, at the **base** of the branch — the first commit in
   `git log main..HEAD --reverse`, before any fix commit. (This sentence read
   "at the head of the branch" until review round 3, S8, which contradicted the
   preceding "_before_ any fix commit lands" and the branch's actual layout:
   `89bc9361` is the oldest commit on it.)

   **Violated once and recorded rather than fixed (2026-08-21, review
   `1b96b3b4`, finding S4).** `af2a7161` is a correctly-placed safety-net
   commit — first in `git log main..HEAD --reverse`, and its body cites this
   rule — but its subject is tagged `test(architecture): [F-03] …`. The tag is
   a violation: the branch then carries two `[F-03]` commits, so the log cannot
   say which one is the fix without opening both, while the branch's one
   untagged-commit allowance goes unused.

   It was **not retagged.** The finding's own justification for retagging is
   self-refuting: it argues that "F-03's `Status commit` line already records
   `af2a7161` by SHA, so dropping the tag loses no traceability", but that
   recorded SHA is precisely what a retag destroys — `git commit --amend`
   changes the commit's SHA. `af2a7161` is the **base** of the branch, so the
   rebase also rewrites the five commits after it, including `97c5160e`, which
   F-03 records as its fix. Three currently-correct citations in F-03's
   `Status:` block would all go stale to buy one corrected commit subject —
   the same trade rule 2 and rule 6 have each declined twice above, resolved
   the same way.

   The distinction that decides it, since this same session **did** retag one
   commit (`1b96b3b4` → `f8773951`, finding I2): retag when the commit is the
   branch tip and no `Status commit` line names it or anything after it.
   Otherwise record and move on.
6. **Code-review follow-ups are traced by commit tag, not by a `Status:`
   block.** A fix-session branch will itself be reviewed (`/paad:agentic-review`),
   and the resulting fixes are neither architecture findings nor feature work.
   They follow rule 2's _shape_ — one finding per commit, tagged after the
   code-review report that raised them — but rule 3 does not apply to them:
   `paad/code-reviews/` reports carry no `Status:` convention, and adding one
   would double the doc surface for an artifact that is read once, next to the
   branch, and superseded by the following review. For follow-ups,
   `git log --oneline main..HEAD` is the traceability surface.

   **The tag must name its report** (review round 3, S6). A bare `[S2]` is
   ambiguous the moment a branch is reviewed twice, and this branch produced six
   collided pairs across twelve follow-up commits — `[I1]` is both `46ff26fb`
   and `ee92d5e3`, `[S3]` is both `6eae2ee8` and `25e68244`, and so on. Rule 6
   _declines_ to require a `Status:` block on the grounds that the log suffices,
   a trade that is only sound if the log is unambiguous. Qualify the tag with
   the review round or the reviewed commit: `[r3 S2]` or `[da27f92 S2]`.

   **Batching is allowed when the findings edit one artifact** (review round 3,
   S7). `6eae2ee8 docs(report): [S2][S3] …` carries two findings and is the only
   precedent a future session has. It stands: both were prose edits to the same
   report, so the split would have produced two commits touching the same
   paragraphs, and rewriting it now would invalidate every commit SHA recorded
   in that report's own `Status:` blocks — a worse traceability outcome than the
   one the rule is protecting. A batched commit must name every finding in its
   subject, as that one does.
   A follow-up that changes a _shipped finding's_ deliverable must still update
   that finding's `Status:` block — see rule 3 and the F-07 precedent, whose
   guard was rewritten twice by review follow-ups after its first Status entry
   was recorded.

   **Mechanical follow-ups are tagged by kind, not by finding** (review round 4,
   S5). Three commits on this branch — `dafa3dfc` (drop useless escapes),
   `34d7edb2` (satisfy `noUncheckedIndexedAccess` at new call sites) and
   `6e894cd8` (file a review report and record a disposition) — fitted no class
   the rules allowed, and rule 6 declines to require a `Status:` block _on the
   grounds that_ `git log --oneline main..HEAD` is the traceability surface,
   which unattributable commits undercut. Such a commit answers to no finding:
   it is lint fallout, typecheck fallout, or a report/doc filing that the
   session produced rather than consumed. Tag it `[chore]`, `[lint]`,
   `[typecheck]` or `[report]` — anything that tells a later reader the commit
   is not a finding they should go looking for. Retagging the three above by
   rebase was rejected for the reason rule 6 already gives for `6eae2ee8`: it
   would invalidate every commit SHA recorded in the report `Status:` blocks,
   a worse traceability outcome than the one the rule protects.

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
_instead of_ the one-feature rule, a session reading it literally would have
found its own mandatory Safety Net commit unauthorised.

**Four of these six rules were written or rewritten under pressure from the
branch they govern** (review round 4, S7). Rules 5 and 6 were added mid-branch;
rule 5's placement was corrected and rule 6 gained both a tag-format
requirement and a batching allowance; rule 1 gained a backlog carve-out. The
sharp one is rule 6's batching allowance: round-3 S7 found that the
one-round-old rule made `6eae2ee8` a violation, and the resolution amended the
rule so the commit became legal. Each amendment is argued on its merits below
and none is retracted here — but a reader should know the provenance.
**Rule 1 is the hard bound**, and it is the one to be most suspicious of
amending: it is what keeps a fix session from becoming the tangled multi-feature
branch the one-feature rule exists to prevent. Its round-4 amendment widens the
class of allowed commits for the first time, and does so on the strength of a
developer preference rather than a structural argument.

Rules 5 and 6 were corrected on 2026-08-19 (code review round 3 of this branch,
findings S6, S7 and S8): rule 5 placed the Safety Net commit at the head of the
branch when it belongs at the base; rule 6's tag format was ambiguous across two
reviews of the same branch; and rule 6's "one finding per commit" shape, imported
from rule 2, converted a pre-existing same-artifact batch into an explicit
violation rather than resolving it.

## Recorded disposition: the shared scanner module (OOSA1)

`packages/client/src/__tests__/tsSourceScan.ts` was raised as an out-of-scope
addition in two consecutive code reviews of this branch — no architecture
finding asked for a shared scanning module, and it changed the behaviour of a
pre-existing drift detector as a side effect. **Kept**, decided 2026-08-19.

It exists because earlier rounds demanded it: round-2 I2 asked
`mutationCommittedSurface.test.ts` to reuse the first detector's comment
stripper rather than re-derive a weaker one, and round-2 S4 asked for a single
owner of the `<binding>.run(` shape after the two copies gave different answers
for the same text. Round-3 S2 and S3 extended it for the same reason. Reverting
would restore the duplication those findings were raised about; splitting it out
would hold F-07's deliverable, which imports it, behind a refactor PR.

The two behaviour changes to the pre-existing `migrationStructuralCheck.test.ts`
were weighed and accepted with it: the `.run(` matcher is looser (each newly
tolerated shape is a real call it used to report as a dead binding — fewer false
positives), and `importPatternFor` now matches `import type`, which for a future
type-only import would produce a loud offender rather than a silent pass.

## Recorded exception: two commits from the 2026-08-22 code-review response

Two commits on this branch sit outside the rules above. Both were flagged
before they landed, the maintainer was told which rule each strained, and both
were **granted on explicit request** after the concern was raised. Recorded
here so the next reader finds the decision rather than re-deriving the
violation — and, deliberately, recorded as a **bounded one-off rather than an
amendment**. Neither rule is being rewritten. That distinction is the whole
point: the Amendments section above already warns that rule 1 is the hard bound
and the one to be most suspicious of amending, and this file has now amended
its own rules five times under pressure from the branches they govern. A sixth
would be worse than an exception that admits what it is.

**`2920fa68` — `test(e2e): [backlog 8ff156ec] prove the editor lock can be
escaped`.** Strains **rule 1's round-4 backlog carve-out**, which permits a
backlog fix only in a file the session already has open. `e2e/` appears nowhere
in this branch's diff, so the file was not open by any reading. The tag form is
correct; the location is not.

Why it was granted: the backlog entry it answers records that **nothing at any
level demonstrated a locked editor becoming writable again.** The lock is
reachable in ordinary use — an auto-save PATCH 404 after a chapter is deleted
under an open editor — and from inside the editor it is a dead end. The
deliverable is two end-to-end tests, each validated by breaking its exit and
watching the matching test fail. It adds no production code and cannot regress
behaviour. Weighed against a fix session's real risk — an untested change
landing late with one review round, which is what round 4's own precedent warns
about — a test-only commit is the mild end of that spectrum.

**`3d7aaa42` — `fix(client): [7b9e1c68 S7] answer a chapter click refused by the
editor lock`.** Tag form is legal under rule 6 (a report-qualified code-review
follow-up). The strain is **rule 4**: no finding whose fix is itself a feature.
Adding user-facing feedback where there was none is arguably a small feature,
and this is a behaviour change on a branch that exists to close an architecture
finding.

Why it was granted: it is one line of behaviour reusing an existing string
(`STRINGS.editor.lockedRefusal`) to make one refusal path say what its six
siblings already say. Nothing was designed; an inconsistency was removed. The
accessibility asymmetry is what tipped it — keyboard navigation already
announced the refusal into a live region while a sighted mouse user got no
response at all, which is the inverse of the usual gap in a project where WCAG
2.1 AA is a first-class constraint.

**What this does not license.** It is not a general permission to fix backlog
entries anywhere in the tree, and not a finding that rule 4 tolerates features
when they are small. The next session wanting either should read this entry as
evidence that the ask must be made explicitly and answered explicitly — not as
evidence that the bound has moved. Both commits state their own scope tension
in their commit bodies rather than letting a correct-looking tag imply a
compliance they do not have; that is the form a future exception should take,
and it is the specific failure recorded against `d4002d6d` below.

**The honest cost.** Counted rather than estimated, because a first draft of
this paragraph asserted an ordinal nobody had checked — the failure this file's
own governing steering doc (`CLAUDE.md` §Documentation Discipline rule 2) exists
to catch, committed inside a paragraph about honesty. It then got the count
wrong anyway: it said four and the real figure was six, because two untagged
commits had landed that nobody enumerated, and a third landed after the
paragraph was written. **On this branch, ten commits now sit outside these
rules:**

- `d4002d6d` — rule 5. A correctly-placed safety-net commit carrying an
  `[F-07]` tag while its body invokes the untagged allowance, the same shape as
  `af2a7161` below.
- `3ac13bca` — rule 6. A 200-line code-review report filed inside a commit
  whose subject names only a backlog fix.
- `2920fa68` and `3d7aaa42` — the two granted exceptions recorded above.
- `7b9e1c68` — *"Add MathJax to the TODO list in docs/TODO.md"*. Untagged, no
  body, touches no code, answers to no finding and no roadmap phase. The
  2026-08-22 review filed it as `[OOSA1]` with the remedy "if kept, retag
  `[chore]`". **Kept** — it is a one-line product idea in the maintainer's own
  TODO list and reverting it would be absurd — and recorded here instead of
  retagged, because it is now eleven commits deep and the rules file's own
  retag test permits amending only the tip.
- `eb9ffee8` — *"formatted"*. Untagged Prettier reflow; the correct form is
  `c10fd5e2`'s `style(client): [lint] … plus prettier reflow` on this same
  branch. The 2026-08-22 review's `[S4]` proposed amending it, which was
  available then (it was the tip) and is not now.
- `7250904e` — *"Add note to CLAUDE instructing Claude to speak plainly."*
  Untagged, unrelated to any finding, and it landed **after** `8d15fdda` wrote
  the count this paragraph is correcting.
- `63307187`, `9232702e`, `b0393d22` — the three out-of-scope fixes recorded
  in the next section.

The distribution is the point. Six of the ten are documentation, formatting or
process commits that nobody thought of as commits at all while making them,
which is exactly how an untagged commit gets past a rule its author agrees
with.

The five instances recorded elsewhere in this file — `af2a7161`, `97c5160e`,
`d7595686`, `09aaba1e`, `6eae2ee8` — are on **earlier** branches, already merged
(`git merge-base --is-ancestor <sha> main` succeeds for each). Do not read them
as this branch's history.

That distribution is the signal worth carrying forward: every branch this file
has governed has produced commits it did not authorise, which is better evidence
that the rules describe a tidier practice than the one being run than it is
evidence of undisciplined sessions. A future session should treat that as a
question about the rules, not only about the commits. The load-bearing bound
remains reviewer capacity, per the argument below — and by that measure this
branch is now large enough that the next finding should go to a fresh branch
rather than be argued into this one.

## Recorded exception: three out-of-scope fixes from the 2026-08-22 (14:21) code-review response

The 2026-08-22 14:21 agentic review carried three out-of-scope suggestions
(`OOSS1`, `OOSS2`, `OOSS3`). The trade-offs of each were put to the maintainer
in prose — what fixing bought, what it cost, and the strongest argument for
leaving all three alone — and the answer was **fix all three**. Recorded here as
a bounded one-off, on the same terms as the two granted above: no rule is being
rewritten.

**`63307187` — `fix(client): [OOSS3 6b01b73b] one try per key in
clearAllCachedContent`.** Strains **rule 1's round-4 backlog carve-out**, which
permits a backlog fix only in a file the session already has open.
`useContentCache.ts` is not touched anywhere else on this branch.

**`9232702e` — `fix(client): [OOSS1 f858e66a] double supersession onto an
affected chapter escalates`.** Inside the carve-out: `useEditorMutation.ts` is
the branch's central file, and the fix sits in the same closure as the in-scope
`[S9]` change immediately before it.

**`b0393d22` — `fix(client): [OOSS2 4485eebf, S6] name the chapter the replace
actually wrote to`.** Inside the carve-out for its file, but it carries **two
tags** — an out-of-scope fix and the in-scope `[S6]` documentation finding —
against rule 1's one-finding-per-commit shape. They are one change: `[S6]` is
the CLAUDE.md sentence that `[OOSS2]` makes true, and splitting them would land
a commit whose only content is a doc edit describing code that does not exist
yet.

Why they were granted: all three are latent (none is reachable through the
current UI, each needing a mid-flight chapter switch that `switchToView`'s
`isActionBusy()` gate refuses), and all three sit on the save pipeline's
data-loss paths — the draft cache that CLAUDE.md save-pipeline invariant 3 calls
the last line of defence, and the two re-enable decisions that decide whether an
auto-save can revert a server-committed write. Deferring a known data-loss
guard to a branch that may not be written is the more expensive choice.

**What this does not license.** Same bound as the section above: this is not
evidence that out-of-scope findings may be swept up by default. The ask was made
explicitly, per tier, with the case against stated, and answered explicitly.

## Recorded: the 2026-08-22 18:29 code-review response (branch `ovid/architecture` @ `b66c3f77`)

Four items from that review are recorded here rather than fixed by rebase.
Three are rule violations this branch committed; the fourth is an out-of-scope
addition the maintainer chose to keep. No rule is being amended — see the
Amendments section's warning about doing that under pressure from the branch
being governed.

**Rule 2, the placeholder-then-fill clause, violated four times — and this time
the consequence landed (finding I5, and it is the *mechanism* behind finding
I2).** All four fix commits on this branch — `81a87fd9`, `3d6a5bbc`,
`ee186275`, `3b97f72c` — carry +4 lines of the architecture report alongside
their production change, with the `Status commit` SHA supplied by
`git commit --amend`. The reflog confirms the amend for all four: each pair is
`commit:` followed by `commit (amend):` at the same timestamp. That is the
third route, the one rule 2 exists to forbid, and it is the same shape already
recorded against `97c5160e`.

The consequence is not theoretical here either. Bundling the block forces the
amend; the amend invalidates the SHA the block had just recorded. **All four**
`Status commit` values shipped pointing at commits that do not exist —
`git merge-base --is-ancestor` fails and `git branch -a --contains` returns
nothing for every one. They resolved locally only because this clone's reflog
held them. Corrected in `2a22941b`, without amending the fix commits again,
since that is what caused it.

The rules doc's own note against `97c5160e` — "The rule is corrected here so
the next session does not repeat it" — has now failed twice. The distinction
that keeps failing to transfer is small and worth stating flatly: **the SHA of
a commit is not knowable inside that commit.** Write `**Status commit:**
PENDING` in the fix commit and fill it in a following `docs(report): [F-NN]…`
commit. Do not reach for `--amend`.

**Rule 5, a second untagged commit (finding S1).** `f3896525` — subject "PAAD
review", no body — files the 699-line architecture report at the base of the
branch. Rule 5 allows exactly one untagged commit per session and the Safety
Net `c5192d0c` is it. Rule 6's round-4 amendment already names the correct
form: `964bae82 [report] file the 2026-08-20 agentic-review report`. **Not
retagged** — it is the oldest commit on the branch, so the rebase would rewrite
every commit after it, including all four whose SHAs the report now records
correctly for the first time. That is the trade this file has declined five
times already, resolved the same way.

**Rule 6, a kind tag on a commit that answers to findings (finding S5).**
`d77d49df` is tagged `[report]`, but it exists because the F-01 fix moved the
line F-28's evidence cites — it answers to two findings, and rule 6's own
deciding test ("decide the tag from what the commit **answers to**") gives it
`[F-01][F-28]`. `git log --oneline main..HEAD` is the declared traceability
surface for follow-ups, so a kind tag tells a later reader there is no finding
behind a commit that has two. **Not retagged**, for the reason above: it sits
before four commits whose SHAs are now recorded in the report.

**Out-of-scope addition kept on request (`OOSA1`).** The `multerLimitError`
helper in `images.routes.ts` landed inside `ee186275` alongside F-38's caps.
F-38 asked only for the caps; the helper changed the endpoint's observable
error contract, which nothing asked for — and `ee186275`'s own Status reason
says so in plain words ("A second, unrelated defect surfaced while fixing this
and is fixed with it").

The trade-offs were put to the maintainer in prose — keep-and-record, split by
rebase, or revert — with the argument against keep-and-record stated: this file
has now recorded ten out-of-rule commits across its history, and a rule broken
every time is better evidence that the rule is wrong than that the sessions are
undisciplined. The answer was **keep and record**. The reasoning that decided
it: the helper is load-bearing for the caps F-38 *did* ask for — without it a
`fields: 0` breach surfaces as a 500, so shipping the caps alone would have made
the endpoint worse — and the only clean alternative, splitting it out by
rebase, rewrites `ee186275`, which is one of the four SHAs the same review round
had just repaired.

The helper was itself found incomplete by the same review (finding I1) and is
rewritten in `cf79db33`; F-38's Status reason records that amendment per rule 6.

**A fourth, committed by the response itself.** `cf79db33` — the `[I1]` code
fix — also carries the 186-line code-review report it answers to, because the
staging command that added its source files added the untracked report with
them. That is the `3ac13bca` shape recorded above: a review report filed inside
a commit whose subject names something else, so `git log --oneline main..HEAD`
does not say the report was filed at all.

**Not rebased**, but the reasoning differs from every other instance in this
file and the difference is worth stating, because it is the first time the
usual argument does not apply. Everywhere above, the rebase was declined
because it would have staled a `Status commit` SHA recorded in the report. Here
it would not: all four recorded SHAs — `81a87fd9`, `3d6a5bbc`, `3b97f72c`,
`ee186275` — sit **before** `cf79db33`, and the review report's own filename
cites `b66c3f77`, also before it. A rebase splitting the report into its own
`[report]` commit would cost no traceability at all.

It is declined on the letter of rule 6's deciding test instead — "retag when the
commit is the branch tip and no `Status commit` line names it or anything after
it; otherwise record and move on" — and `cf79db33` is not the tip. That is a
weaker reason than the ones above, and a reader should treat it as one. The
honest reading is that rule 6's test was written from a rationale (rebase cost)
and then stated as a mechanical condition (tip-or-not), and this is the first
case where the two come apart. If the next session wants to resolve that, the
question is whether the test should read "when the rebase would stale no
recorded SHA" — which is what every declined instance here was actually
arguing.

**What this does not license.** Same bound as the two sections above. Four
recorded violations in one session is not evidence that the bound has moved;
it is evidence for the reading the Amendments section already offers — that
these rules describe a tidier practice than the one being run, and that the
next session should treat that as a question about the rules rather than only
about the commits.

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

Rule 1 was amended and rule 6 gained a mechanical-follow-up clause on
2026-08-19 (code review round 4 of this branch, findings S4, S5 and S7).

Rule 2 gained the placeholder-then-fill clause on 2026-08-20
(`paad/code-reviews/architecture-2026-08-20-13-47-08-67c00204.md`, finding S4).
That is the **fifth** rule amendment made under pressure from a branch this
file governs, and the honest reading is the one the provenance paragraph above
already gives: each is argued on its merits, and each was written by the
session it excuses. This one is the mildest of them — it does not widen the
class of allowed commits, it narrows it, by moving a commit shape out of
`[chore]` and back under rule 2's naming requirement.
