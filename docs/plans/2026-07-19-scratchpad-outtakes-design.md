# Phase 4c.2 — Scratchpad / Outtakes — Design

**Date:** 2026-07-19
**Phase:** 4c.2 (Notes, Tags & Outtakes → Scratchpad / Outtakes)
**Author:** Ovid / Claude (collaborative, via `/roadmap`)
**Roadmap:** `docs/roadmap.md` → Phase 4c, sub-phase 4c.2
**Design predecessors:** 4c.0 Reference Panel Multi-Tab Refactor (done), 4c.1 Inline Notes (done)

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

**Out of scope entirely (future / only-if-requested):**

- Editing an outtake's *content* in the panel (a rich in-place editor).
- Images inside outtakes + the image-reference tracking they would require.
- Soft-delete / trash / 30-day recovery for outtakes.
- Server-side or global (find-and-replace) search over outtakes.

## 3. Design Decisions (with rationale)

Four decisions were made during brainstorming; each is recorded here so a later
review treats them as decided.

1. **Non-destructive capture in v1; destructive cut split to 4c.2a.** The drawer
   carries essentially all the writer value (a safe, searchable home for cut
   text) with zero save-pipeline exposure. The one-click *cut* is a delighter
   that touches the app's most dangerous code and belongs in its own PR.
2. **Hard delete + confirmation dialog; no `deleted_at`.** An outtake is *itself*
   the recovery mechanism for cut text; a safe-place-for-the-safe-place is
   complexity a single-user drawer does not need. This matches `ChapterSnapshot`
   (also a safety-net TipTap-JSON table that hard-deletes). The confirm dialog is
   the guardrail. This is a **documented deviation** from the roadmap's
   data-model sketch (which listed `deleted_at`) and from CLAUDE.md's "soft
   delete everywhere" — added to §Data Model as an explicit exception, exactly
   as snapshots are.
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
| `word_count`  | INTEGER | `NOT NULL`, computed server-side via shared `countWords()`  |
| `created_at`  | TEXT    | `NOT NULL`                                                  |
| `updated_at`  | TEXT    | `NOT NULL` (bumped on label edit)                           |

Index: `(project_id, created_at)` for the newest-first list query.

**No `deleted_at`** — hard delete (decision 2). `ON DELETE CASCADE` cleans up
outtakes only when a project is *hard*-purged; because projects soft-delete, the
outtakes service treats a soft-deleted parent project as `404` (mirrors the
snapshot service's parent-chapter check via a raw `deleted_at IS NULL` lookup).

**Word-count exclusion is structural.** The manuscript total is computed solely
from `SUM(chapters.word_count)` (`velocity.service.ts`
`sumChapterWordCountByProject`). A separate table cannot be seen by that query,
so the per-outtake `word_count` (stored for panel display) never leaks into the
manuscript total or `daily_snapshots`. The service must never write to
`chapters` or call `recordSave`/`upsertDailySnapshot` when creating an outtake.

## 5. Shared Types & Schemas (`packages/shared`)

- **`OuttakeRow`** (wire type, `types.ts`): `{ id, project_id, label: string | null,
  content: <TipTap JSON>, word_count, created_at, updated_at }`. The list endpoint
  returns full rows (content included) — a per-project drawer holds dozens of
  items, so the client filters, previews, and inserts from the already-loaded
  list without a second fetch.
- **`CreateOuttakeSchema`** (`schemas.ts`, `.strict()`): `{ content: TipTapDocSchema,
  label?: <sanitized string, nullable> }`. `word_count` is **computed
  server-side**, never accepted from the client.
- **`UpdateOuttakeSchema`** (`.strict()`): `{ label: <sanitized string | null> }`.
  Content is not re-editable in v1, so only the label is patchable.

Content validation reuses the existing `TipTapDocSchema` + `MAX_CHAPTER_CONTENT_BYTES`
guard (same as snapshots) so oversized bodies return `413`.

## 6. Server Layers (clones the snapshot stack)

New domain `packages/server/src/outtakes/`:

- **`outtakes.repository.ts`** — plain `(db: Knex, …)` functions: `insert`
  (insert then re-read the row), `listByProject` (newest first), `findById`,
  `updateLabel`, `remove` (hard `del()`). All SQL/Knex lives here (F-5).
- **`outtakes.service.ts`** — reaches the store via `getProjectStore()`:
  1. Validate `content` with `TipTapDocSchema` + byte cap.
  2. **Strip image nodes** from the doc (authoritative).
  3. `countWords()` the stripped doc → `word_count`.
  4. Generate UUID + timestamps; `insert` inside `store.transaction()`.
  5. Enforce a live parent project (soft-deleted parent → `404`).
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

**Image-strip helper.** A small `stripImageNodes(doc)` walker (shared, alongside
`stripNoteMarks`) removes `type: "image"` nodes. Reused client-side at capture
for immediate feedback; the server strip is the authoritative one.

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
    label + the outtake's plain text), create controls ("New outtake" → textarea;
    "Send selection to outtakes" handled from the toolbar too), and the list of
    cards newest-first.
  - `OuttakeCard.tsx` — inline label edit, content preview with expand, created
    date + word count, and actions **Insert into editor / Copy / Delete**. Delete
    uses `ConfirmDialog` (via `useDialogLifecycle`).
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
2. Strip image nodes (client-side, for immediate feedback).
3. `POST /api/projects/{id}/outtakes { content, label? }` (label pre-filled with
   `"From <chapter title>"`, editable).
4. Server re-validates, strips images authoritatively, computes `word_count`,
   inserts.
5. Panel prepends the new outtake (or refetches).

**The chapter is never mutated**, so none of the save-pipeline invariants apply —
this is a pure read-of-selection + POST.

**Insert (outtake → editor):**

1. Card "Insert into editor" → callback to `EditorPage`.
2. `editor.chain().focus().insertContent(outtake.content).run()` at the cursor.
3. The normal auto-save pipeline persists the resulting chapter edit.
4. Guarded by `editor.isEditable` and the editor-mutation machine not being
   busy/locked (insert is a normal edit, not an out-of-band mutation, so it
   needs no `useEditorMutation` orchestration — just the editable/idle guard).

**Copy** places the outtake's plain text on the clipboard (no editor
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
  image-strip, `word_count`, parent-project-404, transaction rollback); routes
  via Supertest (create/list/patch-label/delete-`204`, `400` on invalid JSON,
  `404` unknown id, `413` oversized); the exclusion tests in §9.
- **Shared:** `CreateOuttakeSchema` / `UpdateOuttakeSchema` strictness +
  sanitization; `TipTapDocSchema` rejection; `stripImageNodes` walker.
- **Client:** `api.outtakes` fetch tests; `OuttakesPanel` / `OuttakeCard`
  behavior (list, filter, create-from-textarea, inline label edit,
  delete-with-confirm, Insert/Copy callbacks); scope → `mapApiError` mapping;
  tab wiring; toolbar button + `editorEntryPointSurface` snapshot update. All
  console assertions via `expectConsole()`.
- **e2e (Playwright):** capture-from-selection → outtake appears in panel →
  insert into a chapter → delete with confirm. aXe-core pass on the panel.
- Coverage floors (95% stmt / 85% branch / 90% fn / 95% line) maintained;
  push higher where practical.

## 11. CLAUDE.md Updates (deliverable of this phase)

- **§Data Model:** add the `outtakes` table, noting (a) the hard-delete
  exception to "soft delete everywhere" (as snapshots already are) and (b) the
  image-strip-on-capture invariant and *why* (reaper blind spot).
- Note that outtakes are excluded from word count / export / search **by table
  separation** (a new "all project content" iteration must consciously opt them
  in, and for images must never do so without ref-tracking).

## 12. PR Scope

Single feature (the non-destructive Outtakes drawer) → one PR, referencing
roadmap Phase 4c.2. The destructive "cut selection to outtakes" is Phase 4c.2a,
a separate PR. No exception to the one-feature rule is needed.

## 13. Dependencies

- MVP TipTap editor (custom nodes/commands).
- Phase 4a reference panel infrastructure.
- Phase 4c.0 multi-tab reference panel (done) — the Outtakes tab is a second
  `tabs[]` entry.
