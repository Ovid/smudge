# Agentic Code Review: scratchpad-outtakes

**Date:** 2026-07-19 21:00:31
**Branch:** scratchpad-outtakes -> main
**Commit:** acf1892fef29a661beb427673bb771014e8e62ec
**Files changed:** 48 | **Lines changed:** +4783 / -37
**Diff size category:** Large

## Executive Summary

Phase 4c.2 (Scratchpad Outtakes) is a clean, well-tested feature. Six specialists
plus a verifier found **no Critical issues and no security vulnerabilities**. The
single Important finding is a narrow client-side timing race where a captured
selection can silently fail to appear in the panel (the server always has it — this
is a display gap, not data loss). Everything else is a Suggestion: small UX/error-copy
gaps and cosmetic guards. Overall confidence in the change is high; the trust
boundaries (image-strip on capture, note-mark preservation, parent-project liveness,
table-separation exclusion from export/word-count/find-replace) all hold and are
verified end-to-end.

## Critical Issues

None found.

## Important Issues

### [I1] Captured selection can silently fail to appear in the Outtakes panel
- **File:** `packages/client/src/pages/EditorPage.tsx:906-928` (capture) + `packages/client/src/components/OuttakesPanel.tsx:58-71, 105-115` (reload effect + reconcilers)
- **Bug:** `handleSendSelectionToOuttakes` is fire-and-reload with **no optimistic
  insert**: it POSTs, then bumps `outtakesRefreshNonce`, and the nonce-triggered
  reload effect (`seq.start()` + GET) is the *only* thing that surfaces the captured
  row. But every card mutation reconciler (`handleCreate`, `handleDeleted`,
  `handleUpdated`) calls `seq.abort()`, which stales any in-flight reload token.
  Interleaving: capture → nonce bump → reload GET in flight (server already holds the
  captured row) → user deletes or renames a card → `seq.abort()` → GET resolves,
  `token.isStale()` is true → `setOuttakes` skipped → the captured row never appears
  until an unrelated later reload.
- **Impact:** Silent feature failure in a real (if narrow) timing window — the
  reload's network round-trip overlapping a card delete/rename. No data loss; the
  outtake is persisted server-side and appears on the next reload. A second, related
  variant: two rapid captures where the second aborts the first via `captureOp` leaves
  the first committed but never bumps the nonce.
- **Suggested fix:** Give the capture path an optimistic prepend like `handleCreate`
  already implements — have `api.outtakes.create` return the created row up to the
  panel, then prepend + dedup by id + `seq.abort()`. This reuses the existing pattern
  rather than adding new machinery, and removes the dependency on a droppable reload.
- **Confidence:** Medium (68%)
- **Found by:** Concurrency & State (primary); consistent with Error Handling's
  observation that capture has no optimistic reconcile.

## Suggestions

- **[S1] `outtake.create` scope lacks a `byStatus[413]` entry** — `scopes.ts:464-467`.
  An oversized capture/blank-note that trips the `express.json` limit (`app.ts:39`)
  shows the generic `createOuttakeFailed`, inviting a retry that will 413 again.
  `chapter.save` has `saveFailedTooLarge` for exactly this. (413 is near-unreachable
  in practice — a captured selection is a subset of a chapter that already fit.)
  Found by: Error Handling.
- **[S2] UUID param validation drifts between outtakes (zod) and images (regex)** —
  `validateUuidParam.ts:5` vs `images/images.paths.ts:12`. `z.string().uuid()` enforces
  version/variant nibbles; the images `UUID_PATTERN` is plain hex, so a nil-UUID-style
  id is accepted at `/api/images` but 400s at `/api/outtakes` (verified empirically).
  Consistency drift only — both reject genuinely malformed ids; no security/correctness
  hole. Consider pointing images at the shared helper in a follow-up. Found by:
  Contract & Integration.
- **[S3] Rename input not re-seeded from the server-sanitized label** —
  `OuttakeCard.tsx:68-69`. On a successful rename the card sets `lastCommittedRef` to
  the client-normalized value and never sets `labelDraft = row.label`, so if server
  sanitization (zero-width/bidi/control stripping) changed the label, the input keeps
  showing the un-sanitized client value until remount. Fix: seed both from `row.label`.
  Found by: Logic & Correctness.
- **[S4] Preview truncation can split a UTF-16 surrogate pair** — `OuttakeCard.tsx:55`.
  `plainText.slice(0, PREVIEW_LIMIT).trimEnd() + "…"` can leave a lone high surrogate
  (renders as U+FFFD) before the ellipsis. Cosmetic, boundary-only. The trailing-high-
  surrogate trim already exists in `buildOuttakeLabel` (`EditorPage.tsx:56-57`) — reuse
  it. Found by: Logic & Correctness.
- **[S5] Failed rename can overwrite in-flight keystrokes** — `OuttakeCard.tsx:70-76`.
  On a non-abort PATCH failure, `setLabelDraft(lastCommittedRef.current)` reverts the
  field even if the user re-focused and typed during the request. Edge case. Fix: skip
  the revert if the field was edited since the request started, or disable the input
  while the PATCH is in flight. Found by: Error Handling.
- **[S6] 404-on-delete leaves a phantom card + generic banner** — `OuttakeCard.tsx:79-89`.
  A delete that 404s (already gone / parent project soft-deleted) shows the generic
  failure banner and does not remove the card. Note: the review's premise that sibling
  flows treat 404-delete as success is **inaccurate** (image delete does not), so this
  would be a new pattern, and 404 is near-unreachable single-user/single-tab. Low value.
  Found by: Error Handling.
- **[S7] Dead `committed:` copy on `outtake.delete` scope** — `scopes.ts:472-475`. A 204
  delete short-circuits `apiFetch` before any body read and the scope declares no
  `committedCodes`, so `possiblyCommitted` can never fire. Harmless. Note: **every**
  sibling delete scope (`project/chapter/snapshot/image`) does the same — this is an
  established repo-wide pattern, not an outtakes defect. Found by: Contract & Integration.

## Plan Alignment

Plan/design docs: `docs/plans/2026-07-19-scratchpad-outtakes-design.md`,
`docs/plans/2026-07-19-scratchpad-outtakes-plan.md`,
`docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md`.

- **Implemented:** Full server stack (migration 015, repository, store facade slice,
  service, two routers, app registration), shared schemas/types/helpers
  (`CreateOuttakeSchema`, `UpdateOuttakeSchema`, `OuttakeRow`, `stripImageNodes`,
  `toPlainText`), client API + error scopes + strings, `OuttakesPanel`/`OuttakeCard`,
  the Outtakes reference-panel tab, both editor entry points (insert + capture) with the
  `editorEntryPointSurface` forcing snapshot updated, exclusion tests
  (`outtakes.exclusion.test.ts`), and the note-mark-preservation forcing test. All
  documented invariants verified: images stripped on capture, note marks preserved (never
  rendered to HTML — only `toPlainText` plaintext or editor re-insert), hard-delete (no
  `deleted_at`), exclusion by table separation, parent-project liveness on every op.
- **Not yet implemented:** Destructive one-click "cut selection to outtakes" — correctly
  deferred to Phase 4c.2a, fenced in both roadmap and design (neutral; partial expected).
- **Deviations:** One minor wording departure (`handleInsertOuttake` guards on
  `!isEditable || isLocked()` rather than an explicit `machine.busy` read the plan named).
  **Verified functionally equivalent** — a busy mutation sets `editable=false`, so the
  `isEditable` check transitively covers the busy window. Not a defect. The note-mark
  preservation invariant is an *addition* beyond design.md/plan.md (originated in review
  S3); it strengthens rather than contradicts the design and CLAUDE.md describes it
  accurately. roadmap.md and CLAUDE.md edits accurately describe what was built.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract &
  Integration, Concurrency & State, Security, Plan Alignment; plus a single Verifier pass.
- **Scope:** All 48 changed files + adjacent context (snapshots stack as the sibling
  pattern, `useAbortableSequence`/`useAbortableAsyncOperation` hooks, error-mapper scopes,
  db connection/FK-pragma, images UUID validator, EditorPage wiring).
- **Raw findings:** 11 (before verification)
- **Verified findings:** 8 (1 Important, 7 Suggestions)
- **Filtered out:** 3 — EH3 (2xx-BAD_JSON create duplicate: accepted F-8 non-idempotent-
  create trade-off), CI2 (OuttakeRow parsed-object vs SnapshotRow raw-string content:
  documented deliberate boundary), D1 (insert-guard wording: functionally equivalent).
- **Steering files consulted:** `CLAUDE.md` (Data Model outtakes contract, Save-pipeline
  invariants, Accepted Architectural Trade-offs F-3/F-8/F-16). No stale contradictions found.
- **Plan/design docs consulted:** the three Phase 4c.2 docs listed above.
