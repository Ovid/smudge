# Agentic Code Review: scratchpad-outtakes

**Date:** 2026-08-04 11:44:09
**Branch:** scratchpad-outtakes -> main
**Commit:** 8d0b5f74570ab2b8503ed9aa317f1b58371cb1a2
**Files changed:** 151 | **Lines changed:** +12333 / -938
**Diff size category:** Large

## Executive Summary

Phase 4c.2 (scratchpad outtakes) is in strong shape after six prior review rounds: both Security specialists returned zero findings against fully-walked trust boundaries, the Contract specialist confirmed migration/facade/wire parity end-to-end with a passing typecheck and test run, and Spec Compliance found every promised artifact present with no retro-edited spec. No Critical issues. The highest-severity finding is a rendering regression introduced by the branch-tip commit `8d0b5f74`: the `ImageGallery` loading gate was hoisted one level too high in its ternary chain, so the entire thumbnail grid blanks on every post-mutation refresh — confirmed by parse and by an independent render probe, and diverging from the two sibling panels that received the same fix correctly. Two further Important findings concern silent write-path failures in the new outtakes surface (a rename dropped without notice, and a create-failure banner that can land on the wrong project). Confidence in this review is high: three of the eleven findings were independently corroborated by three or four specialists each.

## Critical Issues

None found.

## Important Issues

### [I1] The S6 loading gate blanks the whole thumbnail grid on every refresh, not just the empty state
- **File:** `packages/client/src/components/ImageGallery.tsx:440`
- **Bug:** The `loading` flag was placed on the outer arm of the ternary chain: `loadError ? (…) : loading ? null : images.length === 0 ? (…) : (<ul>…)`. That associates as `loading ? null : (images.length === 0 ? empty : list)`, so the `<ul>` branch is unreachable while `loading` is true — regardless of what `images` still holds. `loading` is `settledLoadKey !== loadKey`, and `loadKey` includes `refreshKey`, so any `incrementRefreshKey()` flips it true in the same render, before the effect runs. `setImages` is only called on success, so the previous rows survive in state and are simply not rendered.
- **Impact:** Every image mutation blanks the gallery. Delete an image → `setSelectedImage(null)` returns the user to the grid → `incrementRefreshKey()` → every remaining thumbnail disappears and reappears when the GET settles. Same for upload success (line 211), possibly-committed upload (224), metadata save (261/276), insert-save (297/309), delete (330/349), the retry button (434), and `EditorPage`'s `galleryExternalRefreshKey` bump. Before this branch the stale-but-correct list stayed on screen. Both siblings that received the same S6 fix on this branch get it right — `OuttakesPanel.tsx:369` and `SnapshotPanel.tsx:474` gate only the empty message and render the list independently. `ImageGallery` is the outlier, and the new test (`ImageGallery.test.tsx:91-113`) only exercises the initial load, where `images` is empty anyway, so it cannot catch this.
- **Suggested fix:** Mirror the siblings — gate only the empty-state arm:
  ```tsx
  ) : images.length === 0 ? (
    loading ? null : <p …>{S.noImages}</p>
  ) : ( <ul …> )
  ```
  Add a test that lets an initial load settle, then bumps the refresh key against a never-settling list call, and asserts `screen.queryByRole("list")` is still present.
- **Confidence:** High
- **Found by:** Logic & Correctness (`claude-opus-5[1m]`), Contract & Integration (`claude-opus-5[1m]`), Concurrency & State (`Opus 5 (1M context)`)

### [I2] The rename re-entrancy latch drops a second edit silently, leaving the field asserting a label the server never received
- **File:** `packages/client/src/components/OuttakeCard.tsx:104`
- **Bug:** `commitLabel` refuses re-entry with a bare `if (updateInFlightRef.current) return;`. Both early exits assume `lastCommitted` (the `outtake.label` **prop**) is the value the server will hold, but during an in-flight PATCH that is false — the prop only advances when `onUpdated(row)` propagates back. Two reachable arms:
  - **(a) Silent drop.** Blur → PATCH("X") in flight. Refocus, type "Y", blur. Line 96's short-circuit compares against `lastCommitted`, so it does not fire; line 104 does, with no PATCH and no banner. PATCH("X") resolves; the re-seed at line 116 is gated on `current === attempted` (`"Y" !== "X"`), so the field keeps "Y" while the server holds "X".
  - **(b) False short-circuit.** Same in-flight PATCH("X"); the user types back to the original "A". `next === lastCommitted` → short-circuit, `setLabelDraft("A")`, return. The server ends at "X", the field shows "A", nothing is queued to reconcile.
- **Impact:** Both arms end in a visible label that was never persisted, with no banner and no retry path. Recovery requires the user to happen to focus and blur the field a third time; if they instead switch to the Images tab or type in the filter box, the card unmounts and the edit is gone. A write path failing silently is precisely what the panel's own comments say it exists to prevent. The S5 comment's premise — that reading the prop directly deletes the divergence — holds for settled state but not across an in-flight PATCH, so this defeats the recorded rationale rather than restating it. The sibling latch in the same file (`handleDelete`, 148-151) explicitly announces its refusal under an S14 note, and `EditorPage`'s `captureInFlightRef` announces `STRINGS.editor.mutationBusy`. Only `commitLabel` returns bare. No test drives two overlapping blurs.
- **Suggested fix:** At minimum announce the refusal (`onError(S.renameInFlight)` with a new string, mirroring `deleteInFlight`). Better, coalesce: stash the pending value in a ref and re-invoke `commitLabel()` from the `finally` when `normalizeLabel(labelDraftRef.current) !== outtake.label` — that closes the divergence rather than just naming it, and also fixes arm (b) by comparing against `pendingLabelRef.current ?? lastCommitted`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (`claude-opus-5[1m]`), Error Handling (`claude-opus-5[1m]`), Contract & Integration (`claude-opus-5[1m]`), Concurrency & State (`Opus 5 (1M context)`)

### [I3] The create-failure arm has no project-drift guard, so project A's banner lands on project B
- **File:** `packages/client/src/components/OuttakesPanel.tsx:259`
- **Bug:** `handleCreate`'s success arm handles a mid-POST project switch deliberately and well (`applyServerRow` returns `false` → `setCommittedNotice(S.createdElsewhere)`, lines 247-250). The catch arm has no equivalent check — `onMessage: setError` writes unconditionally.
- **Impact:** The user saves a blank note in project A (the POST deliberately carries no AbortSignal, documented at 77-85, so it survives everything), then navigates to project B. `OuttakesPanel` does not unmount — only `projectId` changes — so the clearing effect at 113-117 runs and the load effect fetches B's list. The A-scoped POST then rejects and `setError` paints onto B's panel *after* the clear, so nothing removes it for the rest of the session on that project. `draft`/`showNew` are intentionally retained, so the writer is looking at A's text, in B's panel, under an unattributed failure banner — and clicking Save retries into **project B**, because `api.outtakes.create(projectId, …)` reads the live prop. That files A's prose under B. This is the exact wrong-project class `makeStaleProjectGuard` was extracted for on this branch (nine sites plus a tenth in `EditorPage`'s capture at `EditorPage.tsx:1046`, whose rationale names this scenario verbatim); the panel-owned create is the one write path that did not get the treatment, and its own success arm proves the switch was in view.
- **Suggested fix:** The panel already has the authority it needs — capture `const startedForProject = projectId;` at handler entry and gate the catch arm on `startedForProject === projectIdRef.current`, or reuse the `createdElsewhere` framing so the message names the project the text belongs to.
- **Confidence:** Medium
- **Found by:** Concurrency & State (`Opus 5 (1M context)`)

## Suggestions

- **[S1]** `packages/client/src/pages/EditorPage.tsx:564` — Insert on a `content_corrupt` outtake is a silent no-op, and `STRINGS.outtakes.insertFailedCorrupt` can never fire for the case it names. The server's `parseRow` substitutes a *valid* `{ type: "doc", content: [] }` placeholder, which satisfies `TipTapDocSchema`, so the corrupt arm at 555 is skipped and `blocks.length === 0` returns bare. The comment justifying the silence ("which the visibly empty card already says") is false for this row — `OuttakeCard.tsx:222` renders a `role="alert"` corruption notice, not an empty preview. Fix: test `outtake.content_corrupt` before the emptiness short-circuit, or disable Insert on a corrupt card. *(Found by Logic & Correctness, Error Handling, Contract & Integration — Medium)*
- **[S2]** `packages/client/src/components/OuttakeCard.tsx:172-188` — Copy on a `content_corrupt` outtake wipes the clipboard and announces success. `plainText` is `""` for the placeholder doc, `navigator.clipboard.writeText("")` succeeds, `setCopied(true)` fires, and the `role="status"` "Copied" announcement renders — destroying whatever the writer had, on the one card that simultaneously tells them the text couldn't be read and invites them to copy it out by hand. Fix: `if (!plainText) { onError(S.copyFailed); return; }`, or disable Copy/Insert on a corrupt card. *(Found by Error Handling — Medium)*
- **[S3]** `packages/server/src/outtakes/outtakes.repository.ts:74-84` + `outtakes.routes.ts:62-72` — the outtakes list has no projection, no limit, and no per-project cap: `select *` including full `content`, `parseRow`-mapped, whole array serialized. Every sibling splits UI-list from content-list (`snapshots.repository.listByChapter` projects `content` away; `chapters.repository` has both `listMetadataByProject` and `listByProject`). The practical concern is not the remote V8 max-string `RangeError` but that the drawer which fails to load is also the only UI carrying each row's delete button — the "unloadable ⇒ undeletable" shape this branch already closed for the per-row variant (S9). Fix: mirror the snapshot precedent with a metadata+preview projection, or bound the query and record the decision in the route docblock. *(Found by Error Handling — Medium)*
- **[S4]** `packages/shared/src/schemas.ts:54` — the depth-refine message now misdescribes two non-depth rejections this branch added. `validateTipTapDepth` gained `if (Array.isArray(node)) return false` (`tiptap-safety.ts:70`) and `if (!Array.isArray(content)) return false` (`:81`), but the refine still reads "TipTap document exceeds maximum nesting depth (64)." That message reaches the client verbatim, so a shape violation is reported as a depth violation the writer cannot act on by un-nesting. In-scope by reasoning promotion — the anchor is untouched, but the branch's edit is what made the message wrong. `outtakes.routes.test.ts:64` asserts only status and code, so nothing pins it. *(Found by Logic & Correctness — Medium)*
- **[S5]** `packages/client/src/errors/scopes.ts:487-531` + `OuttakeCard.tsx:156-166` — a 404 on outtake delete/update leaves a permanently stuck card. Neither scope declares `byStatus: { 404 }`, so a DELETE 404 (row already gone) shows "Failed to delete outtake" and the card stays; every retry 404s again. The `onCommitted` arm three lines above explicitly refetches "so a retry can't 404 against a phantom card" — the failure mode was in view and handled only on the ambiguous path. Recovery requires closing and reopening the reference panel. `snapshot.delete` behaves identically, so this is a new instance of an inherited convention. Fix: treat a 404 on delete as success (`onDeleted`); on update, refetch rather than reverting to a label that no longer exists. *(Found by Error Handling — Medium)*
- **[S6]** `packages/server/src/__tests__/outtakes.migration.test.ts:26` — `await t.db.migrate.down()` is not pinned to migration 015. The day 016 lands, `down()` rolls back 016, `hasTable("outtakes")` is still true, and the test goes red against an unrelated change — while silently ceasing to cover 015's `down()`, the exact thing its own S19 comment says it exists for. Fix: `migrate.down({ name: "015_create_outtakes.js" })`, or assert the precondition first so the failure names its real cause. *(Found by Concurrency & State — Medium)*
- **[S7]** `packages/shared/src/types.ts:105` — the `content_corrupt` degraded-read contract is recorded in neither design §5 nor CLAUDE.md §Data Model. `grep content_corrupt` over the design returns nothing, and the CLAUDE.md `outtakes` bullet describes `content` as stringified TipTap JSON with no degraded-read clause. Every other superseded design claim on this branch got an explicit callout (§5 S12/S13, §6 S4/S8, §12 exception, plan D2/F2 S13); this one did not. Matters because design §2/§5 make re-reading the design a hard precondition for Phase 4c.2a, the destructive cut, at which point the outtake becomes the sole copy of the text. Fix: add a callout to design §5 and one clause to the CLAUDE.md bullet. *(Found by Spec Compliance — Medium)*
- **[S8]** `packages/server/src/outtakes/outtakes.repository.ts:81` — `listByProject` tie-breaks on `id DESC`, and `id` is `randomUUID()` (v4), which carries no ordering information. Two outtakes whose ms-resolution `created_at` collides list in UUID order — as likely oldest-first as newest-first — while the endpoint's contract (asserted by `outtakes.routes.test.ts`, relied on by the panel) is newest first. The comment claims only determinism, which is true as far as it goes; deterministic-but-arbitrary is harder to notice than nondeterministic. Near-unreachable in practice (two gesture-driven creates within one millisecond). Fix: `rowid DESC`. *(Found by Contract & Integration — Medium)*

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

- **[OOSS1]** `packages/server/src/export/image-resolver.ts:130` — the S6 id-case normalization is only half applied — backlog id: `e730ae37`. `uniqueIds` keeps each id in the casing it was matched with, and `resolve(id)` → `findImageById(id)` → `where({ id })` is case-sensitive under SQLite BINARY collation; only the map keys and the emitted `data-image-id` were lowercased (142-143, 160). An uppercase-only reference resolves to `null`, falls through the rewrite, and is deleted outright by the unresolved-image catch-all at 183 — the image vanishes from HTML/Markdown/plaintext/EPUB export with no warning, while `IMAGE_SRC_REGEX` and `ALLOWED_IMAGE_SRC` (both `i`-flagged) accept it. **Out-of-scope ruling:** line 130 is outside the branch's touched set for the file, and the `resolve(id)` path is byte-identical to `main` — the branch normalized the *map keys*, which did not exist as a normalization before, so it neither introduced nor widened this arm. Very low reachability: no shipped path mints mixed-case UUIDs. **Confidence:** Medium. **Found by:** Contract & Integration (`claude-opus-5[1m]`). **Backlog status:** new.
- **[OOSS2]** `packages/server/src/search/search.service.ts:141` and `:252` — the "valid JSON, wrong shape" guard was not extended to the two find-and-replace parse sites — backlog id: `0364ab66`. Both keep a bare `try/catch` around `JSON.parse(chapter.content)` while three sibling parse sites gained an `isTipTapNode` gate this branch. A column holding `"null"` / `"42"` / `"[]"` / `'"text"'` parses without throwing, the walkers return zero matches, and the loop `continue`s without pushing to `skippedIds` — so `skipped_chapter_ids` omits a chapter that was never examined, telling the writer the project was fully searched/replaced. **Out-of-scope ruling:** lines 141 and 252 are outside the branch's touched set, and the search path's behavior for such a row is byte-identical to `main`. The branch created a visible *inconsistency* (the same row now 500s `CORRUPT_CONTENT` on `GET /api/chapters/:id`) but did not change what find-and-replace does. **Confidence:** Medium. **Found by:** Logic & Correctness (`Claude Opus 5 (1M context)`). **Backlog status:** new.

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These M additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] The loading-gate behaviour change shipped into two panels unrelated to outtakes, after the exception list was amended
- **File:** `packages/client/src/components/ImageGallery.tsx:109` (and `packages/client/src/components/SnapshotPanel.tsx:103, 149, 157, 163, 474`)
- **Addition:** Commit `8d0b5f74` (branch tip, "the image and snapshot panels stop claiming empty while loading (S6)") adds a loading flag to `ImageGallery` and `SnapshotPanel` so their empty states no longer render during a load. Neither component has anything to do with the Outtakes drawer. Commit ordering verified: `8d0b5f74` lands **after** `fe342da6` ("record the four clusters the exception list did not name"), which fixed the decision log at fourteen clusters. Neither file appears in OOSA1-OOSA14. The branch's own earlier commit `d25a8dc4` names them as out of scope verbatim — "both are unrelated pre-existing surfaces on a branch already carrying flagged out-of-scope additions, so widening it is his call, not mine" — and the widening landed anyway. **Note the interaction with [I1]:** this addition is also where that defect lives, so recording it and fixing it are the same conversation.
- **Suggested intent source:** `docs/plans/2026-07-19-scratchpad-outtakes-design.md` + `docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md` (the recorded one-feature-rule exception list), per CLAUDE.md §Pull Request Scope
- **Confidence:** High
- **Found by:** Spec Compliance (`Opus 5 (1M context)`)

### [OOSA2] The project-rename recovery guard (round-6 `OOSI1`) was fixed on-branch and is not in the exception list
- **File:** `packages/client/src/hooks/useChapterMetadata.ts:159`
- **Addition:** Commit `4cecc06d` converts `handleUpdateProjectTitle`'s possibly-committed recovery arm from the id-only check to `isStaleProject()`. Round 6 classified this as Out-of-Scope Important `[OOSI1]` (backlog `dc808129`). It is a runtime behaviour change on project-rename recovery, a path with no relationship to outtakes. Verified against the decision log at HEAD: cluster OOSA2 still reads "extraction and strength upgrade at **nine** sites", and the round-6 "Attribution corrections" section corrects two *file* attributions (`useSnapshotState.ts` → OOSA13, `useFindReplaceController.ts` → OOSA14) without adding this tenth guarded arm — the one the round-6 report singles out as the only surviving copy that writes back to `projectSlugRef`. Its cluster description is now factually wrong about its own scope.
- **Suggested intent source:** `docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md` cluster OOSA2, per CLAUDE.md §Pull Request Scope
- **Confidence:** Medium
- **Found by:** Spec Compliance (`Opus 5 (1M context)`)

## Review Metadata

- **Agents dispatched:** 11 specialists in parallel, partitioned server/shared vs. client/e2e for the five bug-hunting lenses — Logic & Correctness (A: `packages/server`+`packages/shared`, B: `packages/client`+`e2e`); Error Handling & Edge Cases (A, B); Contract & Integration (A, B); Concurrency & State (A, B); Security (A, B); plus Spec Compliance (whole diff, unpartitioned). Followed by one Verifier.
- **Scope:** 151 changed files (68 production source files, +3004/-428) plus callers/callees traced one level deep and adjacent test files. `.devcontainer/` excluded per CLAUDE.md.
- **Raw findings:** 23 (before verification)
- **Verified findings:** 15 (after verification)
- **Filtered out:** 8 (7 cross-specialist duplicate merges — `ImageGallery.tsx:440` found 3×, `OuttakeCard.tsx:104` found 4×, `EditorPage.tsx:564` found 3× — and 1 dropped: the `chapters.routes.ts` 400-vs-404 status change, which anchors on touched lines but does not survive verification as a defect; it is recorded as decision-log cluster OOSA5, deliberate, correct on the merits, and has no reachable failing consumer)
- **Out-of-scope findings:** 2 (Critical: 0, Important: 0, Suggestion: 2)
- **Out-of-scope additions:** 2
- **Backlog:** 2 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md`
- **Intent sources consulted:** `docs/plans/2026-07-19-scratchpad-outtakes-design.md`, `docs/plans/2026-07-19-scratchpad-outtakes-plan.md`, `docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md`, `docs/roadmap.md` §4c.2, 114 commit messages, branch name, `CLAUDE.md`
- **Verifier warnings:** none

### Adjudicated disagreement

Three specialists flagged `ImageGallery.tsx:440`; the Error Handling (client) specialist listed the same `loading` flag as checked and clean. The Verifier adjudicated by parsing the ternary chain at HEAD rather than deferring to the majority, and confirmed the three finders are right: `loadError ? A : (loading ? null : (images.length === 0 ? B : C))` makes arm C — the `<ul>` — unreachable while `loading` is true. This is independently consistent with the Contract specialist's throwaway render probe, which found `screen.queryByRole("list")` returned `null` after a refresh-key bump against a never-settling list call.

### Notable clean results

- **Security (both partitions): 0 findings**, and neither was a no-boundary bail — thirteen trust boundaries were enumerated and walked. Specifically verified: the caption-interpolation fix is complete (all three user-text `String.replace` sites use function replacers, grep-confirmed exhaustive); no path traversal is reachable; the cross-project image leak (I1) is closed at the right seam; the note-mark confidentiality guarantee holds with no new bare `generateHTML` site; all eleven TipTap walkers bail at `MAX_TIPTAP_DEPTH` and the array-node bypass is genuinely closed; prototype pollution is unreachable; `sanitizer.ts`'s change is comment-only with the allowlist byte-identical at HEAD.
- **Contract & Integration (server):** migration 015 matches design §4 exactly, `PRAGMA foreign_keys = ON` makes the cascade actually fire, all 5 `OuttakesStore` facade methods delegate 1:1 with no gaps, and all four parity tests were confirmed genuinely discriminating rather than vacuous.
- **Spec Compliance:** every artifact the design and plan name is present and matches, including all four §9 exclusion tests and the §10 route matrix. The retro-edit check came back clean — every implementation-era edit to the design/plan is an explicitly marked "superseded" callout that preserves the original text and names the review item that caused it.
