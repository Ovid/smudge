# Agentic Code Review: ovid/architecture

**Date:** 2026-08-22 14:21:36
**Branch:** ovid/architecture -> main
**Commit:** eb9ffee837bdb772c5f36b71367e06ef6d458fff
**Files changed:** 23 | **Lines changed:** +2060 / -1069
**Diff size category:** Large

## Executive Summary

The F-07 seam refactor itself verified sound: the verifier independently confirmed that
`useEditorMutation.run()` dispatches exactly one terminal machine event on every path, that all
three production `run()` callers supply the now-required `committedLock` directive field, and that
neither controller dispatches a second transition after a `committed_but_unreloaded` return. No
Critical findings — every behavioural hazard the specialists surfaced is either latent behind
`switchToView`'s `isActionBusy()` gate or pre-existing on `main`.

The two Important findings are both about *evidence* rather than behaviour, which is the shape of
this branch. It deleted a 686-line forcing test (`mutationCommittedSurface.test.ts`) on the
argument that the compiler plus the surviving prose is now the contract — and then left ten prose
sites teaching the contract it replaced ([I1]), and one e2e test asserting a lock exit it does not
actually exercise ([I2]). Confidence is high: seven specialists ran with full reference-file
coverage, the verifier resolved two direct inter-specialist contradictions by reading source, and
one finding was dropped as a false positive.

## Critical Issues

None found.

## Important Issues

### [I1] Ten sites still teach the deleted pre-F-07 contract
- **File:** `packages/client/src/hooks/useEditorMutation.ts:511`, `:561`; `packages/client/src/__tests__/EditorPageFeatures.test.tsx:1268`, `:2650-2652`; `packages/client/src/hooks/__tests__/useSnapshotController.test.tsx:431-432`, `:504`; `packages/client/src/__tests__/migrationStructuralCheck.test.ts:175`, `:356`, `:377`, `:416`, `:439`
- **Bug:** The committed-but-unreloaded protocol inverted on this branch. Before, `run()`'s `finally`
  dispatched nothing on that path and the consumer completed the transition; now the seam dispatches
  exactly one terminal event and a consumer that dispatches again re-creates OOSI1/OOSS1. Ten prose
  sites still describe the old protocol:
  - `useEditorMutation.ts:511` and `:561` say "set `reloadFailed`" — comments naming a variable this
    branch deleted, inside the file that deleted it.
  - `EditorPageFeatures.test.tsx:1268` attributes the `COMMITTED_UNRELOADED` dispatch to "the
    controller calls `applyReloadFailedLock`", which `finalizeReplaceSuccess` now gates behind
    `if (!seamOutcome)` precisely so it does *not* run on that path.
  - `EditorPageFeatures.test.tsx:2650-2652` quotes deleted code verbatim: "the `finally`
    deliberately leaves [that path] without a terminal dispatch (`if (reloadFailed) { /* no-op */ }`)".
  - `useSnapshotController.test.tsx:431-432` says "the re-assert is what keeps the unrelated editor
    from being stranded read-only" — nine lines above the assertion this branch changed to
    `expect(h.applyReloadFailedLock).not.toHaveBeenCalled()`. `:504`'s title says "raises the
    persistent lock banner" while `:520` asserts it is not raised.
  - `migrationStructuralCheck.test.ts` names the deleted `mutationCommittedSurface.test.ts` five
    times in the present tense, twice as the live justification for its own parser self-tests.
- **Impact:** The branch deleted the 686-line forcing test on the explicit argument that the seam
  plus the compiler make the failure structurally impossible. That promotes the surviving prose to
  being the contract. Two of these sites sit directly above code that now does the opposite, and a
  maintainer following `useSnapshotController.test.tsx:431` would re-add the second dispatch that
  *is* the OOSS1 defect. Live, not latent — the hazard is a maintainer reading the prose. Filed as
  `[7b9e1c68 I2]` and `[94c958c4 S5]` on this branch; neither is closed at HEAD.
- **Suggested fix:** Finish the `9481bc8b` / `eb65aba0` sweep with those commits' own criterion —
  past-tense history stays, present-tense contract goes — and retitle
  `useSnapshotController.test.tsx:504`. Leave `EditorPageFeatures.test.tsx:2559-2560` alone: it
  drives the restore 2xx-`BAD_JSON` path, where `useSnapshotController.ts:396` genuinely still calls
  the helper.
- **Confidence:** High
- **Found by:** Contract & Integration + Spec Compliance (`general-purpose (claude-opus-5)`)

### [I2] The e2e "leave the project and return" test does not exercise the return it claims
- **File:** `e2e/editor-save.spec.ts:183-208`
- **Bug:** The test's own comment says it pins the second lock exit — leaving `/projects/:slug`
  unmounts `EditorPage`, discarding the `useReducer` that holds the lock, so re-entering mounts a
  fresh machine. The outbound leg is genuine (a logo click, SPA route change, asserted by
  `toHaveURL(/\/$/)`). The **return** leg is `await gotoProjectEditor(page, project.slug)`, and that
  helper (`e2e/helpers/gotoProjectEditor.ts:34`) calls `page.goto()` — a full document navigation
  that tears down the entire JS context.
- **Impact:** If a future change kept the lock alive across the SPA unmount (`EditorPage` hoisted
  above the router, or the machine lifted into a context provider), the two following assertions
  (`contenteditable === "true"`, alert count 0) would still pass, satisfied by the hard reload
  alone — which the sibling test above already proves. This test is the deliverable of a granted
  scope exception (`2920fa68`) and the basis on which backlog `8ff156ec` was marked partially
  addressed, so the overstated coverage matters more than usual.
- **Suggested fix:** Return through the app rather than the address bar — click the project's card
  on the dashboard, then `await expectEditorReady(page)` — so no page load intervenes between
  leaving and re-entering.
- **Confidence:** Medium
- **Found by:** Logic & Correctness B (`general-purpose (claude-opus-5)`)

## Suggestions

- **[S1]** `paad/architecture-reviews/2026-08-11-smudge-architecture-report.md:349` — F-07's rewritten Status reason says "All **seven** `committed_but_unreloaded` return sites route through one `committed()` helper"; the grep returns **six** (`:263, :264, :521, :524, :581, :585`). Seven was true at `d2ce94e5`; `3ac13bca`'s `settleAfterFailedRelock` extraction collapsed three sites into two, and the sentence was edited twice afterwards — and *names* that extraction — without re-counting. Exactly the failure CLAUDE.md §Documentation Discipline rule 2 exists to catch. Filed as `[7b9e1c68 S8]`. Fix: "seven" → "six". (Spec Compliance, confidence High)
- **[S2]** `paad/code-reviews/backlog.md` — backlog entry `f518cf8d` was never filed, yet production code cites it twice as its own justification (`useEditorMutation.ts:258`, `:481`, plus `useEditorMutation.test.tsx:1389` and the architecture report). Commit `3ac13bca` is tagged `[backlog f518cf8d]`, and that tag is the only thing licensing the commit under the PR-scope rules — an ID resolving to nothing makes the license unverifiable. Filed as `[7b9e1c68 S10]`. Fix: add the entry with a `FIXED 2026-08-22` marker (matching `8ff156ec`'s shape), or amend the two code comments to cite the review-report section. (Spec Compliance, confidence High)
- **[S3]** `docs/roadmap-decisions/2026-08-19-architecture-fix-session-pr-scope.md:315` — the "honest cost" paragraph enumerates four out-of-rule commits; the real figure is six. Missing: `7b9e1c68` (untagged, no body, unrelated doc) and `eb9ffee8` (the branch tip, untagged Prettier reflow, landing *after* `8d15fdda` wrote the count). The paragraph's explicit subject is that it counted rather than estimated, so a wrong count here is self-refuting. Fix: extend the enumeration to six, naming both. (Spec Compliance, confidence High)
- **[S4]** Commit `eb9ffee8` ("formatted") is an untagged commit and rule 5's single untagged slot was already spent by the Safety Net commit `d4002d6d` (recorded in `[7b9e1c68 S9]`). The precedent on this same branch is `c10fd5e2`, correctly tagged `style(client): [lint] … plus prettier reflow`. Fix: amend to `style(e2e): [lint] prettier reflow of the new lock-recovery tests` — it is the tip and no `Status commit` line names it, so the rules file's own retag test permits it. (Spec Compliance, confidence High)
- **[S5]** `packages/client/src/hooks/useSnapshotController.ts:362-363` (second inline copy at `:239-241`) — the restore 2xx-`BAD_JSON` arm hand-rolls `currentId !== undefined && currentId !== activeChapter.id` instead of calling the `isDriftedFrom` helper this branch exported for exactly that purpose. No behaviour difference today (`activeChapter` is narrowed non-null past the `:113` guard), but `CLAUDE.md:301` — a sentence this branch added — says "both possibly-committed paths read drift the same way" and there are three such sites. `CommittedLockSpec.targetChapterId` is already optional, so the equivalence is a property of this call site, not of the shape. Filed as `[7b9e1c68 S2]`. Fix: call the helper at both sites, or amend CLAUDE.md:301 to name the sites rather than count them. (Logic-A + Error Handling + Contract & Integration, confidence Medium)
- **[S6]** `CLAUDE.md:272-273` — the rewritten safe-drift sentence keeps "re-enables the now-unrelated editor with a dismissible, **chapter-attributed** notice". True for restore; false for replace, whose drift arm uses the unattributed `STRINGS.findReplace.replaceSucceededReloadFailed`, and no `replaceSucceededReloadFailedOnOtherChapter` exists in `strings.ts`. CLAUDE.md is now the only surviving prose statement of this contract. Fix: scope the sentence — "chapter-attributed on the restore path; the replace path's notice is currently unattributed (backlog `4485eebf`)" — or add the string and make the sentence true. Pairs with **[OOSS2]** below, which is the code half. (Spec Compliance, confidence Medium)
- **[S7]** `paad/architecture-reviews/2026-08-11-smudge-architecture-report.md:349` vs `:360`/`:362` — F-07 now carries two `Status reason:` bullets with opposite conclusions, separated only by a single `- **Superseded status (kept for history):**` marker at `:359`. Everything below is unchanged and unmarked, including `:362`'s "That option remains available and is the right one if a third consumer ever lands" and "the `*** STOP` block in `mutationCommittedSurface.test.ts` … now points here" — a file that no longer exists. Fix: nest the superseded run under `:359`, or prefix `:360`–`:366` with `(superseded 2026-08-21)`. (Spec Compliance, confidence Medium)
- **[S8]** `packages/client/src/hooks/__tests__/committedUnreloadedEndState.test.tsx:162`, `:174` — the harness builds both deps objects with `as unknown as FindReplaceControllerDeps` / `as unknown as SnapshotControllerDeps`, so a newly-added required dep arrives as `undefined` at runtime while the file compiles green. Same blind spot the `MutateSpec` fix (`useSnapshotController.test.tsx:48-59`, commit `754acbd1`) closed elsewhere on this branch — and this file is now the primary guarantee for the relocated F-07 assertions. Fix: build the deps to the real interface with per-field typed `vi.fn()`s, mirroring `754acbd1`. (Logic & Correctness B, confidence Medium)
- **[S9]** `packages/client/src/hooks/useEditorMutation.ts:235-241` — `committed()` builds one verdict from two independent reads of the active chapter: `activeChapterIsAffected(d)` calls `getActiveChapter()` a second time rather than using the `currentId` already in scope. Correct today (one synchronous tick, no `await` between), but `activeChapterIsAffected`'s doc comment justifies its live read ("every caller sits after an await") — right for `settleAfterFailedRelock`, wrong inside `committed()`. A future `await` between the two reads yields a torn verdict in the dangerous direction. Fix: make the affected check a pure predicate over an id so `committed()` reads once. (Concurrency & State, confidence Medium)
- **[S10]** `packages/client/src/hooks/useFindReplaceController.ts:279-297` and `:555-573` — `executeReplace` and `handleReplaceOne` each build a structurally identical 18-line `committedLock` + directive-return block, differing only in `targetChapterId` and the `clearCacheFor` expression. The coupling that matters is the shared `message: STRINGS.findReplace.replaceSucceededReloadFailed`: both flows describe the same failure and must say the same thing, and nothing enforces it. `settleAfterFailedRelock` was extracted this same branch on exactly this evidence. Fix: a local `buildReplaceDirective(resp, { targetChapterId, clearCacheFor, current })`. (Contract & Integration, confidence Medium)
- **[S11]** `packages/client/src/hooks/useEditorMutation.ts:75`, `:93`, `:618-624` — the drifted-arm *copy* obligation is reviewer-enforced, not mechanically enforced. Making `committedLock` required closes the non-drifted sub-case completely (the seam raises `COMMITTED_UNRELOADED` with the caller's copy even if the caller ignores the result), but on the drifted sub-case the seam dispatches `MUTATION_SETTLED_SUPERSEDED` and carries no copy — the notice stays caller-owned. A fourth caller writing `void mutation.run(...)` would produce a silently re-enabled editor after an unconfirmed server-committed write. **Note:** the residual is already recorded by decision at architecture-report `:350`, so this is not a lost guarantee — only an opportunity to make the recorded decision structural. Fix (optional): add a required `driftedNotice` alongside `message` in `CommittedLockSpec`. Do **not** re-add the 686-line scanner. (Logic-A + Logic-B + Concurrency & State, confidence Medium)

## Out of Scope

> **Handoff instructions for any agent processing this report:** The findings below are
> pre-existing bugs that this branch did not cause or worsen. Do **not** assume they
> should be fixed on this branch, and do **not** assume they should be skipped.
> Instead, present them to the user **batched by tier**: one ask for all out-of-scope
> Critical findings, one ask for all Important, one for Suggestions. For each tier, the
> user decides which (if any) to address. When you fix an out-of-scope finding, remove
> its entry from `paad/code-reviews/backlog.md` by ID.

### Out-of-Scope Critical

None found.

### Out-of-Scope Important

None found.

### Out-of-Scope Suggestions

#### [OOSS1] `run()`'s superseded-twice fall-through re-enables without consulting `activeChapterIsAffected` — backlog id: `f858e66a`
- **File:** `packages/client/src/hooks/useEditorMutation.ts:587-601` (symbol `run`)
- **Bug:** When the confirming reload returns `"superseded"`, the now-active chapter *is* in
  `directive.clearCacheFor`, and the second reload *also* returns `"superseded"`, control matches
  neither the `"failed"` nor the `"reloaded"` branch. It falls through with `reloadSuperseded` still
  `true`, reaches `return { ok: true, data: directive.data }` at `:601`, and the `finally` dispatches
  `MUTATION_SETTLED_SUPERSEDED` → `{editable: true, lock: null}`. This is the one re-enable site of
  three that does not ask the branch's own new question. The inline comment at `:592-597` accepts the
  race but was written before `activeChapterIsAffected` existed.
- **Impact:** If the user landed on another affected chapter, the next keystroke's auto-save PATCHes
  pre-mutation content over the server-committed replace. Latent — it needs two active-chapter
  changes inside one mutation, both refused by `switchToView`'s `isActionBusy()` gate.
- **Scope note:** the anchor is outside every touched range (`581` and `585` are touched, `587-601`
  is not), and `main` carries the byte-identical arm — the branch neither introduced it nor changed
  its reachability.
- **Suggested fix:** `if (activeChapterIsAffected(directive)) return committed(directive);` before
  the fall-through — one line, helper already in scope, making all three re-enable sites read the
  hazard identically.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-5)`)
- **Backlog status:** re-seen (first logged 2026-08-22, earlier run this same day)

#### [OOSS2] Replace flow's safe-drift notice is not chapter-attributed — backlog id: `4485eebf`
- **File:** `packages/client/src/hooks/useFindReplaceController.ts:170` (symbol `finalizeReplaceSuccess`)
- **Bug:** The drift arm emits `setActionError(lockMessage ?? STRINGS.findReplace.replaceSucceededReloadFailed)`,
  and on the committed path `lockMessage` is never passed. Concrete failure: chapter-scope replace on
  "Chapter One", user on "Chapter Three" when the confirming GET fails. The seam correctly re-enables
  Chapter Three, and the notice — "editing now would overwrite the replacement" — reads as a claim
  about Chapter Three, the one chapter definitively safe to edit, while the chapter actually at risk
  is never named. Precisely the misattribution OOSS1 fixed for restore.
- **Impact:** Latent — reaching it needs a mid-flight chapter switch that `switchToView`'s
  `isActionBusy()` gate refuses. Live as a documentation contradiction (see **[S6]**).
- **Suggested fix:** Add `STRINGS.findReplace.replaceSucceededReloadFailedOnOtherChapter(chapterTitle)`
  mirroring the restore string, thread the target title into the drift arm, and correct
  `strings.ts:499`'s "Mirrors … the find-replace stale-drift arm" comment plus `CLAUDE.md:273` in the
  same change.
- **Confidence:** Medium
- **Found by:** Logic & Correctness B + Contract & Integration + Spec Compliance (`general-purpose (claude-opus-5)`)
- **Backlog status:** re-seen (first logged 2026-08-22, earlier run this same day)

#### [OOSS3] `clearAllCachedContent` wraps the whole loop in one `try`, so a mid-loop throw skips the remaining chapters — backlog id: `6b01b73b`
- **File:** `packages/client/src/hooks/useContentCache.ts:45-53` (symbol `clearAllCachedContent`)
- **Bug:** `try { for (const id of chapterIds) { localStorage.removeItem(...) } } catch (err) { clientWarn(...) }`.
  If `removeItem` throws on the *n*-th of *m* ids (Safari private mode, `SecurityError` on a
  partitioned origin), ids *n+1…m* keep their drafts and the function returns `void`, so
  `useEditorMutation.run` cannot distinguish a full clear from a partial one.
- **Impact:** The committed path then raises a lock banner whose whole instruction is "refresh the
  page" — on refresh a surviving draft re-hydrates and the first keystroke PATCHes pre-mutation
  content over the commit, arriving via the recovery step the UI recommended. This is the last line
  of defence named in CLAUDE.md save-pipeline invariant 3.
- **Scope note:** `useContentCache.ts` is not touched by this branch at any line, and nothing in the
  diff changes how or how often it is called.
- **Suggested fix:** Move the `try` inside the loop; optionally return the count of failed ids
  instead of `void`, matching `setCachedContent`'s existing boolean signal.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-5)`)
- **Backlog status:** new

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These M additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] Unrelated MathJax product idea added by an untagged commit
- **File:** `docs/TODO.md:3` (`- MathJax?`), commit `7b9e1c68`
- **Addition:** A one-line product idea appended to the TODO list. It appears in no architecture
  finding, no code-review finding, and no roadmap phase, and has nothing to do with F-07, the
  editor-mutation seam, or anything else the branch touches. The commit is untagged, has no body,
  and touches no code. The branch's own review filed it as `[OOSA1]` with the remedy "if kept, retag
  `[chore]`"; it was neither retagged nor added to the scope-exception log (see **[S3]**), so it is
  the one out-of-rule commit on this branch with no paper trail at all.
- **Suggested intent source:** `docs/roadmap-decisions/2026-08-19-architecture-fix-session-pr-scope.md`
  (the fix-session PR-scope rules), the two in-branch code-review reports, and the branch commit
  messages.
- **Confidence:** High
- **Found by:** Spec Compliance (`general-purpose (claude-opus-5)`)

## Review Metadata

- **Agents dispatched:** Logic & Correctness A (`useEditorMutation.ts`, `useReconcileEditable.ts`, `useKeyboardShortcuts.ts`, `EditorPage.tsx`); Logic & Correctness B (`useFindReplaceController.ts`, `useSnapshotController.ts`, `tsSourceScan.ts`, `e2e/editor-save.spec.ts`); Error Handling & Edge Cases; Contract & Integration; Concurrency & State; Security; Spec Compliance; Verifier
- **Scope:** Changed — `packages/client/src/hooks/{useEditorMutation,useFindReplaceController,useSnapshotController,useReconcileEditable,useKeyboardShortcuts}.ts`, `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/__tests__/tsSourceScan.ts`, `e2e/editor-save.spec.ts`, five test files, `CLAUDE.md`, `docs/`, `paad/`. Adjacent — `useEditorMutationMachine.ts`, `useAbortableSequence.ts`, `useAbortableAsyncOperation.ts`, `useProjectEditor.ts`, `useContentCache.ts`, `useSnapshotState.ts`, `components/Editor.tsx`, `errors/`, `strings.ts`, `editorEntryPointSurface.test.ts`, `migrationStructuralCheck.test.ts`, `e2e/helpers/gotoProjectEditor.ts`
- **Raw findings:** 18 (before verification)
- **Verified findings:** 16 (after verification and merging)
- **Filtered out:** 2 (one dropped as a false positive — Contract's `exitSnapshotView()` claim, resolved against Logic-A by source read; one collapsed into a merge group)
- **Out-of-scope findings:** 3 (Critical: 0, Important: 0, Suggestion: 3)
- **Out-of-scope additions:** 1
- **Backlog:** 1 new entry added, 2 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md`
- **Intent sources consulted:** `paad/architecture-reviews/2026-08-11-smudge-architecture-report.md` (F-07, F-36, F-08 Status blocks); `paad/code-reviews/ovid-architecture-2026-08-21-14-13-25-94c958c4.md`; `paad/code-reviews/ovid-architecture-2026-08-22-08-41-57-7b9e1c68.md`; `docs/roadmap-decisions/2026-08-19-architecture-fix-session-pr-scope.md`; `docs/roadmap.md`; `docs/TODO.md`; branch commit messages; branch name
- **Verifier warnings:** none

### Adjudications performed by the Verifier

- **Dropped:** Contract & Integration's claim that `handleRestoreSnapshot`'s `committed_but_unreloaded`
  drift arm should call `exitSnapshotView()`. Logic-A was right: when `stale` is true the directive is
  `{clearCacheFor: [], reloadActiveChapter: false}`, which cannot reach `committed()`, so every path
  reaching that arm is the non-stale path — and on the non-stale path `useSnapshotState.restoreSnapshot`
  already runs `setViewingSnapshot(null)` before returning. The sibling 2xx-`BAD_JSON` arm genuinely
  needs the call because it reaches the controller via a throw, where `setViewingSnapshot(null)` never ran.
- **Confirmed:** `e2e/helpers/gotoProjectEditor.ts:34` is `await page.goto(...)`, upholding [I2].
- **Confirmed by independent grep:** six `return committed(` sites, not seven ([S1]); `f518cf8d`
  absent from `backlog.md` ([S2]); six out-of-rule commits, not four ([S3]).
- **Security specialist bailed cleanly** (`BAIL: security no-boundary`) after enumerating and clearing
  the server-string-to-DOM path, the TipTap render path (note-mark strip and image-URI allowlist both
  still in force, no new render site), and draft-cache integrity.
