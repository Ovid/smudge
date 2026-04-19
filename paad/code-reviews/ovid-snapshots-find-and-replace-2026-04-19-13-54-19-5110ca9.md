# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-19 13:54:19
**Branch:** ovid/snapshots-find-and-replace → main
**Commit:** 5110ca9053fb12f9673c246ba2fcf564c5f50136
**Files changed:** 100 | **Lines changed:** +16409 / -226
**Diff size category:** Large

## Executive Summary

This branch lands the full snapshots + find-and-replace feature end-to-end with tests at every layer. The implementation is defensively written — transactions, seq counters, abort signals, and size guards are all present. The review found **2 Critical bugs** both in client a11y/navigation guards that regress established invariants, and **7 Important issues** concentrated in error-handling gaps and edge cases around panel lifecycle and mid-flight project renames. The most consequential Critical is the panel focus-on-open regression (L-C1), which silently breaks keyboard-only access to the two new panels. Most other findings are latent defects, maintenance hazards, or narrow UX gaps rather than data-loss risks.

## Critical Issues

### [C1] Initial focus never fires when Snapshot or FindReplace panel opens
- **File:** `packages/client/src/components/SnapshotPanel.tsx:74`, `packages/client/src/components/FindReplacePanel.tsx:71`
- **Bug:** Both panels are conditionally mounted by `EditorPage` (only when open). On first mount, `isOpen === true`, so `useRef(isOpen)` initializes `prevIsOpen.current` to `true`. The focus guard `isOpen && !prevIsOpen.current` is therefore `false` on the very first render, and the `requestAnimationFrame(() => panel.focus())` never runs.
- **Impact:** Keyboard users who open either panel via Ctrl+H or the toolbar button never receive focus inside the panel. They must Tab in manually from wherever focus was. This regresses WCAG 2.1 AA focus management that CLAUDE.md mandates.
- **Suggested fix:** `const prevIsOpen = useRef(false);` in both panels, so the first-mount transition `false → true` triggers the focus RAF.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client)

### [C2] `handleSelectChapterWithFlush` proceeds even when `switchToView` refuses on save failure
- **File:** `packages/client/src/pages/EditorPage.tsx:631-637`
- **Bug:** `switchToView("editor")` returns `void` but internally short-circuits on failed `flushSave` (setting an action-error banner). The caller unconditionally continues to `handleSelectChapter(chapterId)`, which bumps the save seq, aborts the in-flight save, and loads the new chapter — contradicting the "refuse navigation on save failure" invariant that every other caller upholds.
- **Impact:** Sidebar navigation, keyboard Ctrl+Shift+↑/↓, and similar paths can silently abandon an unsaved chapter while simultaneously showing a banner that implies the switch was blocked. Cache holds the content, but the user sees contradictory UX and may not realize they need to retry.
- **Suggested fix:** Have `switchToView` return `boolean` and gate: `if (!(await switchToView("editor"))) return;` before `handleSelectChapter`.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client)

## Important Issues

### [I1] `closePanel` leaves pending debounce timer running
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:103-125, 207-223`
- **Bug:** `closePanel` bumps seq and aborts in-flight, but doesn't clear `debounceRef`. If the panel closes during the 300ms window, the timer fires `search(slug)`, which bumps seq again inside itself and writes result state against a closed panel.
- **Impact:** On reopen, the user sees stale results pinned to the pre-close query/options.
- **Suggested fix:** `if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }` inside `closePanel`.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I2] `reloadActiveChapter` after snapshot restore routes to full-page error overlay
- **File:** `packages/client/src/pages/EditorPage.tsx:212`, `packages/client/src/hooks/useProjectEditor.ts:273-308`
- **Bug:** Replace paths (`executeReplace`, `handleReplaceOne`) pass an `onError` callback to route transient GET failures to a dismissible banner. Snapshot restore calls `reloadActiveChapter()` without a callback, falling back to `setError(...)` — which flips `EditorPage` into its full-page error branch.
- **Impact:** A transient network blip *after* a successful server-side restore nukes the editor page. User must refresh to recover.
- **Suggested fix:** Pass an onError callback matching the replace paths, e.g. `() => setActionError(STRINGS.snapshots.restoreSucceededReloadFailed)`.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client)

### [I3] `viewSnapshot` accepts non-object JSON as content
- **File:** `packages/client/src/hooks/useSnapshotState.ts:163-177`
- **Bug:** Only JSON *syntax* errors are caught. A snapshot whose `content` string is valid JSON but not an object — e.g. `"42"`, `"null"`, `"[1,2,3]"` — parses successfully and is cast to `Record<string, unknown>` before being handed to TipTap. Server `restoreSnapshot` gates on `TipTapDocSchema.safeParse`; client view path does not.
- **Impact:** A corrupt or hand-edited snapshot can crash the snapshot preview editor instead of surfacing a clean "corrupt snapshot" message.
- **Suggested fix:** After parse, assert `content !== null && typeof content === "object" && !Array.isArray(content)` (and ideally `content.type === "doc"`), otherwise return `{ ok: false, reason: "corrupt_snapshot" }`.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I4] `assertSafeRegexPattern` false-positives on common safe patterns like `[A-Z]+[a-z]+`
- **File:** `packages/shared/src/tiptap-text.ts:267-317`
- **Bug:** The heuristic strips character-class contents (`[...] → []`) before scanning for adjacent unbounded quantifiers. `shorthandClass("[]")` returns `null`, so `areAtomsProvablyDisjoint` returns `false`, and patterns like `[A-Z]+[a-z]+`, `[a-z]+\s+`, `[A-Z]{2,}[a-z]+` throw `RegExpSafetyError` — even though the original classes are provably disjoint and cannot ReDoS.
- **Impact:** Users running plain, non-pathological regex searches get rejected with a misleading "adjacent unbounded quantifiers" error. Usability regression.
- **Suggested fix:** Preserve a pre-strip classification (or parse class contents) so `[A-Z]` vs `[a-z]` can be proved disjoint. Minimum: whitelist common shapes (letter ranges, `\s`, `\d`) before throwing.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I5] `findReplaceErrors` mapper ignores 413 PAYLOAD_TOO_LARGE
- **File:** `packages/client/src/utils/findReplaceErrors.ts:16-39`
- **Bug:** Only 400 and 404 status codes are branched on. CLAUDE.md documents 413 as the "content would exceed size guard" signal, and the server emits `code: "PAYLOAD_TOO_LARGE"` from the body-size guard. 413 falls through to the generic `replaceFailed`/`searchFailed` copy that invites a retry — which is doomed.
- **Impact:** Misleading UX on exactly the failure mode the user can act on (shorten content or replacement).
- **Suggested fix:** Add `if (err.status === 413) return STRINGS.findReplace.contentTooLarge;` (or a dedicated 413 string) to both mappers.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I6] `CROSS_PROJECT_IMAGE_REF` returns 400 where CLAUDE.md specifies 409
- **File:** `packages/server/src/snapshots/snapshots.routes.ts:140-160`
- **Bug:** The route comment claims "CLAUDE.md restricts status codes to 200/201/400/404/500," but CLAUDE.md's API Design section explicitly lists 409 for "well-formed request that violates a constraint the client needs to resolve." Cross-project image refs on snapshot restore are a textbook fit — and CLAUDE.md even documents the `{ error: { code, message, chapters: [...] } }` shape for exactly this case. `CORRUPT_SNAPSHOT` (genuinely invalid content) is the only one that belongs at 400.
- **Impact:** Clients can't distinguish validation errors from resource-state conflicts by status code; every new snapshot error that should be 409 will be miscategorized.
- **Suggested fix:** Return 409 for `CROSS_PROJECT_IMAGE_REF`; keep 400 only for `CORRUPT_SNAPSHOT`; correct the comment.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (Server)

### [I7] Stale slug in `findReplace.search` after project rename mid-flight
- **File:** `packages/client/src/pages/EditorPage.tsx:307, 478`; `packages/client/src/hooks/useFindReplaceState.ts:240-246`
- **Bug:** `executeReplace` / `handleReplaceOne` capture `slug` in closure. After a server-side rename, the post-replace `findReplace.search(slug)` calls into the hook wrapper, which writes `latestSlugRef.current = slug` using the stale closure value. Subsequent debounced searches target the dead slug → 404 → silently wipe results.
- **Impact:** After a rename during a replace round-trip, the find/replace panel permanently targets the dead slug until the user manually closes and reopens the panel (which resyncs the ref from the prop).
- **Suggested fix:** Drop the `latestSlugRef.current = slug` write in the outer wrapper — trust the useEffect-synced value — or reject the call if `slug !== projectSlug` prop.
- **Confidence:** Medium
- **Found by:** Concurrency & State, Logic & Correctness (Client)

## Suggestions

- **`packages/shared/src/tiptap-text.ts:547` (match_index cursor)** — `globalMatchCursor` is correct today only via the early-break invariant; comment warns but no test pins it. Fragile if a future reader removes the break. *(Logic-Server, Contract)*
- **`packages/server/src/snapshots/snapshots.service.ts:117, 198`** — restore size-checks raw `snapshot.content` and writes the same string; asymmetric vs replace path which re-serializes. Safe today; maintenance hazard.
- **`packages/server/src/snapshots/snapshots.service.ts:132-201`** — `newParsed.content = []` coercion used for `countWords`/`extractImageIds` while raw `snapshot.content` is persisted. Divergent inputs; schema tolerates missing `content` so benign now.
- **`packages/shared/src/tiptap-text.ts:494-611` + `search.service.ts:32`** — `REGEX_DEADLINE_MS` is a *between-exec* budget, not wall-clock. A single pathological `re.exec` blocks the event loop well past the deadline. Document the limitation (the naming overpromises) or move regex execution to a worker thread / re2. *(Security, Logic-Server)*
- **`packages/shared/src/tiptap-text.ts:643-651`** — `outputChars` cap counts only expanded replacements, not pass-through slices. Effective ceiling is ~2× the documented cap (post-hoc byte check still catches the total).
- **`packages/client/src/hooks/useProjectEditor.ts:256`** — chapter switch wipes `saveErrorMessage`; user loses visibility that the old chapter's save failed. Pre-existing behavior, amplified by the new cache-clearing paths.
- **`packages/client/src/hooks/useFindReplaceState.ts:207-223`** — debounced `setTimeout` captures `slug` at schedule time; a rename between schedule and fire targets old slug. Low probability but fixable by reading `latestSlugRef.current` inside the timer.
- **`packages/client/src/components/ConfirmDialog.tsx:23-29`** — no pre-open focus capture; on close focus returns to `<body>`. Keyboard users lose their spot after the new Replace-All confirm.
- **`packages/client/src/api/client.ts:62-77`** — non-JSON error bodies leave `code` undefined; code-keyed mappers silently fall through. Low-probability; matters behind reverse proxies that emit HTML error pages.
- **`packages/server/src/search/search.service.ts:64-74`** — hardcoded English `"(empty)"` ends up in user-visible snapshot labels; CLAUDE.md requires strings externalized.
- **`packages/client/src/hooks/useFindReplaceState.ts:80-97`** — `null → "uuid"` projectId transition wipes query/replacement. Benign today (no URL hydration); seed the ref from first non-null value.
- **`packages/server/src/snapshots/content-hash.ts:26` + `packages/shared/src/tiptap-text.ts:394`** — duplicate `UNSAFE_KEYS`/canonical walkers across two files; drift risk. Also filters `"prototype"` and `"constructor"` as own-property keys (bracket-set is safe for those); over-broad but defense-in-depth. *(Contract, Error-handling)*
- **`packages/shared/src/schemas.ts:168-179`** — `sanitizeSnapshotLabel`'s surrogate pass depends on ordering relative to the non-char pass. Any future reorder produces orphan surrogates; pin with a test.
- **Three tree-walkers diverge in contract:** `packages/shared/src/wordcount.ts:25`, `packages/shared/src/tiptap-text.ts:77`, `packages/server/src/images/images.references.ts:30` each independently recurse on TipTap, with different depth/filter handling. A new node type added to one will silently drift the others — and `countWords` client/server agreement is load-bearing per CLAUDE.md.
- **`packages/server/src/search/search.service.ts:332-381`** — `skipped_chapter_ids` is always set in the inner tx result (possibly empty) and stripped at the outer wrapper; `ReplaceResult` type documents "omitted when empty." Enforce at serialization boundary.
- **`packages/server/src/search/search.service.ts:45-49`** — `SEARCH_ERROR_CODES` re-export from `search.service.ts` has zero non-test callers; the comment claims "existing call sites" that don't exist. Delete.
- **`packages/client/src/hooks/useFindReplaceState.ts:6-10`** — hand-rolled `SearchOptionsShape` drifts from shared `SearchOptions` (missing `deadline`). Derive via `Required<Omit<SearchOptions, "deadline">>` so additions propagate.
- **`packages/server/src/search/search.service.ts:32`** — `REGEX_DEADLINE_MS` is server-only; move to `@smudge/shared/constants.ts` alongside other caps in case it's ever exposed.
- **`packages/shared/src/tiptap-text.ts:678-680`** — `cloneTextNodes` for no-match runs bypasses `cleanupTextNodes`. Over many replace-ones, fragmentation can accumulate; could drift `countWords` vs what TipTap recoalesces on next render.
- **`packages/client/src/api/client.ts:315` + `packages/shared/src/types.ts:28`** — server always sets `status_label` (via `enrichChapterWithLabel` or fallback) but `Chapter.status_label` is typed optional. Stricter-than-typed contract; make it required or centralize enrichment.
- **`packages/server/src/search/search.service.ts:297-305` + `packages/server/src/snapshots/snapshots.service.ts:36-39`** — replace-all auto-snapshot path never dedups by hash (`getLatestContentHash` filters `is_auto: false`). In practice pre-replace content differs each time, but a future call path could produce identical back-to-back auto-snapshots. Consider hash-based dedup against the latest snapshot regardless of kind.
- **`packages/client/src/hooks/useProjectEditor.ts:273-308`** — `reloadActiveChapter` reads `activeChapterRef.current` at run time, not at call time. A chapter switch between call and GET can apply wrong content. Guarded by `selectChapterSeqRef` (both paths bump the same ref), so the race window is narrow.
- **`packages/client/src/hooks/useProjectEditor.ts`** — `saveSeqRef` conflates "chapter changed" and "new save for the same chapter." Concurrent `flushSave` contenders (Ctrl+P + Alt+Up) can spuriously mark the first as "save failed" when the second bumps the ref.
- **PATCH-vs-restore request ordering** — abort is client-side only; the server serializes by arrival, not intent. A PATCH commit landing *after* a restore commit silently overwrites the restore. Add an `If-Match`/version header or rely on auto-snapshot-on-every-PATCH for recoverability.
- **`packages/server/src/snapshots/snapshots.service.ts:46`** — `createSnapshot` service accepts `label` without re-sanitizing; routes sanitize via `CreateSnapshotSchema`. Defense-in-depth only (one route caller today).

## Plan Alignment

**Plan documents consulted:**
- `docs/plans/2026-04-16-snapshots-find-replace-design.md`
- `docs/plans/2026-04-16-snapshots-find-replace-plan.md`

**Implemented:** All 19 substantive plan tasks — migration 014, types/Zod schema, project-store interface + repository, snapshot service (with dedup guard, image ref diff, word-count recalc in a transaction), snapshot routes (all 5 endpoints), cascade on chapter purge (via `ON DELETE CASCADE` FK), Ctrl/Cmd+S interception, snapshot API client, SnapshotPanel UI, snapshot view mode + restore flow, snapshot e2e, TipTap text walker (`tiptap-text.ts`), search/replace service, search routes, search API client, FindReplacePanel UI + hook, Ctrl+H handler, magnifying-glass toolbar button, panel exclusivity, flushSave-before-replace, affected-chapter reload, find-replace e2e. Error taxonomy (`MATCH_CAP_EXCEEDED`, `REGEX_TIMEOUT`) wired through the full stack.

**Not yet implemented:** Task 20 ("Coverage & Cleanup") is a sweeping step — nothing obviously missing from the feature surface.

**Deviations:**
- **Replace-one is server-side, not client-side.** Plan Task 18 Step 3 described an in-editor TipTap replace; implementation routes through `POST /replace` with `scope: { type: "chapter", chapter_id, match_index }` (`EditorPage.tsx:453`, `search.service.ts:262`). This matches the **design doc** explicitly (design 128-130) — plan/design mismatch resolved in favor of design.
- **Chapter purge cascade uses FK `ON DELETE CASCADE`** (migration 014 line 9) rather than the plan's `deleteSnapshotsByChapter` store method. Functionally equivalent; the named store method does not exist.
- **No separate `search.types.ts`** file (plan Task 13) — types live inline in `search.service.ts`. Minor.

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness (Server)
  - Logic & Correctness (Client)
  - Error Handling & Edge Cases
  - Contract & Integration
  - Concurrency & State
  - Security
  - Plan Alignment
- **Verifier:** single-pass confirmation against current code
- **Scope:** 43 changed source files (server + shared + client) plus adjacent callers one level deep. Tests, e2e, generated docs, and prior review artifacts excluded.
- **Raw findings:** 39 (before verification)
- **Verified findings:** 33 (2 Critical, 7 Important, 24 Suggestions)
- **Filtered out:** 6 (duplicates merged, or rejected as not present in current code — notably the image URL regex finding, which was invalidated by the client never appending file extensions)
- **Steering files consulted:** `CLAUDE.md` (repo root)
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
