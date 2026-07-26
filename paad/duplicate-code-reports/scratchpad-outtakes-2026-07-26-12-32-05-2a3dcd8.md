# Semantic Duplicate Code Hunt: scratchpad-outtakes

**Date:** 2026-07-26 12:32:05
**Repository:** /Users/ovid/projects/smudge (Smudge — TypeScript monorepo)
**Scope:** Full repo (`packages/{shared,server,client}`, `scripts/`, `e2e/`); `.devcontainer/`, `node_modules/`, `dist/`, `coverage/` excluded
**Commit:** 2a3dcd8a5435566c2822e933559a681854cb6c1f (working tree clean before and after)
**Mode:** full scan

## Executive Summary

**This is not a degraded run** — all five specialists returned, and a single Verifier
pass confirmed every finding below against the running code. One **Critical** finding:
the "is this src a resolvable Smudge image reference?" rule is encoded four times, and
the DOCX encoding at `docx.renderer.ts:325` is **unanchored**, so it fails open where
its three siblings fail closed — demonstrated end to end through the real `createApp()`
by persisting `https://evil.example/api/images/<uuid>` via `PATCH /api/chapters/:id`
(200, stored verbatim) and unzipping the resulting DOCX to find the local image bytes
embedded, while every other export format drops the `<img>`. A second, wider finding
(**I-1**) fell out of verifying the first: `resolveImage` does no project scoping, so a
perfectly ordinary relative src pointing at another project's image embeds that
project's bytes in **all five** export formats.

The remaining six Important findings are drift with evidence, not speculation: two
TipTap walkers were skipped by a fail-closed guard round 15 minutes before this commit
(and the depth cap is consequently bypassable through the public API), the
`UPDATE_READ_FAILURE` "already committed" policy is declared for one of the three client
scopes that hit the endpoint emitting it, and a 415 escapes the documented status
allowlist entirely. Nine of the eleven Suggestions are net deletions or two-line
changes.

The prior two passes' findings have all landed; nothing here re-raises them. Verification
**refuted one specialist claim outright** and corrected three others — see
§Specialist Corrections, which matters for how much weight to give each lens next time.

## Findings by Severity

### Critical Issues

#### [C1] "Is this src a resolvable image reference?" encoded 4×, and the DOCX encoding fails open

- **Canonical concept:** recognising an `/api/images/<uuid>` reference in stored TipTap
  content and deciding whether it may be resolved to local image bytes.
- **Duplicate locations:**
  - `packages/server/src/export/docx.renderer.ts:325` — `new RegExp("/api/images/(" + UUID_PATTERN + ")", "i")` inside `blockToParagraphs` `case "image"`. **Unanchored, no host restriction, rebuilt per node.**
  - `packages/server/src/export/export.renderers.ts:46-47` — `ALLOWED_IMAGE_SRC`, anchored `^…$`, relative-only. Applied by `stripDisallowedImages` (`:49-54`) from `chapterContentToHtml` (`:72`).
  - `packages/server/src/images/images.paths.ts:15` — `IMAGE_SRC_REGEX`, requires the literal `src="` prefix, relative-only. Drives `resolveImageSrcs` (`packages/server/src/export/image-resolver.ts:97-98`).
  - `packages/server/src/images/images.references.ts:36-39` — `IMAGE_SRC_RE`, anchored, optional `https?://host`, requires a path terminator. Refcount matcher.
- **Why these are semantically duplicate:** all four answer the same question about the
  same field (`attrs.src` on a TipTap `image` node, or its rendered `<img src>`). Three
  fail closed on a non-relative src; the fourth extracts a UUID from anywhere in the
  string and resolves it.
- **Impact — CONFIRMED end to end** (real `createApp()`, Supertest, real SQLite, real
  image files, DOCX unzipped):

  | stored `src` | `PATCH /api/chapters/:id` | DOCX output | HTML output |
  |---|---|---|---|
  | `https://evil.example/api/images/<uuid>` | 200, persisted verbatim | `word/media/…png` — **local bytes embedded** | `<img>` dropped |
  | `https://evil.example/?ref=/api/images/<uuid>/x` | 200, persisted verbatim | `word/media/…png` — **local bytes embedded** | `<img>` dropped |
  | `javascript:x/api/images/<uuid>` | 200, persisted verbatim | `word/media/…png` — **local bytes embedded** | `<img>` dropped |

  No upstream guard exists. `TipTapDocSchema` (`packages/shared/src/schemas.ts:48-56`)
  is `.passthrough()` with `content: z.array(z.record(z.unknown()))`, so `attrs.src` is
  never validated; `export.service.ts:58-63` copies content straight through to
  `renderDocx`; `tipTapToParagraphs` (`docx.renderer.ts:410-429`) calls only
  `stripNoteMarks`. Row 2 is the sharpest: the refcount matcher **rejects** that shape,
  so DOCX embeds an image whose `reference_count` was never incremented and which the
  reaper considers unreferenced.
- **Important differences:** the four regexes serve genuinely different jobs and must
  **not** be unified into one pattern — `IMAGE_SRC_REGEX` needs the `src="` prefix
  because it scans generated HTML, and `IMAGE_SRC_RE` deliberately accepts an absolute
  host (the accepted F-16 pair, documented at `images.references.ts:21-35`). The defect
  is narrow: the DOCX walker is missing the *allowlist decision*, not a shared regex.
- **Suggested consolidation:** anchor the DOCX check — import `ALLOWED_IMAGE_SRC` (or a
  shared `isResolvableImageSrc(src)` in `export/`) and gate `docx.renderer.ts:321-329`
  on it before extracting the UUID. This is the DOCX walker's own equivalent of the
  `stripDisallowedImages` pass the other formats get, exactly parallel to how it already
  carries its own `stripNoteMarks` (documented at `docx.renderer.ts:415-421`). Add a
  `renderDocx` hostile-src test: `export.renderers.test.ts:63-95` covers this for
  `chapterContentToHtml` only, and no `renderDocx` test anywhere passes a non-relative src.
- **Relationship:** overlapping; DOCX's accepted set is a strict **superset** of the other three.
- **Confidence:** 96 — **CONFIRMED**
- **Found by:** Semantic Equivalence; family also hit by Domain Boundary and Refactoring Safety
- **Honest caveat:** Smudge is single-user with no auth, so there is no cross-tenant
  exposure. The exposure is that a file the writer hands a beta reader contains bytes
  every other export format deliberately withholds — and that the comment at
  `export.renderers.ts:32-45` asserting client and export "both fail closed" is factually
  false on the DOCX path.

### Important Issues

#### [I1] "An image reference must belong to the exporting project" encoded 2×, absent at the third site

- **Canonical concept:** an image id found in chapter content is honoured only if
  `image.project_id` matches the project being operated on.
- **Locations:**
  - `packages/server/src/images/images.references.ts:158-166` (`applyImageRefDiff` add path) and `:170-174` (remove path) — `if (!image || image.project_id !== projectId)` → warn + skip the refcount update.
  - `packages/server/src/export/epub.renderer.ts:87` — `if (row && row.project_id === project.id)` → refuse the row as an EPUB cover.
  - **Absent:** `packages/server/src/export/image-resolver.ts:33-38` (`resolveImage`) — no project parameter at all.
- **Why semantically duplicate:** one ownership rule, three sites that must answer it;
  the codebase demonstrably knows the rule and applies it in one of three
  image-resolution paths.
- **Impact — CONFIRMED empirically.** Projects A and B; image only in B; referenced from
  a chapter in A using the **fully legitimate relative form** `/api/images/<B-uuid>`;
  exported A. DOCX: `word/media/…png` present. HTML: `data:image/png;base64,…` present.
  B's bytes embedded in A's export. Unlike C1 this affects **all five formats** and needs
  no hostile src — a stale paste between projects suffices. `applyImageRefDiff` sees it,
  logs `"Referenced image missing or in different project; skipping reference-count
  update"`, and lets the content through; the export path resolves it anyway.
- **Important differences:** the three sites have three *deliberately* different
  remediations (skip-refcount / refuse-cover / nothing). Only the third looks like an omission.
- **Suggested consolidation:** give `resolveImage` a `projectId` parameter and return
  `null` on mismatch — the caller already has `projectInfo.id`, and `ImageSource` is
  already a narrow injected interface, so this is a one-argument widening. Do **not**
  share code with `applyImageRefDiff`; its warn-and-continue policy is intentional and documented.
- **Relationship:** subset — the export path implements a strict subset (nothing) of the rule.
- **Confidence:** 88 — **CONFIRMED**
- **Found by:** Semantic Equivalence (as a supporting sub-claim; promoted by the Verifier
  to a separate finding — distinct rule, distinct fix, wider blast radius)
- **Note:** would be Critical under multi-tenancy; single-user caps it at Important.

#### [I2] "Fail closed on a child this walker cannot descend into" encoded 6×; 2 sites lack the array arm

- **Canonical concept:** because `TipTapDocSchema` validates top-level elements only and
  DB reads bypass Zod, every TipTap walker must treat a `null` / primitive / **array**
  child as absent rather than descend into it.
- **Has the array arm:** `packages/shared/src/tiptap-images.ts:11`,
  `packages/shared/src/tiptap-plaintext.ts:30`, `packages/shared/src/wordcount.ts:39`,
  `packages/server/src/images/images.references.ts` (`extractImageIds`).
- **Missing it:** `packages/shared/src/tiptap-notes.ts:56` and
  `packages/shared/src/tiptap-safety.ts:30` (`validateTipTapDepth`) — both
  `if (!node || typeof node !== "object")`.
- **Impact — CONFIRMED empirically.** Over `{type:"doc",content:[[notedTextNode]]}`:

  ```
  stripNoteMarks(array-wrapped): {"type":"doc","content":[{"0":{"type":"text","text":"SECRET",
                                  "marks":[{"type":"note","attrs":{"text":"spoiler"}}]}}]}
  stripImageNodes(array-wrapped): {"type":"doc","content":[]}
  ```

  The note mark survives the strip; the sibling image walker drops the equivalent node.
  **The sharper consequence, found during verification:** the `validateTipTapDepth` gap
  is **API-reachable and breaks the depth cap.** A *top-level* array child is rejected by
  Zod, but a **nested** one is not, because only top-level `content` is typed:

  ```
  validateTipTapDepth(nested-array 5000 deep):    true    ← should be false
  PATCH /api/chapters/:id, 300-deep nested-array  → 200
  POST snapshot → 201,  export html → 200
  ```

  So `MAX_TIPTAP_DEPTH` is bypassable through the public API, and the comment shared
  verbatim across five walkers — *"Unreachable via the API (Zod rejects depth >
  MAX_TIPTAP_DEPTH)"* — is false, as is `tiptap-notes.ts:59-63`'s claim that *"Every
  sibling walker fails closed too"*.
- **Git corroboration (verified):** `fd574f1` (2026-07-26 10:41, "guard TipTap walkers
  against unvalidated child shapes (I1)") `--stat` shows `tiptap-images.ts`,
  `tiptap-plaintext.ts`, `wordcount.ts`, `images.references.ts` — and **not**
  `tiptap-notes.ts` or `tiptap-safety.ts`. Fifteen minutes before HEAD.
- **Also noted:** `collectLeafBlocks` (`packages/shared/src/tiptap-text.ts:82-85`) fails
  closed for arrays only **incidentally**, via `Array.isArray(node.content)` being false.
- **Suggested consolidation:** add `|| Array.isArray(node)` to both sites. Do **not**
  extract a shared `isDescendable()` — six one-line guards with six site-specific
  fail-closed return values (`undefined` / `null` / `[]` / `false` / `continue` /
  `return`) is cheaper and clearer than a helper that cannot express the return value.
  The forcing mechanism should be a **test**: a table over all six walkers feeding
  `{type:"doc",content:[[child]]}` and asserting each degrades. That test would also have
  caught the depth bypass.
- **Relationship:** equivalent rule, two incomplete encodings.
- **Confidence:** 92 — **CONFIRMED**
- **Found by:** Divergence Risk only (no corroboration; the Verifier re-derived it from
  scratch, and it came back **stronger** than reported)
- **Severity note:** not Critical — no live confidentiality leak today, because the
  surviving mark does not reach a rendered surface. But a documented confidentiality
  guarantee now rests on a false premise, and the depth cap is genuinely bypassable.

#### [I3] `UPDATE_READ_FAILURE` means "committed" — declared for 1 of the 3 client scopes hitting the emitting endpoint

- **Canonical concept:** `PATCH /api/chapters/:id` returning `500 UPDATE_READ_FAILURE`
  means *the write landed, the read-back did not* — treat as committed; do not revert,
  do not invite retry.
- **Locations:**
  - Emitter: `packages/server/src/chapters/chapters.routes.ts:38-43`.
  - Source: `packages/server/src/chapters/chapters.service.ts:117-118` — **unconditional**; fires whichever field was in the update (`updates` built at `:71-89`).
  - Declared: `packages/client/src/errors/scopes.ts:192` (`byCode`), `:198` (`committedCodes`), `:209` (`terminalCodes`) — scope `chapter.save` **only**.
  - **Absent:** `scopes.ts:245-249` (`chapter.rename`), `scopes.ts:262-266` (`chapter.updateStatus`) — both declare `committed:` copy but no `byCode` / `committedCodes`.
- **Mechanism confirmed** (`packages/client/src/errors/apiErrorMapper.ts:88-103`,
  `:139-141`): the 2xx-`BAD_JSON` early return cannot fire for a 500, and
  `possiblyCommitted` on the byCode path requires `scope.committedCodes?.includes(err.code)`.
  So the `committed:` copy these two scopes *do* declare is unreachable for this code.
- **Impact:** on rename (`packages/client/src/hooks/useChapterMetadata.ts:340-386`),
  `setProject`/`setActiveChapter` run **only in the success path** (`:357-369`) — so on
  `UPDATE_READ_FAILURE` the DB holds the new title, the sidebar keeps the old one, and
  the user is told `renameChapterFailed` ("try again"). Silent, unreconciled divergence
  between UI and server.
- **Important difference (a correction to the reporting specialist):** the *status* path
  is less severe than reported. The revert branch first attempts a recovery
  `api.projects.get(slug)` and adopts the server's truth (`:265-281`) — which for this
  code **is** the newly-written status — so the UI self-heals and `confirmedStatusRef`
  advances. The local-revert arm (`:294-307`) needs that GET to fail *too*. Real but
  conditional.
- **Supporting signal the omission is an oversight:** `CORRUPT_CONTENT` is correctly
  absent from these two scopes because `chapters.service.ts:139` gates it on
  `content !== undefined`. `UPDATE_READ_FAILURE` has no such gate — the asymmetry is not principled.
- **Suggested consolidation:** add `byCode` + `committedCodes: ["UPDATE_READ_FAILURE"]`
  to both scopes, and make the rename handler keep its optimistic title on
  `mapped.possiblyCommitted` (mirroring the status handler's I6 branch at `:235-243`).
  Better: since all three scopes front **one** endpoint, factor the shared chapter-PATCH
  code policy into a spreadable fragment in `scopes.ts` so a fourth caller cannot
  silently omit it.
- **Relationship:** subset — two scopes implement a strict subset of one endpoint's error contract.
- **Confidence:** 86 — **CONFIRMED** for rename; PLAUSIBLE for the status local-revert sub-case
- **Found by:** Type & Constraint Equivalence

#### [I4] HTTP status allowlist restated in `appError.ts`, unenforced in the handler; 415 escapes the taxonomy

- **Locations:**
  - `packages/server/src/errors/appError.ts:11-14` — comment restates the allowlist as "200, 201, 400, 404, 409, 413, 500". **Omits 204** (the uniform DELETE contract, live at `chapters.routes.ts:69`, `images.routes.ts`, `outtakes.routes.ts`, `projects.routes.ts`) **and the 503 `/api/health` carve-out** (`packages/server/src/app.ts:65`).
  - `packages/server/src/app.ts:97` — `const status = err.status ?? err.statusCode ?? 500;` → `res.status(status)` at `:125`. **No allowlist clamp.**
  - `app.ts:103-124` — status→code and status→message ladders re-encoding the mapping the `AppError` subclasses already own (`appError.ts:39-72`).
- **Impact — CONFIRMED against the real `createApp()`:**

  ```
  PATCH /api/chapters/<uuid>  Content-Type: application/json; charset=iso-8859-1
    → 415  {"error":{"code":"VALIDATION_ERROR","message":"Bad request."}}
  PATCH /api/chapters/<uuid>  Content-Type: application/json  Content-Encoding: br
    → 415  {"error":{"code":"VALIDATION_ERROR","message":"Bad request."}}
  ```

  Both are body-parser `UnsupportedMediaTypeError`s via `express.json({ limit })`
  (`app.ts:39`), passing through the unclamped `status` into the ladder's `else` arm —
  mislabelled `VALIDATION_ERROR`. Any body-accepting endpoint can emit a status outside
  the documented allowlist, and no client scope maps 415.
- **Important difference:** the `AppError` subclasses themselves are exactly the
  documented subset and never emit 2xx. The breach is entirely in the non-`AppError`
  fallback path — a *restated-and-unenforced* invariant, not drift inside the taxonomy.
- **Suggested consolidation:** clamp in the handler —
  `const status = ALLOWED.has(raw) ? raw : 500` (or map 415→400) — with `ALLOWED` sourced
  from one exported constant that the `appError.ts` comment *references* instead of
  restating. Then delete the prose restatement.
- **Relationship:** overlapping — one allowlist, three encodings (CLAUDE.md prose, the
  `appError.ts` comment, the `app.ts` ladders), with the enforcing site encoding none of them.
- **Confidence:** 90 — **CONFIRMED**
- **Found by:** Type & Constraint Equivalence

#### [I5] `stripCorruptFlag` exists to keep the corrupt-flag surface in sync; two sites inline it, one in the helper's own file

- **Locations:**
  - Canonical: `packages/server/src/chapters/chapters.types.ts:72-75`.
  - Inlined: `packages/server/src/chapters/chapters.service.ts:149` — **not type-forced**; `updated` is a `ChapterRow`, so `stripCorruptFlag(updated)` type-checks as-is.
  - Inlined: `packages/server/src/chapters/chapters.types.ts:110-111`, inside `enrichChaptersWithLabels` — partially type-forced by the generic overload.
- **Drift history — the strongest evidence in the run, verified by `git show --stat`:**
  - `e6fd38b` (2026-04-08) consolidated the inline sites onto the helper.
  - `b694a86` (2026-04-14) **re-introduced** an inline strip in `chapters.service.updateChapter`, six days later.
  - `bdb6c99` (2026-04-19) — "route restoreSnapshot enrichment fallback through stripCorruptFlag", whose own message says *"Any future field added to the corrupt-flag surface would have drifted between the two paths."* `--stat` shows **one file**: it fixed the identical shape in the identical position in `snapshots.service.ts` and did not touch the `chapters.service.ts` twin created 5 days earlier.

  The concept was consolidated, silently re-introduced, then half-fixed by a commit that
  articulated the exact risk.
- **Suggested consolidation (a net deletion):** widen the helper to
  `<T extends { content_corrupt?: unknown }>(row: T): Omit<T, "content_corrupt">`. Then
  `chapters.service.ts:149` becomes a call, and the `if ("content_corrupt" in ch)` branch
  at `chapters.types.ts:110` is **behaviorally redundant** (rest-destructuring an absent
  key omits nothing), so both arms collapse. Net: **removes** a branch.
- **Relationship:** equivalent.
- **Confidence:** 90 — **CONFIRMED**
- **Found by:** Divergence Risk, Semantic Equivalence, Refactoring Safety (three-way agreement)

#### [I6] "Valid JSON, wrong shape" guard added to snapshots (Apr) and outtakes (Jul), never to chapters

- **Locations:**
  - Guarded: `packages/server/src/outtakes/outtakes.repository.ts:14-22` — rejects `!parsed || typeof parsed !== "object" || Array.isArray(parsed)`; its comment says *"mirroring snapshots.service.ts."*
  - Guarded: `packages/server/src/snapshots/snapshots.service.ts:120-137` — `TipTapDocSchema` gate + byte cap.
  - **Unguarded:** `packages/server/src/chapters/chapters.repository.ts:14-30` (`parseContent`) — guards only the `JSON.parse` **throw**. A stored `"42"` / `"[]"` / `"null"` parses fine and returns `{...row, content: 42}` with **no** `content_corrupt: true`.
- **Consequence:** `isCorruptChapter` (`chapters.types.ts:68-70`) is false, so the row is
  served as healthy and the designed `CORRUPT_CONTENT` path
  (`chapters.routes.ts:22-27`, `:48-53`) **cannot fire** for a wrong-shape row.
- **Git corroboration (verified):** `a19e8aa` (2026-04-17, snapshots) and `5d3d495`
  (2026-07-26 10:53, outtakes) — three months apart, the second re-deriving the first's
  reasoning from scratch. `5d3d495`'s `--stat` shows 6 files, **none** of them
  `chapters.repository.ts`.
- **Bounded consequence (specialist discrepancy resolved):** inert on the server —
  `chapterContentToHtml` wraps `renderEditorHtml` in try/catch and returns `""`
  (`export.renderers.ts:71-76`), and every other walker fails closed. The stronger claim
  that it reaches `setContent` and throws concerns the **client** editor and was not
  exercised. Both specialists agree it is **not API-reachable** — reachability is a
  hand-edited DB, a restored backup, or a legacy row.
- **Test gap confirmed:** `packages/server/src/__tests__/parseChapterContent.test.ts` has
  8 cases; **none** passes a valid-JSON-wrong-shape value.
- **Suggested consolidation:** add the three-line shape guard *inside* `parseContent`,
  routed to the existing `content_corrupt: true` degrade, plus 3–4 tests. Do **not**
  extract a shared parser — the three sites have deliberately different degrade policies
  (corrupt-flag / empty-doc / reject-restore), documented at each, and the `ponytail:`
  comment at `outtakes.repository.ts:24-27` explains why outtakes chose differently.
- **Relationship:** subset — chapters implements a strict subset of the guard its siblings share.
- **Confidence:** 84 — **CONFIRMED**
- **Found by:** Divergence Risk, Semantic Equivalence

#### [I7] Resizable-panel separator (drag + arrow-key + ARIA bounds) implemented twice, verbatim

- **Locations:**
  - `packages/client/src/components/ReferencePanel.tsx:33-39` (cleanup ref + unmount effect) and `:48-90` (the separator).
  - `packages/client/src/components/Sidebar.tsx:330-336` and `:466-508`.
- **Why semantically duplicate:** near-verbatim — same `role="separator"` /
  `aria-orientation` / `aria-valuenow` / `aria-valuemin` / `aria-valuemax` /
  `tabIndex={0}`, the same Tailwind class string, the same `onMouseDown` closure
  (`startX` / `startWidth` / `onMouseMove` / `onMouseUp` / `cleanupResize` stored in a ref
  for the unmount effect), the same `Math.min(MAX, Math.max(MIN, …))` clamp, the same
  ±10 arrow step.
- **Important differences — only four, all parameterizable:** the min/max constants, the
  `aria-label`, the anchored edge (`left-0` vs `right-0`), and the drag/arrow sign (the
  reference panel is on the right, so `startWidth - dx` and ArrowLeft-grows).
- **Impact:** two invariants must agree per panel and can drift silently — the handler
  clamp vs the codec's `numberInRange` bounds, and `aria-valuemin/max` vs both. Today
  held only by importing shared `*_MIN/MAX_WIDTH` constants (`useSidebarState.ts:8-9`,
  `useReferencePanelState.ts:8-9`, each carrying a "do not inline them into the codec
  call" comment) — doc discipline, not a mechanism. An a11y fix applied to one panel
  leaves the other non-conformant, and CLAUDE.md makes WCAG 2.1 AA mandatory. No forcing
  test exists.
- **Suggested consolidation:** one `<ResizeSeparator edge min max value ariaLabel
  onResize />`. The sign is derivable from `edge`; removes ~45 duplicated lines and gives
  the a11y attributes a single owner.
- **Relationship:** equivalent.
- **Confidence:** 84 — **CONFIRMED**
- **Found by:** Domain Boundary & Intent
- **Note:** this does **not** conflict with the "leave the persisted-state hooks alone"
  verdict — that concerns `useReferencePanelState` vs `useSidebarState` (thin
  `usePersistedState` clients, correctly left alone). This is the separator JSX + drag
  handler, which in fact *depends* on those shared constants.

### Suggestions

- **[S1]** The 10 MB image-upload cap is a bare literal in three files with no
  cross-reference: `ImageGallery.tsx:19`, `images.routes.ts:15`, `images.service.ts:11`.
  All three *checks* are correct and must stay; the duplicated thing is the **number**.
  Export `MAX_IMAGE_UPLOAD_BYTES` from `packages/shared/src/constants.ts`, following the
  verified adjacent precedent at `constants.ts:20-27`. (84, CONFIRMED — Domain Boundary)
- **[S2]** `UUID_PATTERN` inlined in `export.renderers.ts:46-47` while sibling
  `export/docx.renderer.ts:17` imports the canonical constant from `images.paths.ts:12`.
  Server-vs-server inside one package, so F-16 does not cover it. Widening `UUID_PATTERN`
  would silently drop **every** `<img>` from every HTML/EPUB/markdown export. Two-line
  fix. (85, CONFIRMED — Refactoring Safety)
- **[S3]** `sanitizer.ts:101-102` and `export.renderers.ts:46-47` are **byte-identical**
  regex literals with a **one-way** cross-reference (export points at the client; the
  client points only at `images.references.ts`). Not the F-16 pair, whose bidirectional
  references were verified intact. Add the back-reference plus a parity test — the cited
  precedent (`constants.ts:5-18` + `__tests__/vite-config-default-port.test.ts`) is real
  and works as described. (80, CONFIRMED — Domain Boundary)
- **[S4]** `recordSave` is a **pure alias**: `velocity.service.ts:63-65` is
  `recordSave(projectId) { await updateDailySnapshot(projectId); }`, entire body, yet
  `VelocityServiceInterface` declares both so every test fake stubs two names for one
  behavior. Pure deletion. (88, CONFIRMED — Semantic Equivalence)
- **[S5]** The `Intl.Segmenter` fallback at `packages/server/src/utils/grapheme.ts:17` is
  **dead code** reimplementing the surrogate-splitting bug `truncateUnits` exists to
  prevent. Both premises verified: `package.json:5-7` pins `"node": "22.x"`, and
  `wordcount.ts:58` already calls `new Intl.Segmenter(...)` unguarded on every save path.
  Delete the branch and the `| null` union (−3 lines); it currently drags branch
  coverage. (90, CONFIRMED — three-way agreement)
- **[S6]** The pre-mutation auto-snapshot dedup block is duplicated with its ~10-line
  F-15 rationale comment at `snapshots.service.ts:183-205` and `search.service.ts:299-319`.
  Extract `insertAutoSnapshotIfChanged(txStore, chapter, content, label)` — four
  parameters, no flags. (78, CONFIRMED — see Conflict 2)
- **[S7]** `validateUuidParam.ts:15-19`'s docstring still says `chapters.routes.ts`
  "validates nothing" — falsified 9 minutes later by `c0a5c97`; chapters calls the helper
  at lines 16, 34, 61, 75. Fix the docstring. **Do not** consolidate the two validators:
  `c0a5c97` records a reasoned deferral, images' `router.use()` form is structurally
  *stronger* than the per-handler form, and the accepted domains genuinely differ (Zod
  enforces version/variant nibbles; the regex accepts any 32 hex nibbles). (88 docstring
  / 72 duplication, CONFIRMED — three specialists)
- **[S8]** `MAX_CHAPTER_CONTENT_BYTES` and `MAX_CHAPTER_CONTENT_LIMIT_STRING`
  (`packages/server/src/constants.ts:16-17`) restate one limit in two representations,
  with a comment saying they MUST agree and nothing asserting it. Fix is a **deletion** —
  body-parser accepts a numeric byte limit directly (verified at
  `node_modules/body-parser/lib/types/json.js:56-58`). (82, CONFIRMED — Type & Constraint)
- **[S9]** Chapter-status closed set encoded 4× (`schemas.ts:10`, migration `003:9-15`,
  two test restatements), with a redundant unreachable runtime validator at
  `chapters.service.ts:84-90` and no CHECK or FK on the column. Add an integration test
  asserting `ChapterStatus.options` equals the seed table. (76, CONFIRMED — Type & Constraint)
- **[S10]** "A purged project's children are removed" is enforced two ways (app-level
  deletes in `purge.ts:41-45`; CASCADE in migrations 014/015/005) with no forcing check.
  **The startup-failure claim is confirmed:** `index.ts:34` is a bare `await
  purgeOldTrash(db)` and `main().catch(...)` calls `process.exit(1)`, so a new
  project-child table with a `NOT NULL` FK and no `onDelete` makes **the server never
  bind**. Add a `PRAGMA foreign_key_list` test over the set. (78, CONFIRMED — Type & Constraint)
- **[S11]** Shared wire types re-declared server-side for chapters and projects with **no
  narrowing cast** (`chapters.types.ts:1-13,50-52` and `projects.types.ts` vs
  `shared/src/types.ts`), unlike the three modules that follow the pattern and unlike the
  documented `toChapterStatus` cast. Shared `Chapter` is an informal supertype of three
  server shapes with nothing enforcing it. Type-level only. (70, CONFIRMED — Type & Constraint)

## Type and Constraint Equivalence Notes

| Concept | Location A | Location B | Relationship | Risk | Recommendation |
|---|---|---|---|---|---|
| Resolvable image src | `docx.renderer.ts:325` | `export.renderers.ts:46-47` | superset (DOCX accepts more) | **high** | Anchor DOCX on the allowlist (C1) |
| Image project ownership | `images.references.ts:158-166` | `image-resolver.ts:33-38` | subset (absent) | **high** | Add `projectId` to `resolveImage` (I1) |
| Walker fail-closed guard | `tiptap-images.ts:11` | `tiptap-notes.ts:56`, `tiptap-safety.ts:30` | subset (missing array arm) | **high** | Add `\|\| Array.isArray(node)` (I2) |
| `UPDATE_READ_FAILURE` policy | `scopes.ts:192-209` (`chapter.save`) | `scopes.ts:245-266` (rename, status) | subset | medium | Shared scope fragment (I3) |
| HTTP status allowlist | CLAUDE.md §API Design | `appError.ts:11-14` / `app.ts:97` | drift + unenforced | medium | Clamp in handler (I4) |
| Corrupt-flag strip | `chapters.types.ts:72-75` | `chapters.service.ts:149`, `chapters.types.ts:110` | exact | medium | Widen helper, deletes a branch (I5) |
| Stored-JSON shape guard | `outtakes.repository.ts:14-22` | `chapters.repository.ts:14-30` | subset | medium | Guard inside `parseContent` (I6) |
| UUID route-param domain | `validateUuidParam.ts:23` (Zod) | `images.routes.ts:18` (regex) | Zod ⊂ regex | low | Fix docstring; leave validators (S7) |
| Image-upload cap | `ImageGallery.tsx:19` | `images.routes.ts:15`, `images.service.ts:11` | exact | low | Share the constant (S1) |
| Rendered-src allowlist | `sanitizer.ts:101-102` | `export.renderers.ts:46-47` | exact (byte-identical) | low | Back-reference + parity test (S3) |
| Chapter-status set | `schemas.ts:10` | migration `003:9-15` | nested supersets | low | Parity test (S9) |
| Content-size limit | `constants.ts:16` (number) | `constants.ts:17` (string) | exact | low | Delete the string (S8) |
| Title bound | `schemas.ts:14,20,64` (500) | migrations 001/002/003 (`varchar(255)`) | drift, unenforced | none | Rejected — see below |

## Rejected Candidate Duplicates

| Candidate | Reason rejected |
|---|---|
| **"`search.service.test.ts` has no velocity test"** (Refactoring Safety's ground for consolidating 5 sites) | **FALSE.** `packages/server/src/__tests__/search.service.test.ts:531-554` injects a rejecting `recordSave` via `vi.spyOn(velocityModule, "getVelocityService")` and asserts the logged recovery. The specialist grepped for `setVelocityService` and missed the other injection idiom. All 5 sites are covered. |
| **Velocity best-effort try/catch ×5** | Never drifted (`135b5fa` converted the 3 chapters sites together; `98e77f6` and `849231d` were born correct), all 5 tested, and the per-site log strings are deliberately differentiated so logs stay greppable — `search.service.ts:383` correctly omits `chapter_id` because a replace spans chapters. The separable *alias* survives as S4. |
| **"Mutate chapter content" as a three-way pipeline** | Dead. There is no auto-snapshot-on-save path at all — `createSnapshot` is reached only from `snapshots.routes.ts` with `isAuto` defaulting false. The three transactions share vocabulary, not a rule. Only the two-way dedup block survives (S6). |
| **Intra-file `JSON.parse` twins** (`search.service.ts:140-150` / `:251-261`) | Enclosing control flow genuinely differs (deadline → `return` vs `throw`), log strings differ meaningfully, single-commit twins from `69ee988` never independently touched. Extraction would need the caller to supply both the log string and the failure mode. |
| **Unifying the three truncation units** (`truncateUnits` / `truncateGraphemes` / `truncateCodePoints` at `scopes.ts:50`) | **Unsafe.** `EditorPage.tsx:44-49` states that `truncateUnits` is used *because* the outtake schema's `.max(500)` is a code-unit cap; switching to graphemes lets a 500-grapheme title exceed 500 code units and deterministically 400 the POST. Three caps, three units, three contracts. |
| **Snapshot-label grapheme-vs-code-unit "drift"** | No consequence: `label` is `table.text` in migrations 014/015, unbounded in SQLite. Only the docstring inaccuracy survives — `labels.ts:5-8` cites a "column cap" that does not exist. See Conflict 1. |
| **Panel contract across `OuttakesPanel` / `ImageGallery` / `SnapshotPanel`** | Prior rejection **stands and is strengthened**. Tab registration, width, and active-tab persistence are owned once by `ReferencePanel.tsx`; the other two are plain tab *bodies* (`OuttakesPanel.tsx:208-210` says so explicitly). `SnapshotPanel` is not a peer at all — own `<aside>`, fixed `w-80`, own focus management, own Escape listener, `forwardRef` imperative handle. |
| **`useReferencePanelState` vs `useSidebarState`** | Thin `usePersistedState` clients with different keys and codecs. Consolidating violates the documented "one component owns the key" contract. (The separator JSX is a different question — I7.) |
| **`useContentCache` as a drifted `usePersistedState`** | Module-level imperative functions, not React state; returns `boolean` for quota failures; `clientWarn` on every path; key varies **per chapter at runtime**, which the constant-key contract forbids. CLAUDE.md's split is accurate. |
| **Delete confirmation triplicated** | The two in-row confirms must keep the target row visible, so they cannot be modals; `ImageGallery`'s extra branch encodes a server-409 contract the others lack. Consolidating is a UX change, not a dedup. |
| **`OuttakeCard` label editing vs `useInlineTitleEditing`** | Different machines: no editing-mode toggle, no busy/lock gates, no Escape-to-cancel, and a different commit contract (`lastCommittedRef` tracks the *server-returned* value and re-seeds from it, with a deliberately un-advanced ref on possibly-committed). |
| **Raw `new AbortController()` at `ImageGallery.tsx:103,146`** | Not a violation — the ESLint ban is deliberately scoped to `useRef<AbortController>` (`eslint.config.js:190`, explicit "DELIBERATE GAPS" list), and the prior report's I3 explicitly deferred the remaining ~8 client sites. |
| **Note-confidentiality "encoded four times"** | Two different mechanisms at two different representation levels (JSON marks vs rendered HTML tags), each documented as the other's second layer, each cross-referenced, each tested. Unifying collapses intended defense-in-depth. |
| **`search.service.ts:341-343` fresh-`Date` project bump** | Cosmetic. Project `updated_at` can post-date its chapters on a replace, but the once-per-replace bump is deliberate and no consumer compares the two. |
| **S9 triplication of "what separates text"** (`BLOCK_TYPES` / `LEAF_BLOCKS` / `extractText`) | Consciously accepted and cross-referenced at each site; no actual divergence with a concrete failure found. |
| **`varchar(255)` vs Zod `.max(500)`** | Real (`table.string(...)` emits `varchar(255)`; newer migrations correctly use `table.text(...)`), but SQLite does not enforce it, so there is no live truncation and no drift *between behaviors*. Documentation hygiene, below the bar. |
| **`ChapterStatusRow` declared twice** | The accepted pattern executed **correctly** — `chapter-statuses.service.ts:8-17` `toChapterStatus` is the single documented cast. |
| **`SnapshotRow.is_auto` vs SQLite integer** | `coerceRow` applied at all three read paths. |
| **`MAX_TIPTAP_DEPTH` / `MAX_QUERY_LENGTH` / `MAX_REPLACE_LENGTH`** | Each single-sourced and imported at every call site checked. |
| **`REQUEST_ID_PATTERN` as a third UUID validator** | Different concept — an opaque bounded log-safe proxy token, deliberately not UUID-shaped. |
| **`Create*Data` / `Create*Row` vs `*Row` pairs** | Insert-time vs wire shapes; both type files document why they must not be aliased. |
| **`IMAGE_SRC_REGEX`** (2026-04-28 rejection) | Premise unchanged; that rejection stands. Distinct from C1, which is about the DOCX regex's anchoring. |
| **Outtakes hard-delete** | Documented deliberate exception in CLAUDE.md §Data Model. |
| **Migration 002's inlined `generateSlug`** | Documented deliberate copy — the Knex ESM loader cannot resolve the TS source (independently corroborated by hitting the same `ERR_MODULE_NOT_FOUND` class during verification). |
| **Editor controller `committed_but_unreloaded` asymmetry** | `1b47fee`'s message records the sibling check; intentional, reasoned, mirrored in CLAUDE.md. |
| **Outtake/snapshot label sanitize + cap** | Already consolidated into `sanitizedLabelBase` (`schemas.ts:190-194`). |

## Adjudicated Conflicts

Three cases where specialists reached opposite conclusions on the same code. The
Verifier read the code rather than averaging the positions.

**Conflict 1 — snapshot-label grapheme vs code-unit.** *Split decision.* Refactoring
Safety **overread** the test: `snapshots.service.test.ts:786-823` asserts
`label.length <= 500 * 4`, self-described as "a rough upper bound for ZWJ sequences" — it
*tolerates* the asymmetry, it does not *pin* it. But Type & Constraint's "drift" framing
**fails on consequence**: `label` is `table.text` in both migrations, so a 2000-code-unit
auto-label stores, reads, and renders fine. A finding needs a broken thing. Type &
Constraint wins one sub-claim outright: `labels.ts:5-8` justifies itself by *"if the
**column cap** … ever changes"* and **there is no column cap**. Verdict: fix the
docstring, leave the unit asymmetry, delete the dead fallback (S5). Refactoring Safety's
counter-warning is load-bearing — unifying on graphemes causes a deterministic 400 at
`EditorPage.tsx:54`.

**Conflict 2 — the two-way auto-snapshot dedup block.** *Semantic Equivalence wins;
extract it (S6).* Refactoring Safety's "≥5 strategy flags" objection conflates the
extractable block with its surrounding transactions — the block itself takes four
parameters and no flags. And Divergence Risk's own evidence argues **for** extraction:
its "managed duplication" case is that `addd61f` added the dedup to both sites in one
commit and `cb4851b` fixed it at both sites 50 minutes later — but that history shows
that *because the rule lived twice, the same wrong lookup was written twice and had to be
corrected in two places*. Lockstep is evidence of an attentive author, not a safe
structure. Refactoring Safety's forcing-test proposal (extending `save-side-effects.test.ts`
into a table over all three entry points) is a good idea **as well**, not instead.

**Conflict 3 — the best-effort velocity block.** *Three separable claims, three answers.*
The **alias** is real and is the cheapest fix in the run (S4). The **test gap is false** —
see the first rejected-candidates row; this was the sole ground for a conf-84
recommendation to touch five call sites and add an ESLint rule. The **try/catch
duplication stays** (Divergence Risk wins): never drifted, all five tested, and the
per-site log strings are deliberately differentiated.

## Specialist Corrections

Line citations were **accurate throughout** (occasional ±2 offsets), and all 11 spot-checked
SHAs matched their claimed date, message, and `--stat` file list exactly. Divergence Risk's
git work held up under every check.

1. **Refactoring Safety — materially wrong** on the velocity test gap (Conflict 3). It
   reasoned from grep hits for one injection idiom rather than reading the test file.
   **Treat its coverage-gap claims as needing confirmation.**
2. **Refactoring Safety — overstated cost** on Conflict 2 (block vs surrounding transaction).
3. **Refactoring Safety — overread a test** on Conflict 1.
4. **Type & Constraint — overstated one arm** of I3: the status revert path attempts a
   recovery GET first and self-heals; the local-revert arm needs that GET to fail too.
   The rename consequence is the unconditional one. (Calibration, not refutation.)
5. **Semantic Equivalence — under-reported**, not over-reported: its four-way table was
   compiled from regexes in isolation, but all three hostile rows confirmed end to end
   anyway, and its `resolveImage` remark — filed as a supporting note — was promoted to
   the separate finding I1.
6. **Divergence Risk — one arm unverified** on I6 (the "reaches `setContent` and throws"
   claim is client-side and was not exercised; on the server the value is inert).
7. **Divergence Risk — understated** on I2: the `validateTipTapDepth` gap is API-reachable
   via a nested array, so `MAX_TIPTAP_DEPTH` is bypassable. Found the gap, not the consequence.

## Consolidation Strategy

Ordered by (risk reduced ÷ risk introduced). Items 1–3 are behavioral fixes, not refactors.

1. **C1 — anchor the DOCX image-src check** + add a `renderDocx` hostile-src test. This
   is a bug fix; do it first and alone.
2. **I1 — add `projectId` to `resolveImage`** and return `null` on mismatch. One-argument
   widening; affects all five export formats.
3. **I2 — add `|| Array.isArray(node)`** to `tiptap-notes.ts:56` and `tiptap-safety.ts:30`;
   add the six-walker degradation table test; correct the now-false comments.
4. **I4 — clamp the status in `globalErrorHandler`**, source `ALLOWED` from one exported
   constant, delete the prose restatement in `appError.ts`.
5. **I3 — extract a shared chapter-PATCH scope fragment** in `scopes.ts` so all three
   scopes carry the same committed-intent codes.
6. **I5 / I6 / S5 / S4 / S8 — the net-deletion cluster.** Each shrinks the code: widen
   `stripCorruptFlag` (removes a branch), guard inside `parseContent`, delete the dead
   `Intl.Segmenter` fallback, delete the `recordSave` alias, delete
   `MAX_CHAPTER_CONTENT_LIMIT_STRING`.
7. **I7 — extract `<ResizeSeparator>`**; a11y attributes get a single owner.
8. **S1 / S2 / S3 — constant-sharing and cross-reference hygiene.**
9. **S7 — fix the `validateUuidParam` docstring.** Four lines. Do not consolidate the validators.
10. **S6 / S9 / S10 / S11 — extraction and forcing tests** where the cost is a test, not an abstraction.

Safe migration sequence for anything in group 6–7: characterization tests first, document
intentional behavior differences, extract or choose the canonical implementation, migrate
one caller at a time, add regression tests for the edge cases that previously differed.

**Per CLAUDE.md §Pull Request Scope, C1 and I1 are separate bug-fix PRs, not a bundle.**
The one-feature rule makes the net-deletion cluster (item 6) a legitimate single refactor PR.

## Review Metadata

- **Specialists:** Semantic Equivalence (returned), Type & Constraint Equivalence
  (returned), Domain Boundary & Intent (returned), Divergence Risk (returned),
  Refactoring Safety (returned). **None missing — not a degraded run.**
- **Verifier:** completed on the first attempt; no retry needed.
- **Files scanned:** 344 source files (~180 non-test, ~27,900 lines); recon not truncated
  (well under the 500-path cap).
- **Candidate groups discovered:** 8 seeded + 13 specialist-originated = 21 evaluated
- **Verified findings:** 19 (1 Critical, 7 Important, 11 Suggestions)
- **Rejected candidates:** 24
- **Generated/vendor paths excluded:** `.devcontainer/`, `node_modules/`, `dist/`,
  `coverage/`, `.git/`, `packages/server/src/db/migrations/*.js` (read as schema
  reference only, not scanned for duplication)
- **Steering files consulted:** `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`,
  `paad/duplicate-code-reports/` (both 2026-04-28 reports, including their
  rejected-candidate tables)
- **Empirical verification performed:** real `createApp()` + Supertest + real SQLite for
  C1, I1, I2, and I4; direct walker execution for I2; zod 4.3.6 domain comparison for S7;
  DDL generation via the project's Knex client; `git show --stat` on 11 SHAs
- **Prompt injection:** none found in any file read, by any agent
- **Working tree:** clean before and after (`git status --short` empty). All scratch test
  files created during verification were deleted; nothing was committed and no tracked
  file was modified.
