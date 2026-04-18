---
name: Agentic code review — ovid/snapshots-find-and-replace (2026-04-18 20:28)
description: Post-fix verification review of the snapshots + find-and-replace branch, dispatched after the prior review's findings were addressed. Confirms no regressions introduced by the fix batch; deferred items (I3/S3/S6/S9/S10/S11) remain tracked in notes/TODO.md.
type: reference
---

# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-18 20:28:15
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 9a93432fa02e0530ddfb1b92725f59933413eb5c
**Files changed:** 94 (full branch) | **Lines changed:** +15,047 / -152
**Diff size category:** Large (full branch); Small (delta since prior review — ~686 functional lines)

## Executive Summary

This is a **post-fix verification review** for the snapshots + find-and-replace branch. The prior review (`9012c13`, 2026-04-18 17:17) surfaced 9 Important and 12 Suggestions; since then, ten fix commits have landed that address every non-deferred item. The scope of this review is those fix commits, to check for regressions and newly-introduced bugs. **No Critical or Important issues were confirmed.** All prior fixes were implemented correctly, maintain correct contracts between client and server, and are covered by updated tests. Deferred items (I3 wall-clock deadline, S3 surrogate slicing, S6 canonicalize unification, S9 cross-project-image policy mismatch, S10 persisted hash column, S11 canonicalize depth scope) remain in `notes/TODO.md` and were explicitly excluded from this pass.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S13]** `packages/shared/src/wordcount.ts:15-31` — `extractText` has no recursion-depth guard, unlike the parallel `collectLeafBlocks` walker (which now caps at `MAX_WALK_DEPTH = 64`). Every current caller passes TipTapDocSchema-validated content, so the cap is enforced upstream, but the walker itself is the last line of defense if a legacy row or test harness ever feeds it bypass-validated content. Add the same depth parameter + cap as `collectLeafBlocks` for symmetry. Not a regression from this delta — the walker shape is unchanged; the refactor only swapped string concat for `parts.push(...).join("")`. Found by: Error-Handling.
- **[S14]** `packages/client/src/hooks/useFindReplaceState.ts:185-187` — `searchAbortRef.current` holds onto the most-recent `AbortController` after a successful search until the next call overwrites it or the component unmounts. Functionally harmless (the controller is idle), but clearing it in the seq-guarded `finally` block would tighten lifecycle hygiene and make debugging references easier. Found by: Concurrency.

## Plan Alignment

Not re-run. The prior review (9012c13) confirmed all 20 plan tasks were implemented; this delta is purely fix work, not new scope.

## Deferred Items (Tracked in `notes/TODO.md`)

The following items were identified in the prior review and deliberately excluded from this pass — each requires architectural decision work beyond the scope of a fix batch:

- **I3:** Catastrophic `regex.exec()` can exceed the wall-clock deadline. Requires `node-re2`, worker-thread termination, or tighter input caps.
- **S3:** `extractContext` slices by UTF-16 code unit and can split surrogate pairs in the find-panel preview. Cosmetic.
- **S6:** `canonicalize` in `content-hash.ts` and `canonicalJSON` in `tiptap-text.ts` are near-duplicates drifting apart.
- **S9:** Cross-project image URLs are refused on snapshot restore (`CROSS_PROJECT_IMAGE_REF`) but silently accepted on chapter PATCH. Policy decision needed before enforcement.
- **S10:** Manual-snapshot dedup is enforced in-application, not at the DB level. Migration + partial unique index proposed.
- **S11:** `canonicalize` counts depth on every nested object/array, but `validateTipTapDepth` only counts `content[]` descents — possible divergence for docs with deep `attrs`.

## Verification Notes on Prior-Fix Correctness

Each prior Important issue was re-read at its current location to confirm the fix closes the hole:

- **I1** (`useFindReplaceState.ts:80-92`): Effect now gates on `projectId`, not slug, and seeds a ref so rename doesn't trigger a reset. Test coverage added.
- **I2** (`api/client.ts:298-327`, `hooks/useFindReplaceState.ts`): `AbortSignal` is threaded through `api.search.find` / `api.search.replace` via conditional spread; `apiFetch` translates native `AbortError` to `ApiRequestError(..., 0, "ABORTED")` (client.ts:39-40), which the error mappers then return `null` for. Abort semantics interact correctly with the seq-ref stale-response guard. Test assertion widened to expect the 4th `AbortSignal` arg.
- **I4** (`snapshots.service.ts`): Missing `content` coerced to `[]` before downstream walkers see it; new test covers `{"type":"doc"}` restore.
- **I5** (`utils/findReplaceErrors.ts`): `mapSearchErrorToMessage` extracted alongside `mapReplaceErrorToMessage`; both callsites route through the utility. The two mappers are intentionally not identical — search has no 404 scope case.
- **I6** (`shared/src/constants.ts`): `MAX_QUERY_LENGTH` / `MAX_REPLACE_LENGTH` moved to shared; server schemas and client `<input maxLength>` both consume them.
- **I7** (`useSnapshotState.ts`, `SnapshotPanel.tsx`): Hook owns list state when the panel is closed and skips its own fetch when `panelOpenRef.current` is true; panel invokes `onSnapshotsChange?.(count)` after its own fetches so the badge stays in sync.
- **I8** (`snapshots.routes.ts`, `api/client.ts`): `{ status: "created" | "duplicate", ... }` discriminant replaces the boolean; every consumer (`SnapshotPanel.tsx`, tests, mocks) updated. No remaining `result.duplicate` references.
- **I9** (`snapshots.service.ts:236-249`): Enrichment failure after commit now logs and returns the chapter with `status_label` falling back to the raw status code, mirroring `chapters.service.ts`.
- **S1/S2/S4/S5/S7/S8/S12** (commit `ed86fd2`): Walker guards, depth counter aligned with `MAX_TIPTAP_DEPTH`, unpaired-surrogate stripping in `sanitizeSnapshotLabel`, lookaround normalization (5 forms + named groups), shared `buildAutoSnapshotLabel`, distinct `CROSS_PROJECT_IMAGE_REF` error code, and `Object.create(null)` scratch object all verified. Prototype-pollution keys (`__proto__`, `prototype`, `constructor`) additionally filtered out of the canonicalize entry list.

## Rejected Candidate Findings

Surfaced by specialists and dropped after verification:

- **AbortError in mapSearchErrorToMessage / mapReplaceErrorToMessage** (Error-Handling, 85% pre-verify) — False positive. `apiFetch` in `client.ts:36-48` intercepts the native `DOMException("AbortError")` before it reaches the mapper and re-throws as `ApiRequestError("Request aborted", 0, "ABORTED")`. The mappers' `if (err.code === "ABORTED") return null;` branch catches it as intended.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security.
- **Scope:** Delta since prior review (`9012c13..HEAD`, 1151 lines across 26 files, 10 commits), with full-branch context available.
- **Raw findings:** 10 before verification.
- **Verified findings:** 2 Suggestions (both defense-in-depth, pre-existing shape, not regressions).
- **Filtered out:** 8 (false positives, duplicates of prior-reported issues, confirmed-working fixes).
- **Steering files consulted:** `CLAUDE.md`.
- **Plan/design docs consulted:** none re-read (unchanged since prior review).
- **Deferred-item tracker consulted:** `notes/TODO.md`.
