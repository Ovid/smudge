# Agentic Code Review: scratchpad-outtakes

**Date:** 2026-07-19 18:42:33
**Branch:** scratchpad-outtakes -> main
**Commit:** e112db4c92750ab7580d6e72119840c5c86231aa
**Files changed:** 45 | **Lines changed:** +4366 / -13
**Diff size category:** Large

## Executive Summary

The outtakes feature (roadmap phase 4c.2 — a per-project scratchpad of cut/stashed TipTap JSON with capture-from-selection and insert-at-cursor) is well-built: the server layer, wire contract, route mounting, status codes, input validation, image-strip confidentiality path, and XSS surface all verified clean and consistent with their snapshot-feature siblings. No Critical issues. The highest-severity finding (F1) is a deterministic 400 on capture when a chapter title is ~496+ characters, because the machine-derived label overshoots the 500-char cap. The other three Important findings all stem from one theme: `OuttakesPanel` maintains an optimistic list with no id-based reconciliation or epoch sequencing, so concurrent capture-reloads and same-type mutations can resurrect, duplicate, or fail to persist rows silently. Overall confidence is high — the verifier confirmed every reported finding against current code and rejected one.

## Critical Issues

None found.

## Important Issues

### [I1] Auto-generated capture label can exceed the 500-char cap → capture fails with 400
- **File:** `packages/client/src/pages/EditorPage.tsx:900` (label build) → `packages/shared/src/schemas.ts:203-208` (schema pipe)
- **Bug:** The toolbar "send selection to outtakes" builds the label as `"From " + (activeChapter?.title ?? "")`. The prefix `STRINGS.outtakes.fromChapterPrefix` is `"From "` (5 chars); chapter titles are validated at `max(500)`. `CreateOuttakeSchema.label` ends in `.pipe(z.string().trim().max(500))`, which **rejects** rather than truncates, so a 496–500-char title produces a 501–505-char label → `safeParse` fails → route throws `BadRequestError` → **400 "Label is too long"**, surfaced as a generic create-error banner.
- **Impact:** Capturing a selection from any chapter with a near-max title is deterministically broken with a misleading error. Capture is non-destructive so no text is lost, but nothing gets stashed. Unlike the sibling snapshot label (user-typed, so the user controls length), this label is machine-derived from a field as long as the cap itself and nothing truncates it before the POST.
- **Suggested fix:** Truncate the derived label client-side before POST so `"From " + title` fits 500 (e.g. slice the title portion, grapheme-aware if a helper exists), or change the outtake label chain to a truncating `.transform((s) => s.slice(0, 500))`. Client truncation is the smaller, sibling-consistent change.
- **Confidence:** High (85)
- **Found by:** Logic & Correctness

### [I2] Whole-list reload clobbers / duplicates optimistic mutations
- **File:** `packages/client/src/components/OuttakesPanel.tsx:53-65` (load effect) vs. `:80` (create prepend), `:97` (delete filter), `:110` (update map)
- **Bug:** The load effect does an unconditional `setOuttakes(rows)` on GET resolve, guarded only by its own `loadOp` signal. A toolbar capture bumps `refreshNonce` (`EditorPage.tsx:907`), re-firing that GET. Create/delete/update each run on a **separate** `useAbortableAsyncOperation`, which only cancels the network request — it does **not** arbitrate cross-op response staleness (that is `useAbortableSequence`, per CLAUDE.md §Save-pipeline invariant 4). So a reload GET that resolves *after* a concurrent delete or update **resurrects/reverts** the row; and the create prepend `[row, ...prev]` has no id-dedup, so a reload landing around the same POST **duplicates** the row → duplicate React `key` at `:197`.
- **Impact:** Silent UI corruption of the only view of this data — deleted rows reappear (then 404 on a second delete), edited labels revert, created rows double-render — with no error surfaced, in exactly the concurrent capture-plus-panel path the feature introduces.
- **Suggested fix:** Reconcile reloads by id (merge, not wholesale replace), and/or route the list load through `useAbortableSequence` so a stale reload is discarded when a mutation has landed since it started. At minimum, dedup the create prepend by id.
- **Confidence:** High (75)
- **Found by:** Error Handling & Edge Cases + Concurrency & State (same bug)

### [I3] Failed label PATCH is un-retryable and leaves the UI diverged from the server
- **File:** `packages/client/src/components/OuttakeCard.tsx:35-40` (`commitLabel`) + `packages/client/src/components/OuttakesPanel.tsx:105-116` (`handleUpdateLabel`)
- **Bug:** `commitLabel` sets `lastCommittedRef.current = next` **before** the async update runs, and `onUpdateLabel` is fire-and-forget (not awaited). The panel's `handleUpdateLabel` catch only sets an error banner — it never reverts the row, and the card's `labelDraft` is `useState`-seeded once at mount with no effect syncing it to the prop. So a failed PATCH leaves the card showing the new label, the server holding the old one, and `lastCommittedRef === next` blocking any retry on a later blur.
- **Impact:** After a label-save failure the visible state permanently contradicts persisted state until remount/reload; the "possibly committed" copy is shown but the field looks saved and can never be re-committed.
- **Suggested fix:** Advance `lastCommittedRef` only on confirmed success (thread the promise/result back from the panel and set the ref in its resolve), and revert `labelDraft`/the displayed label on failure.
- **Confidence:** High (75)
- **Found by:** Error Handling & Edge Cases + Concurrency & State (same bug)

### [I4] Shared `deleteOp` / `updateOp` abort same-type sibling operations on other rows
- **File:** `packages/client/src/components/OuttakesPanel.tsx:46-47` (single ops) + `:92-116` (handlers)
- **Bug:** There is one `deleteOp` and one `updateOp` for the whole panel. `run()` aborts the op's prior controller, so deleting or renaming row B while row A's op is in flight aborts A's controller. If A's request already reached the server, A's optimistic `setState` is skipped by the `if (signal.aborted) return` guard, leaving stale UI — silently, because ABORTED is suppressed by the mapper. The in-code comment's "independent, concurrent mutation does not abort another" holds only *across* mutation types, not within one type on different rows.
- **Impact:** A user quickly deleting or relabeling two outtakes gets a stale/lost-update on the first one with no error: a deleted row stays visible (then 404 on retry), or a committed label edit shows the old value.
- **Suggested fix:** Do not share a single op across rows for these — key an op per outtake id, or drop the abort-sibling behavior and reconcile by id after each awaited server response.
- **Confidence:** Medium-High (70)
- **Found by:** Error Handling & Edge Cases

## Suggestions

- **[S1]** `packages/server/src/outtakes/outtakes.routes.ts:8-17` — `UuidSchema` + `validateUuidParam` are duplicated byte-for-byte from `snapshots.routes.ts:8-17` (bodies differ only in the label union/message). Extract a shared server util so the UUID trust boundary can't drift across endpoints. *(Contract & Integration, conf 80)*
- **[S2]** `packages/shared/src/schemas.ts:203-208, 214-219` — the label chain `.max(5000).transform(sanitizeSnapshotLabel).pipe(z.string().trim().max(500))` is now triplicated (CreateSnapshotSchema, CreateOuttakeSchema, UpdateOuttakeSchema), differing only in `.optional()`/`.nullish()`/`.nullable()`. Hoist a `sanitizedLabelBase` and apply the nullability modifier per use. *(Contract & Integration, conf 85)*
- **[S3]** `packages/server/src/outtakes/outtakes.service.ts:22` — `createOuttake` strips images but **not** editor-only `note` marks. No leak today (outtake surfaces are plain-text; export/preview never read outtakes), but this is a new raw-editor-JSON persistence surface that bypasses the note-strip discipline with no forcing test — a future HTML preview of outtake content would leak private notes, and Phase 4c.3 tags would be stashed unconsidered. Make a conscious, tested decision (strip on capture, or document as an intentional round-trip surface and add it to the `editorExtensions` forcing-pause coverage). *(Security, conf 75)*
- **[S4]** `packages/server/src/outtakes/outtakes.service.ts:16-20` — TipTap content validation (`TipTapDocSchema`) lives only at the route; a direct service caller bypasses it. Latent robustness gap (all live callers go through the route). Validate in the service, or document the route as the sole trust boundary. *(Plan Alignment, conf 70)*

## Plan Alignment

Design/plan docs consulted: `docs/plans/2026-07-19-scratchpad-outtakes-design.md`, `docs/plans/2026-07-19-scratchpad-outtakes-plan.md`, `docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md`.

- **Implemented:** Essentially the full plan (Tasks A1–H1) — shared `OuttakeRow`/`toPlainText`/`stripImageNodes`/schemas; migration `015` with the exact planned columns (no `word_count`/`deleted_at`, `(project_id, created_at)` index, `ON DELETE CASCADE`); repository/service/routes/store-slice; all three exclusion tests (velocity, export, find-and-replace); client API, scopes, strings, `OuttakesPanel`, `OuttakeCard`, toolbar button, `handleInsertOuttake`/`handleSendSelectionToOuttakes`; e2e spec; CLAUDE.md §Data Model bullet.
- **Not yet implemented:** Design §8 step 3's "capture label editable *before* send" — the toolbar POSTs immediately with the auto-label and the label is only editable afterward on the card. The plan (F2) itself specifies immediate POST, so the code matches the plan; the design nuance simply wasn't carried into the plan. (Neutral.)
- **Deviations:** S4 above — content validation placed at the route rather than the service (design §6 assigned it to the service). Benign on the HTTP path; noted as a placement difference, not a functional gap.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (design docs present) — 6 specialists + 1 verifier, dispatched in parallel.
- **Scope:** Changed files + adjacent — `packages/server/src/outtakes/*`, `packages/shared/src/{tiptap-images,tiptap-plaintext,schemas,types,index}.ts`, `packages/server/src/stores/*`, `packages/server/src/app.ts`, migration `015`, `packages/client/src/{pages/EditorPage,components/OuttakesPanel,components/OuttakeCard,components/EditorToolbar,components/EditorMainContent,components/EditorHeader,api/client,errors/scopes}.tsx?`, compared against the `snapshots` sibling feature.
- **Raw findings:** 11 (across 6 specialists)
- **Verified findings:** 8 (I1–I4 Important, S1–S4 Suggestions)
- **Filtered out:** 3 (2 dedup merges into I2/I3; 1 rejected — see below)
- **Rejected:** `handleInsertOuttake` omitting the `isActionBusy()` gate that `onInsertImage` uses. The narrower `!isEditable || isLocked()` guard is explicitly documented as intentional (gates the content/save axis); inserting outtake content during a sidebar op is a normal auto-saved edit, not data loss. No loss trace could be constructed. At most a consistency nit.
- **Steering files consulted:** `CLAUDE.md` (no contradictions — §Data Model was updated in this branch to match the code).
- **Plan/design docs consulted:** the three phase-4c.2 docs listed above.
