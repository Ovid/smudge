# Agentic Code Review: ovid/architecture

**Date:** 2026-05-29 16:12:08
**Branch:** ovid/architecture -> main
**Commit:** 3d58db6ac5d03fbc3985c03d74bf0d350da48cd0
**Files changed:** 16 | **Lines changed:** +287 / -111
**Diff size category:** Medium

## Executive Summary

This branch implements five architecture-report fixes (F-11 slug-resolution relocation, F-15 auto-snapshot dedup, F-19 deployment-doc reword, F-20 `escapeHtml` cycle-break, F-21 dead-code removal) plus e2e test hardening. Four of the five fixes (F-11, F-19, F-20, F-21) verified clean. The one substantive problem is **F-15**: the auto-snapshot dedup is mis-described and does not deliver the retry idempotency its commit message, code comments, and report Status line claim — because the hash lookup it reuses (`getLatestContentHash`) deliberately filters to *manual* snapshots only, so a retried restore/replace still inserts a duplicate *auto* snapshot. Confidence is high (five independent specialists converged on it). No data-corruption or security findings.

## Critical Issues

None found.

## Important Issues

### [I1] F-15 auto-snapshot dedup is mis-described and does not cover its stated retry scenario
- **File:** `packages/server/src/snapshots/snapshots.service.ts:189-201` and `packages/server/src/search/search.service.ts:321-333` (root-cause query `packages/server/src/snapshots/snapshots.repository.ts:39-57`)
- **Bug:** Both new dedup guards call `txStore.getLatestSnapshotContentHash(chapterId)`, which delegates to `snapshotsRepo.getLatestContentHash` — a query that filters `.where({ chapter_id, is_auto: false })`, i.e. it only ever inspects the latest **manual** snapshot. That filter is correct for its original consumer (`createSnapshot`'s manual-dedup, which must not be tripped by an auto-snapshot), but F-15 reuses it on the **auto**-snapshot insert path. The restore/replace paths insert `is_auto: true` snapshots. The scenario F-15 targets is a *retried* restore/replace that creates a duplicate "Before restore…" / "Before find-and-replace…" auto-snapshot. On a genuine retry the snapshot left by the first attempt is `is_auto: true` and is therefore invisible to this lookup, so the duplicate auto-snapshot is still inserted. The guard only fires when the pre-operation content matches a pre-existing **manual** snapshot — which is not the retry scenario. The commit message (`7400471`), the in-code comments (`snapshots.service.ts:183-188`, `search.service.ts:315-319` — "deduped exactly as the manual-snapshot path is … a retried request no longer pollutes history"), and the F-15 Status reason in the architecture report all overstate the actual behavior.
- **Impact:** History pollution from retried restore/replace — the exact flaw F-15 set out to close — is **not** fixed for the realistic auto-then-retry-auto case. The report marks F-15 "Fixed" and the tests are green, so reviewers and future work will believe retried restores are deduped when they are not. This is a description/behavior mismatch (an attention-grade Spec-Compliance failure mode), not data loss: the mutation always proceeds, and when the skip *does* fire there is by definition an identical manual snapshot preserving recoverability. Supporting evidence: both new tests (`snapshots.service.test.ts:274-302`, `search.service.test.ts:604-625`) seed a `createSnapshot(...)` (→ `is_auto: false`) equal to current content and run a single op — they exercise the manual-match path and pass precisely because they never reproduce the retry. (Replace-path nuance: a retried replace usually finds 0 matches — the term is already replaced — and skips the snapshot block via `if (count === 0) continue`, so the replace dedup adds little for retries regardless; restore is where the gap is observable.)
- **Suggested fix:** Either (a) change the dedup lookup at these two auto-snapshot sites to consider the latest snapshot of *any* `is_auto` value (e.g. a `getLatestContentHashAnyKind` / `includeAuto` variant), keeping the manual-only filter for `createSnapshot`, so a retry actually dedups against the prior auto-snapshot — and add a test that performs the operation twice and asserts the auto-snapshot count does not grow; or (b) if the narrower manual-match behavior is intended, correct the comments, commit message, and report Status reason to state the dedup is against the latest *manual* snapshot only and does not address the auto-vs-auto retry. Do not leave the description/behavior mismatch in place.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Spec Compliance (`claude-opus-4-8[1m]`)

## Suggestions

None found.

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
- **[OOSS1]** Missing `busy_timeout` PRAGMA in `packages/server/src/db/connection.ts` (`<file-scope>`) — WAL + `foreign_keys` are set but no `busy_timeout`, so a writer meeting a held write lock fails immediately with `SQLITE_BUSY` (rendered as HTTP 500) rather than waiting. F-15 adds a `SELECT` before the per-chapter `INSERT` in the restore/replace write transaction, modestly widening the contention window but not causing the bug. — backlog id: `be8a3839` — **Backlog status:** new

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These M additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] e2e `gotoProjectEditor` editor-ready-wait helper
- **File:** `e2e/find-replace.spec.ts:39-57` (+ 11 call-site replacements), commit `3d58db6`
- **Addition:** A new `EDITOR_READY_TIMEOUT` (15s) + `gotoProjectEditor` helper that hardens the editor-mount wait against Vite-dev-server cold-compile flake. None of F-11/F-15/F-19/F-20/F-21 calls for any e2e change.
- **Suggested intent source:** Branch name + commit messages (a single-finding-per-PR architecture-fix series); the project's one-feature rule (CLAUDE.md Pull Request Scope: "a second unrelated bug fix is not" allowed).
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-4-8[1m]`)

### [OOSA2] Whitespace cleanup in `images.service.test.ts`
- **File:** `packages/server/src/__tests__/images.service.test.ts`, commit `9135b33`
- **Addition:** A `style:` whitespace commit. Verified as a direct rider on F-21's deletion — it tidies the gap left by removing the `getImage` `describe` block — so it is plausibly legitimate F-21 cleanup rather than true scope creep, but it shipped as its own commit, so it is surfaced for a decision rather than silently absorbed.
- **Suggested intent source:** F-21 finding + commit messages.
- **Confidence:** Medium
- **Found by:** Spec Compliance (`claude-opus-4-8[1m]`)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance (6 specialists, parallel) + 1 Verifier
- **Scope:** Changed + adjacent — `search.service.ts`, `search.routes.ts`, `snapshots.service.ts`, `snapshots.repository.ts`, `content-hash.ts`, `export/html-escape.ts`, `export/export.renderers.ts`, `export/epub.renderer.ts`, `export/image-resolver.ts`, `images/images.service.ts`, `db/connection.ts`, `velocity.service.ts`, `export.service.ts`, `e2e/find-replace.spec.ts`, and the four touched test files
- **Raw findings:** 9 (before verification)
- **Verified findings:** 4 (1 in-scope Important, 1 out-of-scope Suggestion, 2 out-of-scope additions)
- **Filtered out:** 5 (merged duplicates of I1 from 4 specialists into 1; dropped benign TOCTOU [D] and stale-CLAUDE.md [G])
- **Out-of-scope findings:** 1 (Critical: 0, Important: 0, Suggestion: 1)
- **Out-of-scope additions:** 2
- **Backlog:** 1 new entry added, 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md`
- **Intent sources consulted:** architecture report `paad/architecture-reviews/2026-05-29-smudge-architecture-report.md` (F-11/F-15/F-19/F-20/F-21), recent commit messages, branch name
- **Verifier warnings:** none
