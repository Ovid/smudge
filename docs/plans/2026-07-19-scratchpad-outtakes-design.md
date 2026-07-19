# Phase 4c.2 — Scratchpad / Outtakes — Design

**Date:** 2026-07-19
**Phase:** 4c.2 (Notes, Tags & Outtakes → Scratchpad / Outtakes)
**Author:** Ovid / Claude (collaborative, via `/roadmap`)
**Roadmap:** `docs/roadmap.md` → Phase 4c, sub-phase 4c.2
**Design predecessors:** 4c.0 Reference Panel Multi-Tab Refactor (done), 4c.1 Inline Notes (done)
**Review:** pushback findings #1–#6 folded in (see §14).

---

## 1. Goal & Writer Value

Give the writer a per-project **drawer for cut text** — the "killed darlings" a
writer removes from a chapter but is not ready to lose. Today the only options
are *delete* (gone) or *stash in a junk chapter* (which inflates the word count
and pollutes the manuscript). The Outtakes drawer is a dedicated, private,
searchable home for that text: excluded from the manuscript word count, from
preview, and from every export format.

It is **a drawer, not a second editor.** Its job is to stash text safely and
hand it back on request — not to be a place you compose or heavily re-edit.

## 2. Scope

This design is deliberately split to keep the PR single-feature and free of
save-pipeline risk (per CLAUDE.md §Pull Request Scope and §Save-pipeline
invariants).

**In scope (Phase 4c.2):**

- The `outtakes` table + full CRUD (create, list, update-label, delete).
- The Outtakes reference-panel tab: list, client-side filter, per-outtake card
  with Insert / Copy / Delete actions.
- **Non-destructive capture:** "Send selection to outtakes" (a *copy* of the
  editor selection — the chapter is untouched) and manual create (plain
  textarea).
- **Insert back into the editor:** insert an outtake's content at the cursor
  (a normal edit, autosaved).

**Deferred to Phase 4c.2a (its own PR):**

- The **destructive** atomic "cut selection to outtakes" (delete the range from
  the chapter, persist the chapter through the editor-mutation machine, and POST
  the outtake — atomically enough that no failure loses text). This touches the
  save-pipeline invariants that CLAUDE.md flags as the highest-risk code in the
  app, so it earns its own focused review.
- **⚠️ Delete-safety re-evaluation (forcing note).** v1 hard-deletes outtakes
  (decision 2) safely *because capture is non-destructive* — the original text
  still lives in the chapter. After 4c.2a's destructive cut, the outtake becomes
  the **sole copy** of that text, so hard-delete-behind-one-confirm is then the
  only barrier against permanent loss. **4c.2a's design MUST re-evaluate the
  delete-safety posture (soft-delete / undo / snapshot-on-cut) before enabling
  the destructive cut.** Reversing v1's choice is cheap — a nullable
  `deleted_at` is a trivial `ADD COLUMN` with no backfill (NULL = not deleted) —
  so we do not pre-pay for it now, but 4c.2a may not inherit hard-delete
  silently.

**Out of scope entirely (future / only-if-requested):**

- Editing an outtake's *content* in the panel (a rich in-place editor).
- Images inside outtakes + the image-reference tracking they would require.
- Soft-delete / trash / 30-day recovery for outtakes (see the forcing note above
  for the 4c.2a trigger to reconsider).
- Server-side or global (find-and-replace) search over outtakes.

## 3. Design Decisions (with rationale)

Four decisions were made during brainstorming; each is recorded here so a later
review treats them as decided.

1. **Non-destructive capture in v1; destructive cut split to 4c.2a.** The drawer
   carries essentially all the writer value (a safe, searchable home for cut
   text) with zero save-pipeline exposure. The one-click *cut* is a delighter
   that touches the app's most dangerous code and belongs in its own PR.
2. **Hard delete + confirmation dialog; no `deleted_at`.** In v1 an outtake is a
   *copy* — the original still lives in the chapter — so a safe-place-for-the-
   safe-place is complexity a single-user drawer does not need. This matches
   `ChapterSnapshot` (also a safety-net TipTap-JSON table that hard-deletes). The
   confirm dialog is the guardrail. This is a **documented deviation** from the
   roadmap's data-model sketch (which listed `deleted_at`) and from CLAUDE.md's
   "soft delete everywhere" — added to §Data Model as an explicit exception,
   exactly as snapshots are. **See the §2 forcing note: 4c.2a must revisit this
   before shipping the destructive cut**, because after a cut the outtake is the
   only copy.
3. **Drawer content model, not a mini-editor.** Content is stored as TipTap JSON
   (so a copied rich selection keeps its formatting on the way out and back).
   The panel is not an editor: the **label** is inline-editable; **content is
   not re-editable in the panel** (to rework a darling, insert it into a chapter,
   edit there, optionally re-capture).
4. **Images stripped on capture.** Outtake JSON is invisible to the image
   garbage-collector / reference-counter (which scans only the `chapters`
   table), so an image referenced *only* by an outtake would be deleted out from
   under it. Cut text is almost always prose; stripping image nodes on capture
   (authoritatively server-side, best-effort client-side too) closes the blind
   spot without the weight of extending ref-tracking.

## 4. Data Model

**New migration:** `packages/server/src/db/migrations/015_create_outtakes.js`
(next number after `014_create_chapter_snapshots.js`).

**Table `outtakes`:**

| Column        | Type    | Notes                                                       |
| ------------- | ------- | ----------------------------------------------------------- |
| `id`          | TEXT PK | UUID                                                        |
| `project_id`  | TEXT    | `NOT NULL`, FK → `projects(id)` `ON DELETE CASCADE`         |
| `label`       | TEXT    | nullable                                                    |
| `content`     | TEXT    | `NOT NULL`, stringified TipTap JSON                         |
| `created_at`  | TEXT    | `NOT NULL`                                                  |
| `updated_at`  | TEXT    | `NOT NULL` (bumped on label edit)                           |

Index: `(project_id, created_at)` for the newest-first list query.

**No `word_count` column** (pushback #5): the list endpoint returns full
`content` (§5) and the client already ships `countWords()`, so the panel
computes the per-outtake count from content it holds — a persisted column, its
server compute step, and its migration cost would buy nothing. If a future
consumer ever needs a count *without* loading content (e.g. a drawer total), add
it then.

**No `deleted_at`** — hard delete (decision 2). `ON DELETE CASCADE` cleans up
outtakes only when a project is *hard*-purged; because projects soft-delete, the
outtakes service treats a soft-deleted parent project as `404` (mirrors the
snapshot service's parent-chapter check via a raw `deleted_at IS NULL` lookup).

**Word-count exclusion is structural.** The manuscript total is computed solely
from `SUM(chapters.word_count)` (`velocity.service.ts`
`sumChapterWordCountByProject`). A separate table cannot be seen by that query,
so outtakes never touch the manuscript total or `daily_snapshots`. The service
must never write to `chapters` or call `recordSave` / `upsertDailySnapshot` when
creating an outtake.

## 5. Shared Types, Schemas & Helpers (`packages/shared`)

- **`OuttakeRow`** (wire type, `types.ts`): `{ id, project_id, label: string | null,
  content: <TipTap JSON>, created_at, updated_at }`. The list endpoint returns
  full rows (content included) — a per-project drawer holds dozens of short
  cut-prose items, so the client filters, previews, inserts, and word-counts
  from the already-loaded list without a second fetch. **Single-user
  assumption (pushback #6):** there is no per-project outtake cap or pagination;
  "dozens × short" is asserted, not enforced. This matches Smudge's other
  single-user trade-offs; if drawers ever grow pathologically large, a
  content-elided list variant is the escape hatch. Recorded as accepted.
- **`CreateOuttakeSchema`** (`schemas.ts`, `.strict()`): `{ content: TipTapDocSchema,
  label?: <sanitized string, nullable> }`. No client-supplied counts.
- **`UpdateOuttakeSchema`** (`.strict()`): `{ label: <sanitized string | null> }`.
  Content is not re-editable in v1, so only the label is patchable.
- **`stripImageNodes(doc)`** — a small TipTap walker (co-located with the
  existing `stripNoteMarks`) that removes `type: "image"` nodes. Used
  client-side at capture for immediate feedback and, authoritatively, in the
  outtakes service.
- **`toPlainText(doc)`** (pushback #3) — a shared, **exported**, tested
  TipTap-JSON → plain-text helper with **defined inter-block separation** (blocks
  joined by `\n` so a filter/Copy cannot match a phantom substring spanning a
  block boundary), used by both the Copy action and the filter box (rather than
  each call site re-deriving plain text ad hoc). **Deliberate deviation
  (alignment #5):** this is a *new* walker, **not** a reuse of the private
  `extractText` in `wordcount.ts`. `extractText` joins blocks with a single
  space and is load-bearing for the client/server word-count agreement
  invariant (CLAUDE.md §Shared `countWords()`); `toPlainText` needs newline
  block separation for Copy fidelity. Forking keeps `toPlainText` from perturbing
  the word-count path — the two walkers are parallel by design, not by
  oversight, and the small duplication is the accepted cost of not risking the
  word-count invariant.

Content validation reuses the existing `TipTapDocSchema` + `MAX_CHAPTER_CONTENT_BYTES`
guard (same as snapshots) so oversized bodies return `413` (inherited from the
global `express.json({ limit })` mount in `app.ts`).

## 6. Server Layers (clones the snapshot stack)

New domain `packages/server/src/outtakes/`:

- **`outtakes.repository.ts`** — plain `(db: Knex, …)` functions: `insert`
  (insert then re-read the row), `listByProject` (newest first), `findById`,
  `updateLabel`, `remove` (hard `del()`). All SQL/Knex lives here (F-5).
- **`outtakes.service.ts`** — reaches the store via `getProjectStore()`:
  1. Validate `content` with `TipTapDocSchema` + byte cap.
  2. **Strip image nodes** from the doc (`stripImageNodes`, authoritative).
  3. Generate UUID + timestamps; `insert` inside `store.transaction()`.
  4. Enforce a live parent project (soft-deleted parent → `404`).
  `listByProject`, `updateLabel` (bumps `updated_at`), and `remove` follow the
  same parent-liveness discipline.
- **`outtakes.routes.ts`** — two routers, registered in `app.ts`:
  - `projectOuttakesRouter()` → `POST /api/projects/:id/outtakes`,
    `GET /api/projects/:id/outtakes`.
  - `outtakeDirectRouter()` → `PATCH /api/outtakes/:id`, `DELETE /api/outtakes/:id`.
  UUID params via `UuidSchema`; bodies via the shared schemas +
  `respondValidationParse` / `validationError`; unknown ids via the `notFound`
  helper; **`DELETE` returns `204`** (body-less, per CLAUDE.md §API Design), with
  the client owning the success toast.
- **`outtakes.types.ts`** — server-internal `CreateOuttakeData` insert shape.

**Facade (F-4/F-5):** add an `OuttakesStore` slice to `project-store.types.ts`,
compose it into `ProjectStore`, and add one-line delegations in
`sqlite-project-store.ts`. Services never import the repo directly.

## 7. Client

- **API (`api/client.ts`):** `api.outtakes = { list(projectId, signal?),
  create(projectId, body, signal?), updateLabel(id, body, signal?),
  delete(id, signal?) }`, mirroring `api.snapshots` (204 → resolves `undefined`).
- **Error scopes (`errors/scopes.ts`):** `outtake.list`, `outtake.create`,
  `outtake.update`, `outtake.delete`, each with a `STRINGS.error.*` fallback.
  All user-facing messages route through `mapApiError` / `applyMappedError`.
- **Strings (`strings.ts`):** a `STRINGS.outtakes` group (tab label, empty state,
  create-button labels, filter placeholder, card action labels, confirm-delete
  copy, `"Untitled outtake"` default, `"From <chapter>"` capture-label prefix)
  plus the `error.*` fallbacks the scopes reference.
- **Components:**
  - `OuttakesPanel.tsx` — loads the list (via `useAbortableAsyncOperation` for
    the fetch), a client-side **filter box** (case-insensitive substring over
    the label + `toPlainText(content)`), create controls ("New outtake" →
    textarea; "Send selection to outtakes" handled from the toolbar too), and
    the list of cards newest-first.
  - `OuttakeCard.tsx` — inline label edit, content preview with expand, created
    date, a word count computed client-side via `countWords(content)`, and the
    actions **Insert into editor / Copy / Delete**. Copy uses `toPlainText`.
    Delete uses `ConfirmDialog` (via `useDialogLifecycle`).
- **Tab wiring:** add a second entry (`id: "outtakes"`) to the `tabs[]` array in
  `EditorMainContent.tsx`. No change to `useReferencePanelState` — its `text`
  codec accepts any id and `ReferencePanel` degrades an unknown `activeTabId` to
  `tabs[0]`.
- **Toolbar:** `EditorToolbar` gains a "Send selection to outtakes" button
  (non-destructive copy), wired via an `onSendSelectionToOuttakes` callback from
  `EditorPage`. The `editorEntryPointSurface.test.ts` forcing-pause snapshot gets
  its expected update (a new entry point is added consciously).

## 8. The Two Non-Destructive Flows

**Capture (copy selection → outtake):**

1. Read `editor.state.doc.slice(from, to)` and wrap its content as a standalone
   TipTap `doc`.
2. Strip image nodes (`stripImageNodes`, client-side, for immediate feedback).
3. `POST /api/projects/{id}/outtakes { content, label? }` (label pre-filled with
   `"From <chapter title>"`, editable).
4. Server re-validates, strips images authoritatively, inserts.
5. Panel prepends the new outtake (or refetches).

**The chapter is never mutated**, so none of the save-pipeline invariants apply —
this is a pure read-of-selection + POST.

**Insert (outtake → editor):**

1. Card "Insert into editor" → callback to `EditorPage`.
2. Insert the outtake's **block array** — `insertContent(outtake.content.content)`
   (the `content` of the stored `doc`, *not* the `doc` node itself, which is not
   well-defined mid-paragraph) — at the cursor via
   `editor.chain().focus().insertContent(…).run()`.
3. The normal auto-save pipeline persists the resulting chapter edit.
4. Guarded by `editor.isEditable` and the editor-mutation machine not being
   busy/locked (insert is a normal edit, not an out-of-band mutation, so it
   needs no `useEditorMutation` orchestration — just the editable/idle guard).
5. **Edge behavior is specified and tested** (pushback #4): insert at an inline
   cursor (splits the block as TipTap normally does), into an empty doc, and
   over a non-empty selection (the selection is replaced, TipTap's default for
   `insertContent`).

**Copy** places `toPlainText(outtake.content)` on the clipboard (no editor
involvement).

## 9. Exclusion Guarantees (each with a test)

| Surface                     | Why outtakes are excluded                                              | Test |
| --------------------------- | --------------------------------------------------------------------- | ---- |
| Manuscript word count / daily snapshots | computed from `chapters` only                             | creating an outtake leaves `velocity.current_total` unchanged |
| Export (all formats)        | export gathers `listChaptersByProject` only                           | export output contains no outtake text |
| Preview / rendered HTML     | renders a single passed-in doc, never queries outtakes                | (covered by the export/render tests) |
| Global find-and-replace     | search service not extended to outtakes                               | replace-all does not touch outtake rows |
| Image GC / reference count  | images stripped on capture → no refs to track                         | an image node cannot survive capture |

## 10. Testing (RED-GREEN-REFACTOR, real SQLite)

- **Server:** migration up/down; repository CRUD; service (content validation,
  image-strip, parent-project-404, transaction rollback); routes via Supertest
  (create/list/patch-label/delete-`204`, `400` on invalid JSON, `404` unknown
  id, `413` oversized); the exclusion tests in §9.
- **Shared:** `CreateOuttakeSchema` / `UpdateOuttakeSchema` strictness +
  sanitization; `TipTapDocSchema` rejection; `stripImageNodes` walker;
  **`toPlainText`** (block separation — two paragraphs must not concatenate into
  a phantom cross-block match).
- **Client:** `api.outtakes` fetch tests; `OuttakesPanel` / `OuttakeCard`
  behavior (list, filter over label + plain text, create-from-textarea, inline
  label edit, delete-with-confirm, Insert/Copy callbacks, client-side word
  count); **Insert edge cases** (inline cursor, empty doc, over selection); scope
  → `mapApiError` mapping; tab wiring; toolbar button + `editorEntryPointSurface`
  snapshot update. All console assertions via `expectConsole()`.
- **e2e (Playwright):** capture-from-selection → outtake appears in panel →
  insert into a chapter → delete with confirm. aXe-core pass on the panel.
- Coverage floors (95% stmt / 85% branch / 90% fn / 95% line) maintained;
  push higher where practical.

## 11. Documentation Updates (deliverables of this phase)

- **CLAUDE.md §Data Model:** add the `outtakes` table, noting (a) the hard-delete
  exception to "soft delete everywhere" (as snapshots already are) and (b) the
  image-strip-on-capture invariant and *why* (reaper blind spot). Note that
  outtakes are excluded from word count / export / search **by table
  separation** (a new "all project content" iteration must consciously opt them
  in, and for images must never do so without ref-tracking).
- **Roadmap reconciliation (pushback #1):** update `docs/roadmap.md`'s Phase 4c.2
  detail so it matches this design — strike `deleted_at` from the Outtake table,
  change the `DELETE /api/outtakes/{id}` bullet from "soft-delete" to hard-delete,
  and qualify the line that lists "outtakes" among image-bearing content (images
  are stripped from outtakes in v1). *(The top-of-section 4c sub-status block is
  already updated to point at this design and split out 4c.2a.)*

## 12. PR Scope

Single feature (the non-destructive Outtakes drawer) → one PR, referencing
roadmap Phase 4c.2. The destructive "cut selection to outtakes" is Phase 4c.2a,
a separate PR. No exception to the one-feature rule is needed.

## 13. Dependencies

- MVP TipTap editor (custom nodes/commands).
- Phase 4a reference panel infrastructure.
- Phase 4c.0 multi-tab reference panel (done) — the Outtakes tab is a second
  `tabs[]` entry.

## 14. Pushback Resolutions (2026-07-19)

| # | Severity | Finding | Resolution |
| - | -------- | ------- | ---------- |
| 1 | Important | Roadmap 4c.2 spec still says `deleted_at` / soft-delete / images-in-outtakes | **fixed-in-design** — §11 now lists the roadmap reconciliation as a deliverable (and the 4c sub-status block already points here) |
| 2 | Important | Hard-delete posture is inherited by 4c.2a where the outtake is the sole copy | **fixed-in-design** — kept hard-delete for v1 (decision, Option A) + added the §2 forcing note requiring 4c.2a to re-evaluate delete-safety |
| 3 | Minor | Plain-text extraction unspecified; `extractText` is private | **fixed-in-design** — added shared, exported, tested `toPlainText(doc)` (§5) used by Copy + filter |
| 4 | Minor | "Insert" inserts a whole `doc` node; edge cases undefined | **fixed-in-design** — insert the block array `content.content`; edge behavior specified + tested (§8, §10) |
| 5 | Minor | Persisted `word_count` column is redundant | **fixed-in-design** — dropped the column; count computed client-side from loaded content (§4) |
| 6 | Minor | List returns full content with no bound | **accepted-as-is** — recorded the single-user "dozens × short" assumption + content-elided escape hatch (§5) |
