# Semantic Duplicate Code Hunt: ovid/experimental-dedup

**Date:** 2026-04-28 08:02:18
**Repository:** /workspace (Smudge — TypeScript monorepo)
**Scope:** Full repo (`packages/{shared,server,client}`); `.devcontainer/`, `dist/`, `coverage/`, `node_modules/` excluded
**Commit:** 093074c (working tree clean)
**Mode:** full scan

## Executive Summary

One critical and five important semantic duplicates verified across the editor pipeline, type/constraint layer, and client hooks/dialogs. The single highest-leverage fix is the duplicated TipTap extension config (a parity test exists, which is itself the smell). Two hook-level findings (title editing, dialog lifecycle) were independently flagged by two specialists, raising confidence in their reality but also in the need to extract carefully — both have load-bearing differences. Two candidates were rejected after verification (snapshot-label sanitizer scope, schema-vs-DB length cap), and one was downgraded from Important to Suggestion (AbortController vs `useAbortableSequence` solve different problems).

## Findings by Severity

### Critical Issues

#### [C1] TipTap extension config duplicated client⇄server with a parity test

- **Canonical concept:** TipTap extension list (StarterKit no-heading + Heading levels 3-5 + Image inline:false/allowBase64:false) used by both the live editor and `generateHTML()` for export.
- **Duplicate locations:**
  - `packages/client/src/editorExtensions.ts:10` — `editorExtensions`
  - `packages/server/src/export/editorExtensions.ts:10` — `serverEditorExtensions`
- **Why these are semantically duplicate:** Byte-for-byte identical configuration objects. Both file headers explicitly state the configs "must match" and a test (`packages/server/src/__tests__/editorExtensions.test.ts`) renders a reference doc through both and asserts identical HTML.
- **Important differences:** None. Differ only in the exported symbol name and which package consumes them.
- **Impact:** Adding an extension to one side without the other silently changes export rendering vs editor display. The parity test catches the divergence after the fact, but the maintenance contract belongs in code, not in a test asserting two literals match.
- **Suggested consolidation:** Move the array to `packages/shared/src/editorExtensions.ts`; both files become one-line re-exports. The parity test becomes unnecessary (or collapses to a sanity import-check).
- **Confidence:** High (95)
- **Found by:** Semantic Equivalence specialist; verified.

### Important Issues

#### [I1] Title-editing hooks duplicate the same edit/cancel/commit state machine

- **Canonical concept:** Inline title editing — enter edit mode, escape-cancel sentinel that blocks blur-save, `isSavingRef` re-entry guard, `prevIdRef` stale-draft discard on context switch, trim-and-compare-before-handler, keep modal open on error.
- **Duplicate locations:**
  - `packages/client/src/hooks/useChapterTitleEditing.ts` (105 lines)
  - `packages/client/src/hooks/useProjectTitleEditing.ts` (119 lines)
- **Why these are semantically duplicate:** ~85% line-by-line identical; same refs, same lifecycle, same gates (`isActionBusy`, `isEditorLocked`).
- **Important differences:** The project hook adds (a) a `project.slug !== slug` drift check covering the slug-change race during save, and (b) a `navigate(newSlug)` step on successful rename. Both differences are load-bearing — slugs don't apply to chapters.
- **Impact:** Bug fixes (e.g., a future Escape race or busy-gate tightening) require synchronized edits in two files. Tests on one path don't cover the other.
- **Suggested consolidation:** Extract a generic `useInlineTitleEditing(currentId, save, gates, options?)` exposing `editing/draft/error/inputRef/start/save/cancel`. Pass an optional `onAfterSave(result)` callback for project-side navigation, and an optional `driftCheck` predicate for the slug guard. The two existing hooks become 10–20 line wrappers.
- **Confidence:** High (90)
- **Found by:** Sanitization specialist + Hook specialist (cross-confirmed); verified.

#### [I2] Dialog Escape / focus / click-outside lifecycle duplicated across five dialogs

- **Canonical concept:** Show-on-mount → focus a primary actionable element → Escape closes (sometimes with `stopImmediatePropagation`) → backdrop click closes.
- **Duplicate locations:**
  - `packages/client/src/components/ConfirmDialog.tsx:23–47` — Escape with `stopImmediatePropagation`, focus cancelRef, backdrop check
  - `packages/client/src/components/ExportDialog.tsx:40,60,77` — show/close on `open` prop (also wrapped in try/catch at `:66–69` for happy-dom), focus cancelRef, plain Escape
  - `packages/client/src/components/NewProjectDialog.tsx:16–24` — show/close on prop; relies on browser's native Escape
  - `packages/client/src/components/ProjectSettingsDialog.tsx:160–179` — show/close wrapped in try/catch (happy-dom)
  - `packages/client/src/components/ShortcutHelpDialog.tsx:12–20` — show/close + click-outside
- **Why these are semantically duplicate:** Same three affordances reimplemented per dialog with arbitrary inclusions/exclusions: some attach manual Escape listeners, others rely on browser default; some use `stopImmediatePropagation`, others don't; happy-dom guard is present in **two** files (`ExportDialog` and `ProjectSettingsDialog`); ARIA roles vary.
- **Important differences (load-bearing):**
  - `ConfirmDialog` calls `stopImmediatePropagation` on Escape to keep the find-replace panel's listener from also handling it.
  - `ProjectSettingsDialog` is a slide-out, not a centered modal, with happy-dom-safe `showModal/close` wrapped in try/catch.
  - `ExportDialog` is a centered modal but also wraps `showModal()` in try/catch for happy-dom safety — same guard, different shape.
  - The remaining two (`NewProjectDialog`, `ShortcutHelpDialog`) are vanilla.
- **Impact:** Accessibility variance (focus management, ARIA), test-environment fragility, and silent drift in keyboard semantics. New dialogs are likely to copy whichever neighbor they were spawned from rather than a single policy.
- **Suggested consolidation:** Extract `useDialogLifecycle(dialogRef, { open, onClose, initialFocusRef, blockEscapePropagation, safeShowClose, role })`. The `safeShowClose` opt-in (or an always-on try/catch around `showModal()`/`close()`) absorbs the happy-dom guard that exists in `ExportDialog` and `ProjectSettingsDialog`. Migrate one dialog at a time, behind characterization tests; do not force `ProjectSettingsDialog` into the same hook unless its slide-out positioning truly factors out (it may not).
- **Confidence:** Medium-High (75)
- **Found by:** Hook specialist; verified with caveat — extraction is justified but must preserve `stopImmediatePropagation` and happy-dom behavior as opt-ins.

#### [I3] `Chapter.status` typed as `string` while schema is a `z.enum` of 5 values

- **Canonical concept:** The 5 chapter lifecycle states (`outline | rough_draft | revised | edited | final`).
- **Duplicate locations:**
  - `packages/shared/src/types.ts:27` — `Chapter.status: string`
  - `packages/shared/src/types.ts:50` — `ChapterStatusRow.status: string`
  - `packages/shared/src/schemas.ts:10` — `ChapterStatus = z.enum([...])`
- **Why semantically duplicate:** Two declarations of the same value set; the TS interface is the looser denotation (any string).
- **Relationship:** Drift (string ⊃ enum).
- **Impact:** TypeScript silently accepts `chapter.status === "published"` typos; refactors that iterate over the literal set must reach for the schema rather than the type. Runtime is safe (Zod gates write paths), but the type system is not load-bearing here when it should be.
- **Suggested consolidation:** `export type ChapterStatusValue = z.infer<typeof ChapterStatus>;` in `schemas.ts`; replace `status: string` with `status: ChapterStatusValue` in both interfaces. No DB or API change.
- **Confidence:** High (85)
- **Found by:** Type & Constraint specialist; verified.

#### [I4] Two TipTap-JSON canonicalizers with shared "sort keys + strip unsafe keys" rule

- **Canonical concept:** Produce a stable, prototype-pollution-safe representation of a TipTap JSON subtree by sorting object keys and dropping `__proto__ / prototype / constructor`.
- **Duplicate locations:**
  - `packages/shared/src/tiptap-text.ts:496–513` — `CANONICAL_UNSAFE_KEYS` + `canonicalJSON()` (returns serialized string; used by `marksEqual()` for find-and-replace mark comparison)
  - `packages/server/src/snapshots/content-hash.ts:26–39` — `UNSAFE_KEYS` + `canonicalize()` (returns object; serialized + SHA-256'd by the caller for snapshot deduping)
- **Why semantically duplicate:** Same unsafe-key set, same key-sort policy, same depth guard. Different return shape (string vs object) and different failure mode on depth exceed (`"null"` vs throw `CanonicalizeDepthError`), but the canonicalization rule is the same and a future change (e.g., adding `__defineGetter__` to the unsafe set) needs to land in both.
- **Suggested consolidation:** Export `CANONICAL_UNSAFE_KEYS` and a thin `canonicalize(value, depth, onDepthExceeded)` from a new `packages/shared/src/canonicalize.ts`. Both call sites pass their own `onDepthExceeded` handler (return `"null"` vs throw); the unsafe-key list is owned in one place.
- **Confidence:** Medium-High (78)
- **Found by:** TipTap specialist; verified — full extraction blocked by return-type mismatch, but the unsafe-key set is trivially shareable.

#### [I5] Depth-guarded TipTap traversal reimplemented across four sites

- **Canonical concept:** Walk a TipTap JSON tree, abort the recursion at `MAX_TIPTAP_DEPTH = 64` to avoid stack overflow on adversarial or legacy-corrupted documents.
- **Duplicate locations:**
  - `packages/shared/src/tiptap-depth.ts` — `validateTipTapDepth()` (canonical depth-only check)
  - `packages/shared/src/wordcount.ts:25–42` — `extractText()` walks with own depth counter
  - `packages/server/src/snapshots/content-hash.ts:28–39` — `canonicalize()` walks with own depth counter
  - `packages/server/src/images/images.references.ts:54–70` — `walk()` walks with own depth counter
- **Why semantically duplicate:** All four import `MAX_TIPTAP_DEPTH` from the canonical module but reimplement the recursion (each does its own `if (depth > MAX_TIPTAP_DEPTH) <bail>`).
- **Important differences:** Each callee performs different work *during* the walk (text accumulation / canonicalization / image-ref collection). Bail action differs (return `""`, throw, return `void`).
- **Suggested consolidation:** **Less obvious than it looks** — verifier warned that extracting a callback-based walker risks weakening per-callee invariants (e.g., images.references' regex filter is intertwined with the walk). Recommend: keep traversals separate; add a lint or contract test asserting all walkers honor `MAX_TIPTAP_DEPTH`. If extraction is desired later, prefer a generator (`for (const node of walk(doc)) {...}`) that yields nodes with depth, leaving the per-call work at the call site.
- **Confidence:** Medium (72)
- **Found by:** TipTap specialist; verifier downgraded the consolidation strength.

### Suggestions

- **[S1]** ProjectSettingsDialog and ExportDialog hand-roll `AbortController` + `signal.aborted` checks rather than threading through `useAbortableSequence`. After verification this is **not** a duplicate of the hook — `useAbortableSequence` solves response-staleness, `AbortController` solves network-cancellation. Both are correct uses. If a future refactor wants both, a `useAbortableSequence` overload that also exposes a `signal` would be a reasonable addition.
- **[S2]** `author_name` column is unbounded `text` in migration `011_add_author_name.js` while the schema caps at 500. Standard API-cap-with-permissive-DB pattern; flag only if a hardening pass is undertaken.
- **[S3]** Chapter status is seeded by migration 003 (with `sort_order` and `label`) and *also* declared as a Zod enum (values only). DB is the source of truth for UI labels (via `/api/chapter-statuses`); enum exists for input validation. Two views of the same set; document the sync requirement in `CLAUDE.md` rather than refactoring.

## Type and Constraint Equivalence Notes

| Concept | Location A | Location B | Relationship | Risk | Recommendation |
|---------|------------|------------|--------------|------|----------------|
| Chapter status value set | `types.ts:27` `Chapter.status: string` | `schemas.ts:10` `ChapterStatus = z.enum(...)` | drift (string ⊃ enum) | medium | Replace with `z.infer` alias (I3) |
| Chapter status row status | `types.ts:50` `ChapterStatusRow.status: string` | `schemas.ts:10` enum | drift | low | Same alias as above |
| Author name length | `schemas.ts:35–40` `.max(500)` | migration 011 `text` | superset (DB > schema) | low | Standard pattern; document only |
| Snapshot label sanitizer | `schemas.ts:133` `sanitizeSnapshotLabel` | `snapshots/labels.ts:16` `buildAutoSnapshotLabel` (calls it) | canonical (single source) | none | No action |
| TipTap MAX depth | `tiptap-depth.ts:19` constant | imported by 4 walkers | exact (single source) | low | Walkers reimplement traversal but share the constant; keep |
| TipTap canonicalization unsafe keys | `tiptap-text.ts:496` `CANONICAL_UNSAFE_KEYS` | `content-hash.ts:26` `UNSAFE_KEYS` | exact denotation, different names | medium | Share the set (I4) |

## Rejected Candidate Duplicates

| Candidate | Reason rejected |
|-----------|-----------------|
| Apply `sanitizeSnapshotLabel` to `author_name`, `alt_text`, `caption`, `source`, `license` | Over-aggressive: the label sanitizer is tuned for short list-row text where bidi/zero-width can spoof display. Image alt-text and captions legitimately carry RTL marks, accents, and zero-width joiners (Arabic/Hindi). Source URLs fail differently. The right hardening for these fields is per-field policy, not the snapshot sanitizer. |
| `parseChapterContent` (chapters repo) vs snapshots-service depth validation | Different concerns: repo parses string→object; service validates depth. Same primitive (`JSON.parse`), different domain contract. |
| Word-count client (display) vs server (persisted) | Both call shared `countWords()`. Correct architecture, not duplication. |
| `ProjectMode` enum redeclaration | Single source in `schemas.ts`; `types.ts` imports the inferred type. Compliant. |
| Image UUID lowercasing in 3 sites | Lowercase is applied at *comparison* time and the regex is case-insensitive; the duplication is small and defensible. Suggestion at most; not actionable. |
| `useAbortableSequence` vs ProjectSettingsDialog/ExportDialog `AbortController` | Different concerns (staleness vs network-cancel). Hand-rolling is correct (see S1). |
| Trim-and-clamp pattern across schemas + hooks | Defense-in-depth (server-authoritative + client-UX) is the documented pattern. Not a duplicate. |
| `editorSafeOps.ts` `setEditable` wrapping | Single canonical try/catch wrapper used everywhere relevant; not duplicated. |

## Consolidation Strategy

**Order of work, lowest-risk first:**

1. **C1 — TipTap extensions:** create `packages/shared/src/editorExtensions.ts`; replace both files with one-line re-exports; delete the parity test (or reduce to an import-equality assert). ~15 min, mechanical.
2. **I3 — Chapter status type:** add `type ChapterStatusValue = z.infer<typeof ChapterStatus>` and update two interfaces. Run `tsc` and the test suite; surface any callers comparing against unknown literals. ~30 min.
3. **I4 — Shared unsafe-key set:** export `CANONICAL_UNSAFE_KEYS` from a new `packages/shared/src/canonicalize.ts`; both sites import. Don't try to share the full canonicalizer (return-type mismatch). ~30 min.
4. **I1 — `useInlineTitleEditing`:** add characterization tests for both existing hooks first; extract the shared state machine; rewrite the two hooks as wrappers; verify all callers and tests. 1–2 hours.
5. **I2 — `useDialogLifecycle`:** start with the two manually-Escape'd dialogs (`ConfirmDialog`, `ExportDialog`); preserve `stopImmediatePropagation` as an opt-in. Migrate `ProjectSettingsDialog` last (slide-out positioning may not factor cleanly). 2–3 hours.
6. **I5 — Walker consolidation:** **defer**. Add a regression test that constructs a depth-65 doc and asserts each of the four walkers bails safely. Revisit only if a fifth walker appears.

Each item is independently shippable; none requires a multi-PR sequence. Apply the one-feature rule from `CLAUDE.md` — these should not bundle.

## Review Metadata

- **Agents dispatched:** 4 specialists (TipTap pipeline, type & constraint, sanitization, client hooks) + 1 verifier
- **Files scanned:** ~90 source files across the three packages
- **Candidate pairs/groups discovered:** 18
- **Verified findings:** 9 (1 Critical, 5 Important, 3 Suggestions)
- **Rejected candidates:** 8
- **Cross-confirmed by ≥2 specialists:** I1 (title hooks), I2 (dialog lifecycle)
- **Generated/vendor paths excluded:** `dist/`, `node_modules/`, `coverage/`, `.devcontainer/`, `test-results/`, `playwright-report/`
- **Steering files consulted:** `CLAUDE.md` (save-pipeline invariants, mapApiError contract, one-feature PR rule, .devcontainer exclusion)
- **Tests consulted:** `editorExtensions.test.ts`, `tiptap-text.test.ts`, `content-hash.test.ts`, `parseChapterContent.test.ts`, `useChapterTitleEditing.test.ts`, `useProjectTitleEditing.test.ts`
