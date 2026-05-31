# Agentic Code Review: chapter-status-type-alignment

**Date:** 2026-05-31 18:02:52
**Branch:** chapter-status-type-alignment -> main
**Commit:** b62cc63af481c13188e13a2b646a9f922ceecbb2
**Files changed:** 30 | **Lines changed:** +1069 / -67
**Diff size category:** Medium (production footprint is small; bulk of the diff is docs + mechanical test churn)

## Executive Summary

This branch is a compile-time-only TypeScript type-tightening: chapter `status`
moves from the open `string` to the closed union `ChapterStatusValue`
(`z.infer<typeof ChapterStatus>` = `"outline" | "rough_draft" | "revised" |
"edited" | "final"`), propagated through the client status-change handler chain,
the exhaustive `STATUS_COLORS` map, the `api.chapters.update` payload, the
dashboard inline response type, and one server DB-boundary cast. All five
bug-hunting lenses (Logic, Error Handling, Contract, Concurrency, Security) came
back clean after verification — confirmed by a clean `tsc -b` across all three
packages and 174 passing tests. No in-scope or out-of-scope bugs were found. The
only item for decision is one out-of-scope addition: an unrelated behavioral
edit to `.claude/skills/roadmap/SKILL.md`, cleanly isolated in its own commit.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

None found.

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These M additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] Roadmap skill "Offering Options" behavioral directive

- **File:** `.claude/skills/roadmap/SKILL.md:9-35` (isolated in commit `459fa2d`)
- **Addition:** A ~27-line "Offering Options" section requiring pros/cons plus a named recommendation whenever the roadmap skill presents options. This is a behavioral process-skill change unrelated to chapter-status type alignment.
- **Suggested intent source:** Phase 4b.9 design doc (`docs/plans/2026-05-31-chapter-status-type-alignment-design.md`). Its "Out of Scope" section enumerates only DB/API/seed/rename/server-row items and never contemplates process-skill edits, so this addition is genuinely outside the promised scope. (The companion `docs/roadmap.md` status flips and the `docs/roadmap-decisions/INDEX.md` row are in-scope phase-bookkeeping deliverables per the project's roadmap-as-PR workflow and are **not** flagged.)
- **Confidence:** High
- **Found by:** Spec Compliance (`claude-opus-4-8`)
- **Decision needed:** keep / split commit `459fa2d` into its own PR / revert. Suggested resolution: split, or record an explicit exception in the phase decision log.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance (6 specialists in parallel) + 1 Verifier
- **Scope:** Changed + adjacent — `packages/shared/src/{schemas,types,index}.ts`; `packages/client/src/api/client.ts`; `packages/client/src/components/{DashboardView,Sidebar,EditorMainContent}.tsx`; `packages/client/src/hooks/{useChapterMetadata,useProjectEditor,useProjectEditor.types,useTrashManager,useChapterCrud}.ts`; `packages/client/src/pages/EditorPage.tsx`; `packages/client/src/statusColors.ts`; `packages/server/src/chapter-statuses/{chapter-statuses.service,chapter-statuses.types}.ts`; affected test fixtures.
- **Raw findings:** 2 (before verification)
- **Verified findings:** 1 (after verification)
- **Filtered out:** 1 (FINDING 2 — a critique of the design doc's "Expected Test Churn" prediction accuracy, not a code defect; the `as const` annotations are required and the work is correct. Dropped per verifier non-bug drop rule.)
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 1
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`). Pre-existing entry `b7e3f9a1` (`useProjectEditor.ts` drift-guard duplication) matched the manifest but was not re-surfaced — the branch only retyped one ref-declaration line and did not touch the drift-guard closures.
- **Steering files consulted:** `CLAUDE.md` (the "Chapter status is a closed type" invariant — the implementation matches it precisely)
- **Intent sources consulted:** `docs/plans/2026-05-31-chapter-status-type-alignment-design.md`, `docs/plans/2026-05-31-chapter-status-type-alignment-plan.md`, `docs/roadmap-decisions/2026-05-31-phase-4b-9-chapter-status-type-alignment.md`, `docs/roadmap.md` (phase 4b.9), branch commit messages
- **Verifier warnings:** none
