# Agentic Code Review: scratchpad-outtakes

**Date:** 2026-08-04 10:00:22
**Branch:** scratchpad-outtakes -> main
**Commit:** ef6a65a1013b16c9091a76f71b15e7ec6769854d
**Files changed:** 146 | **Lines changed:** +11156 / -900
**Diff size category:** Large

## Executive Summary

Round six on this branch. Twelve specialists (six lenses × two partitions) produced 22 findings above the confidence floor; verification confirmed 21 and dropped one as already-mitigated. No Critical issues. The headline is a cluster of **fail-open TipTap walkers**: five independent specialists converged, three by execution, on `stripImageNodes` returning a node verbatim when its `content` is a non-array container — so an outtake can be captured holding a live image reference that nothing ref-counts, defeating the invariant CLAUDE.md names as the reason the strip exists. It survived five rounds because the branch's own new guard test certifies it with `expect(...).not.toThrow()`, the exact non-discriminating assertion that test file's own header forbids. Two other Important findings are independent: intra-paragraph captures persist a structurally invalid ProseMirror doc into a hard-delete table, and every outtake mutation is bound to a tab panel that unmounts on an ordinary click, silently aborting possibly-committed writes. Confidence in the findings is high — the verifier re-reproduced the load-bearing claims independently rather than taking specialist word for them.

## Critical Issues

None found.

## Important Issues

### [I1] `stripImageNodes` fails open on a non-array `content` container — an image node survives the outtake capture strip
- **File:** `packages/shared/src/tiptap-images.ts:20`
- **Bug:** `if (!Array.isArray(node.content)) return node;` returns the subtree **unexamined**. `TipTapDocSchema` types top-level `content` only, and `validateTipTapDepth` returns `true` for a non-array container, so `POST /api/projects/:id/outtakes` accepts the body, `createOuttake` (`packages/server/src/outtakes/outtakes.service.ts:38`) strips nothing, and the row persists a live `/api/images/<uuid>` reference. Reproduced by execution by three specialists and independently by the verifier.
- **Impact:** The walker's own docblock (`:24-28`, "Fails closed … no caller has to depth-validate first for the no-images guarantee to hold") and CLAUDE.md §Data Model both state this strip as the *structural* mechanism behind a load-bearing invariant. `extractImageIds` never scans `outtakes` and itself skips a non-array container, so `deleteImage` will not raise `IMAGE_IN_USE` and the reaper can unlink the file while the outtake still points at it. The branch hardened the two sibling walkers against exactly this container shape one commit apart (`wordcount.ts:38`, `tiptap-plaintext.ts:45`) and left this one. **Compounding:** the guard test cannot fail — `packages/server/src/__tests__/tiptap-depth-walkers.test.ts:398-401` ("every walker also fails closed on %s as a nested `content` container", with a case literally named `["an object", { type: "text", text: "smuggled" }]`) asserts only `expect(() => stripImageNodes(doc)).not.toThrow()`, which that same file's header at `:24` declares non-discriminating and forbids.
- **Suggested fix:** `if (!Array.isArray(node.content)) return { ...node, content: undefined };`, matching the two siblings. Then upgrade the two strip cells in the container table to `expect(JSON.stringify(stripImageNodes(doc))).not.toContain("smuggled")`, verified by reverting the fix first.
- **Severity note (adjudicated, not vote-counted):** exploitability is low — no shipped client emits an object-valued `content`, so this needs a hand-crafted request in a single-user, no-auth app where the "attacker" is the writer. It is Important rather than Suggestion because the file is new on this branch, its docstring asserts a guarantee the code does not provide, the branch's own new test certifies that guarantee with an assertion that provably cannot fail, and the fix is one line. Not Critical: nothing fires in normal use.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security — five independent specialists (`claude-opus-5[1m]`)

### [I2] Capturing a selection inside one paragraph persists a structurally invalid TipTap doc
- **File:** `packages/client/src/pages/EditorPage.tsx:1021-1022`
- **Bug:** `Node.slice(from, to)` defaults `includeParents = false` and cuts at `$from.sharedDepth(to)`. For same-paragraph endpoints that depth is the paragraph, so `slice.content` is the paragraph's **inline** content. The captured doc is `{type:"doc",content:[{type:"text",…}]}`, which fails ProseMirror's `doc: "block+"` content expression. Confirmed by execution: `schema.nodeFromJSON(...).check()` → `Invalid content for node doc: <"quick">`. `TipTapDocSchema` cannot catch it (`content: z.array(z.record(z.unknown()))`), so it passes both the POST and `handleInsertOuttake`'s re-check at `:554`.
- **Impact:** Triggered by "select a sentence in a paragraph and click Send selection to outtakes" — the feature's most natural gesture, so the likelihood of producing bad rows is ~100%. There is no user-visible effect *today*: `countWords`, `toPlainText` and `stripImageNodes` are hand-rolled JSON walkers that handle it, and `insertContent` accepts an inline fragment. The severity is entirely about persistence — these rows accumulate permanently in a **hard-delete** table (outtakes carry no `deleted_at`), and CLAUDE.md §Data Model explicitly anticipates a future renderer for outtake content. The first such consumer throws `Invalid content for node doc`, and the fix at that point is a data migration over the writer's real DB.
- **Suggested fix:** `toolbarEditor.state.selection.content()` (passes `includeParents = true`, always block-level). Add a unit fixture whose `mockControls.sliceJson` is `[{ type: "text", text: "…" }]` — every current fixture (`OuttakesEditorEntryPoints.test.tsx:376,416,448,479,498,517,546`) uses block nodes, and `e2e/outtakes.spec.ts` only captures via `Control+A`.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases (`claude-opus-5[1m]`)

### [I3] Outtake mutations are bound to an ephemeral component's lifetime — an ordinary in-panel gesture silently aborts a possibly-committed write
- **File:** `packages/client/src/components/OuttakeCard.tsx:57-58, 85-101, 126-136`; `packages/client/src/components/OuttakesPanel.tsx:71, 218-223, 276-281`; with `packages/client/src/hooks/useAbortableAsyncOperation.ts:44-48`
- **Bug:** `useAbortableAsyncOperation`'s unmount cleanup calls `ref.current?.abort()`, and every outtake mutation op is owned by a component that unmounts on an ordinary click. Three verified triggers:
  - **Tab switch / panel close** — `ReferencePanel.tsx:73` renders `{activeTab?.panel ?? null}` and the panel renders only when open, so clicking "Images" or Ctrl+. unmounts `OuttakesPanel` and every card. A label blur→PATCH started in the same gesture (`mousedown` → `focusout` → `mouseup` → `click`, ~30-80 ms) is cancelled; `if (signal.aborted) return` at `OuttakeCard.tsx:100` returns **silently** — no banner, `lastCommittedRef` un-advanced, nothing queued.
  - **The filter box** — `visible` (`OuttakesPanel.tsx:277-281`) filters on `o.label`, the *server row's old label*, which `handleUpdated` only replaces after the PATCH resolves. Typing a needle matching the *new* label unmounts the card mid-PATCH. Clearing the filter re-mounts it showing the old label; the panel has no other refetch trigger.
  - **`createOp`** (`OuttakesPanel.tsx:218`) — Save a blank note then switch tabs: the POST is aborted *and* the `draft` state dies with the component. Unrecoverable text.
- **Impact:** Contradicts the branch's own reasoning, stated twice in these files — `OuttakeCard.tsx:60-66` (S4) and `EditorPage.tsx:986-994` (I4) both argue "aborting a mutation that may have committed is the wrong cancellation semantic" — and `OuttakesPanel.tsx:246-248` states "discarding content the server may never have received is the one failure this panel exists to prevent". Every other editor mutation op lives in a hook mounted for the life of `EditorPage`, so unmount-abort there means "the user left the app"; here it means "the user clicked a tab".
- **Suggested fix:** Hoist the outtake mutation ops to `EditorPage` scope (mirroring `captureOp`), or keep per-row ops for *supersession* only and stop passing the unmount-abort signal to POST/PATCH/DELETE, gating just the post-await `setState`/callback on a mounted ref. Either fix also closes the filter-box trigger.
- **Confidence:** Medium
- **Found by:** Logic & Correctness + Concurrency & State — merged, same defect via different unmount triggers (`claude-opus-5[1m]`)

## Suggestions

- **[S1]** `packages/shared/src/tiptap-safety.ts:73` — `validateTipTapDepth` returns `true` for a non-array nested `content`, so a structurally invalid doc passes the API's only content validator; downstream every consumer degrades differently and silently (`chapterContentToHtml` returns `""`, so the **entire chapter body disappears from HTML/Markdown/plaintext/EPUB exports** with the title still rendering, behind one `logger.warn`). Fix: `if (content !== undefined && !Array.isArray(content)) return false;`. *This is a separate hardening, **not** a substitute for I1 — the walkers' contract is explicitly "no caller has to depth-validate first", and they must stay safe on DB-read content that never passes through Zod.*
- **[S2]** `packages/client/src/components/__tests__/OuttakeCard.test.tsx:126-127` and `OuttakesPanel.test.tsx:394-395, 404-405` — three `expectConsole(...).silent()` assertions install their spy *after* the code under test has already run (`expectConsole.ts:47` calls `vi.spyOn` at call time), so `spy.mock.calls` is necessarily empty and they pass unconditionally. These are the tests encoding "zero warnings in test output" for the new surfaces. Fix: hoist `const warn = expectConsole("warn");` above the action, as `useProjectEditor.test.ts` and `EditorInsertGuards.test.tsx` already do.
- **[S3]** `packages/client/src/pages/EditorPage.tsx:1043-1049` — a successful capture produces no feedback at all when the reference panel is closed (the default, since the toolbar button lives outside the panel). All four refusal arms announce into the live region; the success arm only calls `setCapturedOuttake(row)`, whose sole consumer is unmounted. `STRINGS.outtakes` has no success copy. Fix: `setActionInfo(STRINGS.outtakes.captured)`.
- **[S4]** `packages/client/src/components/OuttakeCard.tsx:151-158` — `handleCopy` swallows every failure and has no success signal to contrast with. Off a secure context `navigator.clipboard` is `undefined`, so the property access throws inside the same `try` — and CLAUDE.md's deployment target is plain HTTP on port 3456, where the Copy button is dead and silent. User pastes stale clipboard content into the manuscript. Fix: `onError(S.copyFailed)` plus a success announcement.
- **[S5]** `packages/client/src/components/OuttakeCard.tsx:50, 77-83` — `lastCommittedRef` is seeded once at mount and never re-synced; cards are keyed by id so a row replacement does not remount. After a 2xx `BAD_JSON` rename, putting the label back to its original value hits the `lastCommittedRef.current === next` short-circuit: no PATCH, no banner, no retry path. Fix: compare against `outtake.label` for the "nothing to send" check.
- **[S6]** `packages/client/src/components/OuttakesPanel.tsx:352-354` — asserts "No outtakes yet" for the full duration of every load (no `loading` flag; the clear effect empties the list before the new load starts). A writer with fifty outtakes is told there are none and invited to stash again. Fix: track `loading` alongside the already-counted `loadsInFlightRef`.
- **[S7]** `packages/server/src/outtakes/outtakes.repository.ts:24-36` — corrupt outtake content degrades to an indistinguishable empty doc on a **hard-delete** table; the writer sees an apparently empty outtake, deletes it, and destroys the only copy of still-recoverable JSON with no trash and no 30-day window. The recorded rationale addresses the rendering failure mode, not the irreversible-delete one. Fix: an optional `content_corrupt?: true` on `OuttakeRow`, as chapters already do.
- **[S8]** `packages/client/src/errors/scopes.ts:500-506` — the `outtake.update` scope maps *every* 400 to label-length copy on the premise "the label cap is the only 400 this endpoint emits", but `validateUuidParam` (`outtakes.routes.ts:55`) throws 400 before the schema runs and `UpdateOuttakeSchema.strict()` is a second producer. The consumer *reverts the visible label field*, so a non-cap 400 makes the writer's typed label vanish under wrong copy. Fix: give the cap failure its own `AppError` code and route via `byCode`.
- **[S9]** `packages/client/src/strings.ts:144-145` — `keep it under ${max} characters` states an exclusive bound for Zod's **inclusive** `.max(LABEL_MAX_UNITS)`, and "characters" names a different unit than the cap measures (UTF-16 code units — a distinction a prior grapheme-vs-unit mix-up already burned). Fix: `keep it to ${max} characters or fewer`.
- **[S10]** `packages/server/src/export/docx.renderer.ts:200` — the new DOCX depth bail undercounts by one level per list nesting (`listItemsToParagraphs` skips the `listItem` level, unlike the blockquote arm at `:302`), so the guard fires at true depth ~130 instead of 64. Not exploitable today; a correctness defect in a defence-in-depth guard. The test enrollment uses a blockquote chain, exercising only the correct arm. Fix: `depth: childDepth(ctx) + 1` for blocks inside a list item, plus a list-nested `__depthContractSeam` case.
- **[S11]** `e2e/outtakes.spec.ts:110` — the aXe scan is the last statement, *after* the outtake is deleted, so it runs against an emptied panel. The card's label input, its Insert/Copy/Delete buttons, the Show more/less toggle and the `ConfirmDialog` are never in the DOM when it runs. This is the only mechanical a11y enforcement the phase ships, and design §10 / plan Task H1 both promise a panel pass. Fix: move the scan before the delete, or add a second one.
- **[S12]** `packages/client/src/components/ReferencePanel.tsx:50-70` — the tablist becomes multi-tab for the first time on this branch and has no roving `tabIndex` and no Left/Right/Home/End handler, so the WAI-ARIA tabs pattern the markup opts into is incomplete. aXe has no rule for this, so S11's scan could not catch it even once fixed. Every tab is still reachable with plain Tab. Worth closing before 4c.3 adds a Tags tab.
- **[S13]** `packages/client/src/components/OuttakeCard.tsx:187-195` — the Show more / Show less disclosure has no `aria-expanded` and no `aria-controls`; a screen-reader user hears "Show more, button" with no state and no target, on the panel's main content-reading affordance.
- **[S14]** `packages/client/src/components/OuttakeCard.tsx:127` — the delete re-entrancy latch refuses silently. `onConfirm` closes the dialog but the card stays rendered until `onDeleted`, so a second Delete → Confirm during the in-flight DELETE is an ordinary gesture that produces no effect and no message. The `captureInFlightRef` twin the comment cites *does* announce `mutationBusy`; this is the half firing on a destructive confirmation.
- **[S15]** `CLAUDE.md:356` — F-1 states `EditorPage.tsx` is `~1094 lines`; it is **1,313** at HEAD and was 1,103 at the merge-base, so this branch's ~210 added lines moved it 20% out of date. Not a re-flag of F-1: the trade-off's real premise (irreducible cross-hook coordination plus the `editorEntryPointSurface.test.ts` net) was honoured — the surface snapshot was updated with a per-entry guard-axis rationale. Only the parenthetical figure is wrong.

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

#### [OOSI1] `handleUpdateProjectTitle`'s possibly-committed recovery arm keeps the weak id-only guard and permanently rewinds `projectSlugRef` — backlog id: `dc808129`
- **File:** `packages/client/src/hooks/useChapterMetadata.ts:143-146`
- **Bug:** The recovery branch guards only `if (projectRef.current?.id === projectId)` before `setProject(refreshed)` **and** `projectSlugRef.current = refreshed.slug`. Interleaving: rename project A → 2xx `BAD_JSON` → recovery `api.projects.get("alpha")` in flight → user navigates to B, so `useProjectEditor.ts:119-131` advances `projectSlugRef.current = "beta"` and consumes the `prevSlugArgRef` sentinel; `loadProject(B)` has not resolved so `projectRef.current` is still A → the recovery GET resolves, the id-only check **passes**, and the ref is rewound to `"alpha"`.
- **Impact:** The sentinel fires exactly once per slug transition, so the render-time sync will **never** re-advance it — `projectSlugRef` says `alpha` for the rest of the session while the user edits `beta`. `makeStaleProjectGuard` cannot catch the aftermath (check 1 compares ids, both B; check 2 evaluates `"alpha" !== "alpha"` → false). `handleCreateChapter` then POSTs a chapter into project A and `handleReorderChapters` reorders A's chapters — silent, session-permanent cross-project writes. This is the only surviving weak guard copy that *writes back* to `projectSlugRef`, and `isStaleProject` is already constructed 56 lines above at `:87`. Likelihood is low (needs a 2xx `BAD_JSON` on a rename plus navigation inside the recovery window), which is why it is not Critical. **Severity raised from the existing backlog entry's Suggestion** on the newly traced permanence.
- **Suggested fix:** `if (isStaleProject()) return undefined;` before the merge, or gate the whole block on `!isStaleProject()`. At minimum, never write `projectSlugRef.current` from a response fetched under a slug that is no longer the URL's.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`claude-opus-5[1m]`)
- **Backlog status:** re-seen (first logged 2026-05-26)
- **Scope note:** anchor line untouched. The branch converted three guards in this file to `makeStaleProjectGuard` and added the `projectRef` lock-step advance at `:114-116`, but that advance runs only on the **success** path — the recovery arm is in the `catch`, so there is no interaction. The specialist's framing ("the tenth copy the extraction missed") is a completeness observation about the refactor, not a causal one.

### Out-of-Scope Suggestions

- **[OOSS1]** `packages/shared/src/tiptap-notes.ts:85` — backlog id: `665350d0` (**new**). `stripNoteMarks` has the same non-array-`content` fail-open as I1 (`if (Array.isArray(node.content))` with no `else`, so `{ ...node }` at `:79` copies the container through). Verified: `UpdateChapterSchema` accepts the shape and the note mark survives the strip. It does **not** leak today — `renderEditorHtml` throws `RangeError` (caught by `chapterContentToHtml`, chapter body renders as `""`) and DOCX's `inlineToRuns` throws `TypeError`. So confidentiality on the walker CLAUDE.md singles out as "the one whose failing open is a confidentiality leak" currently rests transitively on two unrelated libraries' throw behaviour — exactly the argument this branch used to justify adding the DOCX depth bail. Out-of-scope because outtakes deliberately *preserve* note marks and no outtake surface renders HTML, so the branch adds no new consumer. Fixing it in the same edit as I1 is cheap and sensible, but that is the user's scope call, not a classification.

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These 4 additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] Two new server invariant-parity test files no cluster of the recorded one-feature-rule exception enumerates
- **File:** `packages/server/src/__tests__/wire-type-parity.test.ts:1-63` and `packages/server/src/__tests__/schema-parity.test.ts:19-49`
- **Addition:** Commit `f3b88834` added 174 lines across two new server test files. `wire-type-parity.test.ts` adds compile-time `expectTypeOf` assertions that `ChapterWithLabel`/`ChapterRow`/`DeletedChapterRow`/`ProjectRow` still satisfy the shared wire types; `schema-parity.test.ts:19-49` asserts the `ChapterStatus` Zod enum and migration 003's seeded `chapter_statuses` rows hold the same set. Neither concerns outtakes, and neither appears in the ten clusters granted by the decision log — whose own text limits its precedent ("NOT precedent for … discovering an exception after the fact as a matter of routine"). **Nuance:** the *other* half of `schema-parity.test.ts` (`:51-111`, S10 project-child purge coverage) is feature-motivated — migration 015 adds a third `project_id`-bearing child table with no purge assertion — so that half is arguably in-scope 4c.2 safety work. Both files are test-only and defensible on their merits (the S9 gap is real: `chapters.status` has neither a CHECK constraint nor an FK to `chapter_statuses`).
- **Suggested intent source:** `docs/plans/2026-07-19-scratchpad-outtakes-design.md`, `docs/plans/2026-07-19-scratchpad-outtakes-plan.md`, `docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md` §One-Feature-Rule Exception
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-5[1m]`)

### [OOSA2] The pre-existing `ResizeSeparator` drag-lifecycle defect (`c9fce6ab`) was fixed here, which the recorded exception explicitly excluded
- **File:** `packages/client/src/components/ResizeSeparator.tsx:89, 96-101`, plus the drag tests in `__tests__/ResizeSeparator.test.tsx`, `__tests__/Sidebar.test.tsx` and `__tests__/ReferencePanel.test.tsx` rewritten to pass `buttons: 1` (commit `0e3ffc95`)
- **Addition:** Two behaviour changes to pointer resizing in both the Sidebar and the ReferencePanel — a drag self-terminates when no button is held, and a second mousedown reclaims the previous drag's document listeners. This fixes backlog entry `c9fce6ab`, removed from `paad/code-reviews/backlog.md` in the same commit. OOSA1 of the decision log covers the `ResizeSeparator` *extraction*, and its source report states in terms that the extraction gives `c9fce6ab` a single owner **without fixing it**. The fix landed afterwards, is unrelated to outtakes, and is named in neither the decision log nor its cluster list.
- **Suggested intent source:** decision log §One-Feature-Rule Exception (cluster OOSA1) and the round-5 report it cites
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-5[1m]`)

### [OOSA3] Snapshot *view* corruption gate tightened to `TipTapDocSchema`
- **File:** `packages/client/src/hooks/useSnapshotState.ts:324`, plus three new `it.each` cases at `__tests__/useSnapshotState.test.ts:313-330`
- **Addition:** A client-observable behaviour change to an unrelated feature: snapshot rows that previously opened in the read-only viewer (`{"type":"paragraph"}`, `{"foo":1}`, docs nested past `MAX_TIPTAP_DEPTH`) now report "this snapshot is corrupt". The stated goal (make view agree with restore) is sound, but it is Phase 4b snapshot work. **Attribution problem worth attention:** decision-log cluster OOSA2 ("`makeStaleProjectGuard` extraction and strength upgrade at nine sites") lists `useSnapshotState.ts` in its file list, but that file does not import `makeStaleProjectGuard` at HEAD — the filename appears attributed to the wrong cluster, so the change approved for this file is not the change that shipped in it.
- **Suggested intent source:** decision log §One-Feature-Rule Exception (cluster OOSA2)
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-5[1m]`)

### [OOSA4] Lock-refusal copy changed for snapshot restore and both find-replace paths
- **File:** `packages/client/src/hooks/useSnapshotController.ts:128`; `packages/client/src/hooks/useFindReplaceController.ts:220, 487`
- **Addition:** All three changed from `STRINGS.editor.mutationBusy` to `STRINGS.editor.lockedRefusal` — a user-visible copy change to three pre-existing editor-mutation entry points under the persistent editor lock. Defensible on its merits (the old copy told the user to wait for an operation that does not exist and never ends), but it is Phase 4b snapshot/find-replace UX, reached from this branch only because `guardInsertAtCursor` needed the same string for the new outtake insert path. Named by none of the ten clusters: OOSA10's client file list names `errors/scopes.ts`, `strings.ts:103`, `EditorPage.tsx`, `PreviewMode.tsx` and `useProjectEditor.ts`, not these two controllers, and OOSA2's mention of `useFindReplaceController.ts` is again the stale-project-guard cluster that file does not participate in at HEAD.
- **Suggested intent source:** decision log §One-Feature-Rule Exception (clusters OOSA2, OOSA10)
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-5[1m]`)

## Review Metadata

- **Agents dispatched:** 12 specialists in parallel, each lens split across a server+shared partition (A) and a client+e2e partition (B) per the large-diff scaling rule — Logic & Correctness (A/B), Error Handling & Edge Cases (A/B), Contract & Integration (A/B), Concurrency & State (A/B), Security (A/B), Spec Compliance (A/B) — plus one Verifier. All 12 emitted valid `[ref-loaded:*]` tokens.
- **Scope:** 146 changed files (71 source, 60 test, 15 docs/reports) plus adjacent callers/callees one level deep. Specialists additionally read the unchanged hooks the new code depends on (`useAbortableSequence`, `useAbortableAsyncOperation`, `useEditorMutation`, `useEditorMutationMachine`, `useContentCache`, `usePersistedState`) and the prosemirror/knex/body-parser internals several claims turn on.
- **Raw findings:** 22 (before verification)
- **Verified findings:** 21 (after verification)
- **Filtered out:** 1
- **Out-of-scope findings:** 2 (Critical: 0, Important: 1, Suggestion: 1)
- **Out-of-scope additions:** 4
- **Backlog:** 1 new entry added, 1 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md`
- **Intent sources consulted:** `docs/plans/2026-07-19-scratchpad-outtakes-design.md`, `docs/plans/2026-07-19-scratchpad-outtakes-plan.md`, `docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md`, `docs/roadmap.md` §4c.2, 90 branch commit messages, branch name
- **Verifier warnings:** none

### Dropped finding (recorded for transparency)

- **Concurrency & State A** — `insertAutoSnapshotIfChanged`'s `SnapshotsStore` parameter is structurally satisfiable by the root store, so a future in-transaction caller could self-deadlock for 60s on knex's `{max:1}` pool. **Dropped:** the exact hazard, mechanism and consequence are already spelled out verbatim at `packages/server/src/snapshots/auto-snapshot.ts:27-34` as the S9 note from round 5, ending "The parameter is named `txStore` because it MUST be one". Both call sites pass `txStore`; `applyImageRefDiff(txStore, …)` uses the identical structurally-typed-slice pattern, making it house style; and doc-comment-as-mitigation is the codebase's recorded position for this class (CLAUDE.md §Accepted Architectural Trade-offs F-19). The proposed nominal-marker type is a hardening preference with no live defect behind it.

### Backlog dedup reasoning

- **`dc808129` matched OOSI1** on Symbol (`handleUpdateProjectTitle`) + Bug class (Concurrency) + the identical code pair (`setProject(refreshed)` immediately followed by `projectSlugRef.current = refreshed.slug` in the possibly-committed recovery arm); the existing entry's own text already names the compounding slugRef write. Its `File (at first sighting)` is `packages/client/src/hooks/useProjectEditor.ts:1254` — that hook has since been split and the code now lives in `useChapterMetadata.ts`. Matched semantically rather than minting a duplicate. OOSI1 adds a new mechanism (the pre-load-window id-only guard and the `prevSlugArgRef` permanence) to the already-recorded React-scheduling one.
- **`b7e3f9a1` deliberately not touched.** It describes the *duplication* of the drift-guard closure across three sites in `useProjectEditor.ts` — which this branch's new `packages/client/src/hooks/staleProjectGuard.ts` is the extraction for, adopted at nine call sites. Backlog lifecycle is explicit-removal only, so no resolve directive and no `last_seen` update was emitted (no finding in this review matches it; OOSI1 matches `dc808129`, a different bug at a different symbol). **Flagged for the user:** `b7e3f9a1` now looks largely addressed and is a candidate for manual removal after confirming the three original sites are covered.
- The other 16 entries in the pre-filtered slice matched no finding in this review.
