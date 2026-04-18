# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-18 17:17:06
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 9012c13731b7c9fad9e877d6e50f741582ad5c87
**Files changed:** 91 | **Lines changed:** +14,571 / -152
**Diff size category:** Large

## Executive Summary

This branch adds chapter snapshots (manual + auto with content-hash dedup) and project-wide find/replace with ReDoS guards, match caps, and content-size limits. The core data-integrity paths (save pipeline, transactional replace, snapshot restore, image ref diff) are well-hardened with layered guards — no Critical bugs confirmed. Nine Important issues remain, mostly around contract/UX inconsistency (slug-change wipes replace state, duplicate error-code ladders, missing AbortSignal on search endpoints, misleading `corrupt_snapshot` for cross-project image refs) and one real DoS vector (a single catastrophic `regex.exec()` can freeze the event loop past the wall-clock deadline because the deadline is only checked between exec calls). Twelve Suggestions cover duplication, minor display glitches, defense-in-depth, and architectural cleanup. The implementation tracks the plan closely; deviations are stricter-than-plan schemas, not missed intent.

## Critical Issues

None found.

## Important Issues

### [I1] Find/replace state silently wiped on project rename
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:57-69`
- **Bug:** The project-slug change effect unconditionally clears `query`, `replacement`, `result`, and `actionError`. When the user renames the project (via `handleUpdateProjectTitle` → `navigate(...)`) the slug changes and their in-progress find/replace inputs are discarded.
- **Impact:** Surprising UX data loss — a user mid-replace-all session can lose their carefully-constructed regex and replacement without warning.
- **Suggested fix:** Reset by project id, not slug — only wipe when a genuinely different project is selected. Or surface a confirmation/banner before wiping.
- **Confidence:** High
- **Found by:** Logic-Client

### [I2] Search/replace requests accept no AbortSignal
- **File:** `packages/client/src/api/client.ts:298-324`
- **Bug:** `api.search.find` and `api.search.replace` don't accept an `AbortSignal`, unlike `chapters.update`, `settings.update`, and `projects.export`. Stale search responses are discarded via a seq ref, but the underlying fetch and the server's regex walk run to completion.
- **Impact:** Under rapid typing or panel close, N superseded search requests continue running on the server (each bounded only by the 2s regex deadline). Wasted CPU; contradicts the design goal of AbortController signal flow.
- **Suggested fix:** Plumb `signal?: AbortSignal` through both endpoints; abort prior requests from `useFindReplaceState` on new searches and on unmount/panel-close.
- **Confidence:** High
- **Found by:** Error-Handling, Contract-Integration

### [I3] Catastrophic `regex.exec()` can exceed the wall-clock deadline
- **Files:** `packages/shared/src/tiptap-text.ts:378-396, 466-483`; `packages/server/src/search/search.service.ts:146, 251`
- **Bug:** The `opts.deadline` check is evaluated between iterations of `re.exec(...)`. A single catastrophic-backtracking exec is synchronous and blocks the event loop for as long as V8 takes to explore the state space — potentially far longer than `REGEX_DEADLINE_MS=2000`.
- **Impact:** The ReDoS heuristic (`assertSafeRegexPattern`) is documented as "best-effort"; the wall-clock budget was the backstop. Since the backstop can't interrupt a running exec, a carefully-crafted pattern can freeze the Node process. Single-user local app limits blast radius, but the user can wedge their own server.
- **Suggested fix:** For hardened regex safety, switch to a linear-time engine (e.g. `re2`) for user-supplied patterns, or run search/replace in a worker thread that can be terminated on deadline.
- **Confidence:** High
- **Found by:** Error-Handling, Security

### [I4] Snapshot restore rejects schema-valid docs with no `content` key
- **File:** `packages/server/src/snapshots/snapshots.service.ts:120-126`
- **Bug:** `TipTapDocSchema` declares `content: z.array(...).optional()`, so `{"type":"doc"}` passes `safeParse`. The follow-up `!Array.isArray(parsed.content)` check then rejects it with `corrupt_snapshot`.
- **Impact:** A legitimately empty-doc snapshot surfaces a misleading "corrupt" error. Low likelihood under normal TipTap emission, but any hand-rolled or import-path doc without `content` is blocked.
- **Suggested fix:** Coerce missing `content` to `[]` before proceeding (or tighten the schema to require it). Don't reject what the schema allows.
- **Confidence:** Medium
- **Found by:** Logic-Server, Error-Handling

### [I5] Duplicate error-code mapping between `useFindReplaceState` and `findReplaceErrors.ts`
- **Files:** `packages/client/src/hooks/useFindReplaceState.ts:136-154` vs `packages/client/src/utils/findReplaceErrors.ts:11-35`
- **Bug:** The hook's search `catch` block reimplements the 400-code ladder (MATCH_CAP_EXCEEDED, REGEX_TIMEOUT, INVALID_REGEX, CONTENT_TOO_LARGE) that was extracted into `findReplaceErrors.ts` per that file's own header comment. Only the fallback string and ABORTED-handling differ.
- **Impact:** Drift risk: adding a new `SearchErrorCode` to `mapReplaceErrorToMessage` won't affect the search panel until the hook is also edited. Easy to miss in review.
- **Suggested fix:** Extract a sibling `mapSearchErrorToMessage(err)` in `findReplaceErrors.ts` and have the hook call it.
- **Confidence:** High
- **Found by:** Contract-Integration

### [I6] `MAX_QUERY_LENGTH` / `MAX_REPLACE_LENGTH` are server-only; client cannot pre-flight validate
- **File:** `packages/server/src/search/search.routes.ts:17-18`
- **Bug:** These constants (1000 / 10000) are declared locally in the server route and not shared via `@smudge/shared`. Client lets users type 20k-char queries, POSTs them, and only then receives a `VALIDATION_ERROR` which `mapReplaceErrorToMessage` swallows as generic "invalid replace request".
- **Impact:** Preventable UX regression; violates the single-source-of-truth convention set by `MAX_MATCHES_PER_REQUEST` and `CONTEXT_RADIUS` in `@smudge/shared`.
- **Suggested fix:** Move both constants to `@smudge/shared/constants.ts`; add `maxLength` to the find/replace inputs and pre-flight validate in `useFindReplaceState`.
- **Confidence:** High
- **Found by:** Contract-Integration

### [I7] `SnapshotPanel` and `useSnapshotState` both fetch the list on every chapter change
- **Files:** `packages/client/src/hooks/useSnapshotState.ts:90-108` and `packages/client/src/components/SnapshotPanel.tsx:92-109`
- **Bug:** Both effects call `api.snapshots.list(chapterId)` on chapter change. The hook feeds the toolbar count badge; the panel feeds its own list state. On a flaky network one call can fail while the other succeeds, leaving badge and panel disagreeing.
- **Impact:** Wasted round-trip on every chapter switch while the panel is open; possible UI divergence on errors. Neither displays stale data (both use seq guards), just duplicated work and independent failure modes.
- **Suggested fix:** Single-source the fetch. The hook owns the list state and passes it to the panel as a prop.
- **Confidence:** Medium
- **Found by:** Logic-Client

### [I8] Snapshot duplicate creation returns a boolean discriminant on a 200, not the standard error envelope
- **Files:** `packages/server/src/snapshots/snapshots.routes.ts:55-60` and `packages/client/src/api/client.ts:282-289`
- **Bug:** Duplicate creation returns `{ duplicate: true, message: ... }`. Every other "not-really-an-error" response in the codebase uses `{ error: { code, message } }` per CLAUDE.md; this is an outlier.
- **Impact:** Inconsistency — future middleware stripping the body or changing response shape would cause the client (checking truthy `duplicate`) to silently try to read `snapshot` from undefined.
- **Suggested fix:** Either a 200 with a clearly-named success result (`{ status: "duplicate", existing_id }`), or a 409 using the error envelope. Avoid the boolean discriminant.
- **Confidence:** Medium
- **Found by:** Error-Handling

### [I9] Restore enrichment runs outside the transaction — status lookup failure looks like a restore failure
- **File:** `packages/server/src/snapshots/snapshots.service.ts:227-232`
- **Bug:** After the restore transaction commits, `enrichChapterWithLabel` runs; if the `chapter_statuses` read throws, `restoreSnapshot` propagates → 500 to the client. Data is restored but the UI shows failure.
- **Impact:** User may retry restore (producing another auto-snapshot) or simply misread the outcome.
- **Suggested fix:** Mirror the pattern in `chapters.service.ts:128-135` — on enrichment failure, return the chapter with `status_label` falling back to `status`.
- **Confidence:** Medium
- **Found by:** Logic-Server

## Suggestions

- **[S1]** `packages/shared/src/tiptap-text.ts:54-62, 100-111` — `collectLeafBlocks` and `splitBlockRuns` assume object children; guard with `typeof child === "object" && child !== null` to defend against malformed stored content. Found by: Error-Handling.
- **[S2]** `packages/shared/src/tiptap-text.ts:54-62` — add a depth counter to `collectLeafBlocks` to match the walker's responsibilities with `validateTipTapDepth`. Latent risk for legacy rows. Found by: Error-Handling, Security.
- **[S3]** `packages/shared/src/tiptap-text.ts:278-282` — `extractContext` slices by code unit; can split surrogate pairs in emoji-dense contexts, producing lone surrogates in the find panel preview. Round to code-point boundaries. Found by: Error-Handling.
- **[S4]** `packages/shared/src/schemas.ts:155-170` — `sanitizeSnapshotLabel` doesn't strip unpaired surrogates. Append `.replace(/[\uD800-\uDFFF]/g, "")`. Found by: Error-Handling, Security.
- **[S5]** `packages/shared/src/tiptap-text.ts:188-239` — `assertSafeRegexPattern` normalizes only `?:`; lookaround introducers (`?=`, `?!`, `?<=`, `?<!`) evade the nested-quantifier check. Normalize them before shape checks. Found by: Error-Handling.
- **[S6]** `packages/server/src/snapshots/content-hash.ts:18-28` and `packages/shared/src/tiptap-text.ts:289-295` — parallel `canonicalize` / `canonicalJSON` implementations are drifting. Extract a single `canonicalStringify` in `@smudge/shared` with optional depth cap. Found by: Contract-Integration.
- **[S7]** `packages/server/src/search/search.service.ts:62-66,290-291` and `packages/server/src/snapshots/snapshots.service.ts:166-170` — auto-snapshot label boilerplate (`sanitizeSnapshotLabel` + `truncateGraphemes(500)`) is duplicated. Extract `buildAutoSnapshotLabel(template)`. Found by: Contract-Integration.
- **[S8]** `packages/server/src/snapshots/snapshots.service.ts:144-152` — `corrupt_snapshot` error code is overloaded for the cross-project-image case; introduce a distinct `CROSS_PROJECT_IMAGE_REF` (or `INVALID_IMAGE_REF`) code so clients and support docs can discriminate. Found by: Contract-Integration.
- **[S9]** `packages/server/src/chapters/chapters.service.ts:67-69` vs `packages/server/src/snapshots/snapshots.service.ts:144-152` — chapter PATCH silently writes cross-project image URLs while snapshot restore refuses them. Either allow uniformly or add the same guard to PATCH. Found by: Security.
- **[S10]** `packages/server/src/db/migrations/014_create_chapter_snapshots.js` — no persisted `content_hash` column / unique index. Dedup relies on in-transaction read+insert; architecturally the invariant isn't encoded at the DB level. Add a persisted hash column + partial unique index `(chapter_id, content_hash) WHERE is_auto = 0`. Found by: Concurrency.
- **[S11]** `packages/server/src/snapshots/content-hash.ts:18-27` — `canonicalize` walks every array/object; `validateTipTapDepth` only walks `content[]`. Dedup becomes byte-sensitive for docs with deep `attrs`. Align the depth rule with the write-path invariant. Found by: Logic-Server, Security.
- **[S12]** `packages/shared/src/schemas.ts:69-77` — `TipTapDocSchema.passthrough()` retains `__proto__` / `constructor` keys. `canonicalize` assigns via bracket notation to a plain scratch object. Use `Object.create(null)` for the scratch, or strip these keys defensively. Found by: Security.

## Plan Alignment

Design: `docs/plans/2026-04-16-snapshots-find-replace-design.md`
Plan: `docs/plans/2026-04-16-snapshots-find-replace-plan.md`

**Implemented:** All 20 plan tasks are present. Notable items:
- Snapshots: migration 014, types + Zod schema (with label sanitization beyond plan), store/repository/service/routes, FK cascade on chapter purge, SnapshotPanel + SnapshotBanner, view + restore wiring, e2e.
- Find/replace: TipTap text walker, search service + routes, replace service (transactional + auto-snapshots + image-ref diff), match-cap + ReDoS guards + wall-clock deadline, FindReplacePanel with `<aside>` / `aria-live` / Escape, Ctrl+H shortcut, confirmation dialog on replace-all, server-side replace-one via `match_index`.
- Hardening beyond the plan: canonical-JSON dedup hashing, grapheme-aware label truncation, cross-project image guard on restore, content-size cap against replace amplification.

**Not yet implemented:** Nothing material. Minor surface details (exact toolbar label copy, shortcut-help dialog new entry) were not verified line-by-line but appear aligned.

**Deviations (not bugs):**
- Route param `:slug` vs plan's `:id` in search/replace — consistent with existing projects-routing convention.
- Snapshot duplicate response uses `{ duplicate: boolean, ... }` — sharper than plan text but an envelope-shape outlier (see I8).
- `ReplaceSchema.scope` is required rather than optional-with-default — tightens contract; client always sends scope.
- `restoreSnapshot` service can return `"corrupt_snapshot"` sentinel; design doc's error list for `POST /api/snapshots/:id/restore` only mentions 404. Enhancement, not a contradiction.

## Review Metadata

- **Agents dispatched:** Logic-Server, Logic-Client, Error-Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment.
- **Scope:** 91 changed files covering snapshots module (server + client), search/replace module (server + client), shared TipTap walker, schemas, constants, grapheme util, image reference diff changes, editor/page orchestration, keyboard shortcuts, API client.
- **Raw findings:** ~50 before dedupe/verification.
- **Verified findings:** 21 (0 Critical / 9 Important / 12 Suggestions).
- **Filtered out:** ~29 (dedupes, false positives where guards already exist, or mitigated by layered design).
- **Steering files consulted:** `CLAUDE.md`.
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`.
