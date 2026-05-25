# Agentic Code Review: image-gallery-abort-migration

**Date:** 2026-05-25 13:39:40
**Branch:** `image-gallery-abort-migration` -> `main`
**Commit:** `af1acb538f622ce85467cb00d042ffd4b45579fe`
**Files changed:** 9 | **Lines changed:** +2453 / -116
**Diff size category:** Large (production code only is ~155 LOC; the bulk is +396 LOC of new tests and ~1,930 LOC of new design/plan/decision-log docs)

## Executive Summary

Clean migration. Five of six specialists (Logic, Error Handling, Contract, Concurrency, Security) returned no findings — the swap from `useRef<AbortController>` to `useAbortableAsyncOperation` faithfully preserves every observable contract (abort-prior, signal-threading, abort-on-unmount, cross-handler shared `mutationOp` semantics, cross-instance independence of `refsOp`), and the 7 new characterization tests pin all three axes. Spec Compliance surfaced two minor doc-prose suggestions and two out-of-scope additions (the `PHASE_4B_3B_ALLOWLIST` const and a companion "allowlist-still-matches" test) that exist because the design's "zero offenders after this phase" assumption was factually wrong against the roadmap's 9 reserved Phase 4b.3b sites. Commit `956259c`'s message already acknowledges the discovery ("Roadmap wins as the source of truth"); flagging both additions for explicit per-PR sign-off rather than silent acceptance.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- [S1] **`CLAUDE.md:132`** — Save-pipeline invariant #4 added an unprescribed clause about the 7-entry Phase 4b.3b allowlist. Necessary given OOSA1, but diverges from the design's prescribed text. *(Spec Compliance, confidence High)*
- [S2] **`packages/client/src/__tests__/migrationStructuralCheck.test.ts:113`** — The new allowlist comment still references `docs/roadmap.md lines 762–763`. Commit `af1acb5` established the lesson that cross-file line numbers in comments rot silently; this comment dodged the same fix. Replace `lines 762–763` with a behaviour-anchored reference such as "the Phase 4b.3a.1 §Out of scope list" or the section name alone. *(Spec Compliance, confidence Medium)*

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These M additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] 7-entry `PHASE_4B_3B_ALLOWLIST` const + structural-check exemption

- **File:** `packages/client/src/__tests__/migrationStructuralCheck.test.ts:127-135`
- **Addition:** A `const PHASE_4B_3B_ALLOWLIST = new Set([...7 absolute paths...])` exempts `ExportDialog.tsx`, `ProjectSettingsDialog.tsx`, `SnapshotPanel.tsx`, `useProjectEditor.ts`, `useSnapshotState.ts`, `EditorPage.tsx`, `HomePage.tsx` from the new global `useRef<AbortController>` ban.
- **Suggested intent source:** `docs/plans/2026-05-25-image-gallery-abort-migration-design.md` §Test plan §"Structural-check collapse" prescribes a complete code block with **no allowlist**, plus §Out of scope bullet 7: *"None remain after this phase. The global ban enforces this."* Reality at `docs/roadmap.md:762` always carried 9 deferred-to-4b.3b sites (7 with `useRef<AbortController>`, 2 with raw `AbortController`), so a zero-tolerance ban was impossible. Commit `956259c`'s message acknowledges *"Roadmap wins as the source of truth."* The shipped allowlist is correct against reality; the design was factually wrong. Suggested disposition from Spec Compliance: keep, with explicit sign-off.
- **Confidence:** High
- **Found by:** Spec Compliance (`claude-opus-4-7`)

### [OOSA2] 8th structural-check test pinning the allowlist's still-relevance

- **File:** `packages/client/src/__tests__/migrationStructuralCheck.test.ts:152-165`
- **Addition:** A new test (`Phase 4b.3b allowlist entries actually contain useRef<AbortController>`) walks `PHASE_4B_3B_ALLOWLIST` and asserts each entry still matches the regex, so dead allowlist entries cannot mask drift in files that still need migration.
- **Suggested intent source:** Design §Test plan promised exactly **one** new structural-check test (the global ban). This is a second new test, causally tied to OOSA1 — without it the allowlist becomes a silent broken-windows surface where exemptions persist past their reason. Suggested disposition from Spec Compliance: keep.
- **Confidence:** High
- **Found by:** Spec Compliance (`claude-opus-4-7`)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance (6 specialists, 1 instance each — production code under review is concentrated in `ImageGallery.tsx` so single-instance dispatch sufficed despite the large doc-diff)
- **Scope:** `packages/client/src/components/ImageGallery.tsx`, `packages/client/src/__tests__/ImageGallery.test.tsx`, `packages/client/src/__tests__/migrationStructuralCheck.test.ts`, `packages/client/src/__tests__/helpers/abortableMocks.ts` (adjacent), `packages/client/src/hooks/useAbortableAsyncOperation.ts` (adjacent), `packages/client/src/hooks/useFindReplaceState.ts` / `useTrashManager.ts` (sibling consumers, adjacent), `CLAUDE.md`, plus 5 doc/decision-log files (out-of-tree intent sources)
- **Raw findings:** 6 (all from Spec Compliance — 5 Deviations + 2 OOSA; the other five specialists returned NO FINDINGS)
- **Verified findings:** 4 (2 Suggestions in-scope + 2 OOSA)
- **Filtered out:** 2 (Deviation 4 — design-doc bullet weakening, out-of-tree intent; Deviation 5 — process observation about per-commit typecheck hygiene with no code anchor)
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 2
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md`
- **Intent sources consulted:** `docs/plans/2026-05-25-image-gallery-abort-migration-design.md`, `docs/plans/2026-05-25-image-gallery-abort-migration-plan.md`, `docs/roadmap-decisions/2026-05-25-phase-4b-3a-4-image-gallery-abort-migration.md`, `docs/roadmap.md`, recent commit messages, branch name
- **Verifier warnings:** none
