# Smudge — Feature Roadmap (Phases 1–8)

**Version:** 0.5.0
**Date:** 2026-04-11
**Author:** Ovid / Claude (collaborative)
**Companion to:** Smudge MVP PRD v0.3.0, `docs/simplification-roadmap.md`
**Status:** Post-review, restructured for smaller PRs

---

## How to Use This Document

Each phase below contains enough detail to serve as input for generating a full PRD. For each phase you'll find: the goal (what the writer gains), detailed feature descriptions, data model changes, API additions, UI/UX considerations, and implementation notes including dependencies on earlier phases.

Phases are ordered by writer impact and dependency: Phases 1–2 are complete. Phase 2.5 simplifies the architecture before further feature work. Phases 3a–3b complete the core writing tool with export. Phases 4a–4c build the revision and annotation infrastructure. Phases 5a–5d differentiate Smudge as a *fiction writer's* tool. Phases 6a–6b serve non-fiction writers. Phases 7a–7f add polish and power features. Phase 8 prepares for desktop distribution.

**A note on scope within phases:** Each phase is designed to be a single deliverable increment — something you can build, ship, and use before starting the next. Phases are sized to produce manageable PRs.

### Phase Structure

| Phase | Name | Summary | Status |
|-------|------|---------|--------|
| 1 | Writer's Dashboard | Chapter status labels, project overview, chapter navigation shortcuts | Done |
| 2 | Goals & Velocity | Word targets, deadlines, daily tracking, session stats, burndown | Done |
| 2.5a | Simplify Progress Model | Reduce velocity to project-level targets + daily totals, demote save_events | Done |
| 2.5b | Storage Architecture | ProjectStore/AssetStore/SnapshotStore abstractions, clean seams for future | Done |
| 3a | Export Foundation | Export pipeline, HTML, Markdown, plain text, config dialog, download | Done |
| 3b | Document Export | PDF, Word (.docx), EPUB | Done |
| 4a | Reference Panel & Images | Collapsible side panel infrastructure, image upload/storage | Done |
| 4b | Snapshots & Find-and-Replace | Manual/auto snapshots, project-wide search and replace | Done |
| 4b.1 | Editor Orchestration Helper | Extract shared save-flush/markClean/setEditable/reload shape into one helper | Done |
| 4b.2 | Abortable Sequence Hook | Unify ad-hoc seq-refs into a single `useAbortableSequence()` primitive | Done |
| 4b.3 | Unified API Error Mapper | Single module mapping API errors to UI strings; no raw server text in UI | Done |
| 4b.3a | 4b.3 Review Follow-ups (Clusters A, D, F) | Scope-coverage gaps, sanitizer hardening, PR-shape retrospective | Done |
| 4b.14 | Abortable Async Operation Hook | Extract `useAbortableAsyncOperation` for the "abort prior, fresh controller, check `signal.aborted` before setState" pattern hand-rolled in `useTrashManager`, `useFindReplaceState`, `ImageGallery` (~7 refs across 3 files). Re-ordered 2026-04-28 to land before 4b.3b–d per dedup-pass collision (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-13-33-4129d99.md` finding I3). | Planned |
| 4b.3b | AbortSignal Threading Completion | Finish Cluster B: thread signal through remaining call sites (HomePage create/delete, useProjectEditor `handleCreateChapter` + `loadProject` + remaining `chapters.get`, EditorPage chapterStatuses retry + `search.replace`). Now depends on 4b.14; each site re-evaluated against the new hook before threading. | Planned |
| 4b.3c | Consumer Recovery Completeness | Cluster C: introduce `applyMappedError` helper and migrate 15 consumers that mishandle `mapApiError` output | Planned |
| 4b.3d | Mapper Internals & CLAUDE.md Updates | Cluster E: `safeExtrasFrom` try/catch, `ScopeExtras<S>` type, helper extractions, CLAUDE.md doc update | Planned |
| 4b.4 | Raw-Strings ESLint Rule | Enforce strings.ts externalization via lint; fix existing violations | Planned |
| 4b.5 | Editor State Machine | Unify `editable`/`locked`/`busy` editor state into one machine; add `committed_but_unreloaded` mutation stage for ambiguous server responses | Planned |
| 4b.6 | E2E Test Isolation | Wire `playwright.config.ts` to set `SMUDGE_PORT` / `SMUDGE_CLIENT_PORT` / `DB_PATH` to test-only values so e2e cannot piggy-back on the dev server or share its database | Planned |
| 4b.7 | Test Warning-Pin Audit | Audit the 52 console-spy installs across 9 client test files that suppress `console.warn`/`console.error` without asserting on the call; pin each spy to the contract its production path commits to (or remove if defensive) | Planned |
| 4b.8 | TipTap Extension Consolidation | Move client+server TipTap extension config to `packages/shared/`; both packages re-export. Eliminates the parity test enforced by review. | Planned |
| 4b.9 | Chapter Status Type Alignment | Replace `Chapter.status: string` with `ChapterStatusValue = z.infer<typeof ChapterStatus>` so the TS type matches the Zod 5-value enum. | Planned |
| 4b.10 | Shared TipTap Unsafe-Keys Set | Extract `CANONICAL_UNSAFE_KEYS` into `packages/shared/` so `tiptap-text.ts` and `snapshots/content-hash.ts` share one declaration of `__proto__`/`prototype`/`constructor` strip. | Planned |
| 4b.11 | 404 Route-Response Helper | Replace ~20 hand-written `res.status(404).json({ error: { code: "NOT_FOUND", … } })` blocks across `projects`/`chapters`/`snapshots`/`search` routes with a `notFound(res, resource)` helper in `app.ts`. | Planned |
| 4b.12 | Validation Error Response Helper | Add `validationError(res, msg)` + `respondValidationParse(res, parsed)` helpers; migrate ~6 `safeParse` ladders so the 400 envelope has one owner. | Planned |
| 4b.13 | TipTap Depth-Guard Regression Test | Add a single test that walks a depth-65 TipTap doc through every consumer (`extractText`, `canonicalize`, image `walk`, depth validator) and asserts each bails safely. Codifies the contract behind today's four independent depth checks. | Planned |
| 4b.15 | Inline Title-Editing Hook | Extract a generic `useInlineTitleEditing(currentId, save, gates, options?)`; reduce `useChapterTitleEditing` and `useProjectTitleEditing` to thin wrappers that pass slug-drift check + post-save navigate as options. | Planned |
| 4b.16 | Dialog Lifecycle Hook | Extract `useDialogLifecycle(dialogRef, { open, onClose, initialFocusRef, blockEscapePropagation, role })` and migrate the 5 dialogs (Confirm, Export, NewProject, ProjectSettings, ShortcutHelp) one at a time; preserve `stopImmediatePropagation` and happy-dom guards as opt-ins. | Planned |
| 4c | Notes, Tags & Outtakes | Inline notes, paragraph tags, scratchpad for cut text | Planned |
| 5a | Fiction: Characters | Character sheets with structured fields and freeform notes | Planned |
| 5b | Fiction: Scene Cards | Scene cards / outline mode with drag-and-drop | Planned |
| 5c | Fiction: World-Building | World-building bible, "who's in the room" tracker | Planned |
| 5d | Fiction: Visualizations | Relationship map, timeline view | Planned |
| 6a | Non-Fiction: Research & Citations | Research library, citation management, fact-check flags, research side panel | Planned |
| 6b | Non-Fiction: Argument Structure | Argument tree visualization | Planned |
| 7a | Writing Environment | Dark mode, distraction-free mode | Planned |
| 7b | Self-Editing Tools | Style linting, text-to-speech | Planned |
| 7c | Writing Journal | Per-project dated writing journal | Planned |
| 7d | Split View | Side-by-side editor panes | Planned |
| 7e | Import | Markdown, Word, plain text import | Planned |
| 7f | i18n | Full UI translation with react-i18next | Planned |
| 8a | Project Package Format | Per-project .smudge/ folder with own SQLite DB and assets | Planned |
| 8b | Bundle Export (.smg) | Portable single-file format for sharing and backup | Planned |

---

## Phase 1: Writer's Dashboard
<!-- plan: 2026-03-30-writers-dashboard-design.md -->

### Goal

Give the writer a bird's-eye view of where their manuscript stands. Replace the mental bookkeeping of "which chapters are rough, which are polished, where did I leave off?" with a visual dashboard.

### Features

#### 1.1 Chapter Status Labels

Each chapter has a status reflecting its stage in the writing process. The default status progression is:

- **Outline** — structural notes, bullet points, not yet prose
- **Rough Draft** — first pass, getting ideas down
- **Revised** — structural and content edits complete
- **Edited** — line-level editing complete
- **Final** — ready for export/publication

These labels are a recommended workflow, not enforced — writers can set any status at any time, in any order. A chapter can go from "Final" back to "Rough Draft" if the writer decides to restructure.

**Default status for new chapters is "Outline."** An empty chapter isn't a rough draft — it's a placeholder. Writers who skip outlining can change the status when they begin writing.

The status is displayed in the sidebar next to each chapter title, as a subtle colored badge with a text label (color alone is insufficient per a11y requirements). The status is also settable from the sidebar — click or keyboard-select the status badge to cycle or choose.

#### 1.2 Project Dashboard View

A new view accessible from the project screen (alongside the editor and preview). The dashboard shows:

- **Chapter table:** All chapters listed with title, status, word count, and last-edited date. Sortable by any column.
- **Status summary:** A visual summary of how many chapters are in each status. Could be a simple bar/progress indicator showing the ratio (e.g., "3 Outline / 5 Rough Draft / 2 Revised / 1 Edited / 0 Final").
- **Manuscript health at a glance:** Total word count, total chapters, date of most recent edit, date of least recent edit (to surface neglected chapters).

This view is read-only with respect to content — it's for orientation, not editing. Clicking a chapter title navigates to the editor with that chapter loaded.

#### 1.3 Chapter Navigation Shortcuts

Deferred from MVP to avoid auto-save timing edge cases. Now that the save-on-switch behavior (MVP PRD §6.1 and §7.3) is solid:

- **Ctrl/Cmd + Up** — Navigate to the previous chapter in order.
- **Ctrl/Cmd + Down** — Navigate to the next chapter in order.

These trigger the same forced-save-then-switch behavior defined in the MVP.

### Data Model Changes

**Chapter** — add column:
- `status` — enum: "outline" | "rough_draft" | "revised" | "edited" | "final", default "outline"

### API Changes

- `PATCH /api/chapters/{id}` — accept `status` field in body.
- `GET /api/projects/{id}` — include `status` in each chapter's metadata.
- `GET /api/projects/{id}/dashboard` — new endpoint returning chapter list with all metadata + aggregated status counts.

### UI/UX Notes

- The dashboard should feel like looking at a manuscript's table of contents with metadata, not like a project management tool. Avoid Kanban boards, Gantt charts, or anything that feels like Jira.
- Status colors should be from the warm palette established in the MVP (earth tones, not traffic-light red/yellow/green).
- The dashboard is a third "mode" alongside Editor and Preview, accessible via a tab or icon in the top navigation.

### Dependencies

- MVP must be complete. The auto-save-on-chapter-switch behavior must be stable before chapter navigation shortcuts are added.

---

## Phase 2: Goals & Velocity
<!-- plan: 2026-04-01-goals-velocity-design.md -->

### Goal

Help the writer answer: "Am I on track? How fast am I actually writing? When will I finish?" Writers are notoriously bad at estimating their own pace — Smudge should make their velocity visible, not judge it.

### Features

#### 2.1 Project Targets

A writer can set two optional targets for a project:

- **Word count target:** e.g., 80,000 words.
- **Deadline:** e.g., September 1, 2026.

Either, both, or neither can be set. These are displayed in the project dashboard and status bar.

#### 2.2 Daily Word Count Tracking

Smudge records the total manuscript word count at the end of each calendar day (or on the last save of the day). This produces a daily word count history — a time series of total words over time.

**Timezone handling:** All daily boundaries, session grouping, and streak calculations use the writer's configured timezone — not UTC. The timezone defaults to the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone` on first launch and is stored as an app-level setting. This prevents a writing session at 11:30pm local time from being counted on the wrong calendar day.

From this, Smudge can derive:

- **Words written today:** Difference between current count and start-of-day count (in the writer's timezone).
- **Daily average:** Rolling average over the last 7/14/30 days (writer-selectable).
- **Projected completion date:** If a word count target is set, calculate: remaining words / daily average = days remaining. Display as a date.

#### 2.3 Session Tracking

Sessions are **derived from save history**, not tracked as explicit server-side objects. A "session" is defined as any cluster of saves to the same project where no gap between consecutive saves exceeds 30 minutes. The server computes sessions on demand from chapter `updated_at` timestamps.

This approach eliminates orphaned sessions, handles project switching, browser tab idling, and server restarts without any special-case logic.

Session stats derived:

- **Added words:** Sum of positive word count changes between consecutive saves within the session. This is an approximation — it undercounts on editing-heavy sessions where the writer simultaneously deletes and writes new text. But for most writing sessions (primarily adding new content), it's a useful signal. Transaction-level tracking could improve accuracy in a future iteration.
- **Net words:** Net change in manuscript word count across the session (can be negative on editing days).
- **Duration:** Time between first and last save in the session. This measures time spent *producing*, not time spent staring at a blank page.
- **Session summary:** Shown when the writer returns to the editor or opens the dashboard: "Last session: 45 minutes, +1,200 added words, +800 net words."

#### 2.4 Writing Velocity Dashboard

An addition to the project dashboard (Phase 1) showing:

- **Burndown chart:** If a target and deadline are set, a classic burndown showing planned pace vs. actual pace.
- **Daily word count bar chart:** Last 30 days, showing daily net word count.
- **Streaks:** Current consecutive-days-written streak and all-time best streak. Not gamification for its own sake — consistency tracking is genuinely useful for writers building a habit. Displayed subtly, not as a pop-up achievement.

#### 2.5 Per-Chapter Targets (Optional)

A writer can optionally set a target word count for individual chapters ("this chapter should be roughly 4,000 words"). If set, the status bar shows progress toward the chapter target alongside the actual count. This helps with pacing — if a chapter is running long, the writer notices early.

### Data Model Changes

**Project** — add columns:
- `target_word_count` — integer, nullable
- `target_deadline` — date, nullable

**Chapter** — add column:
- `target_word_count` — integer, nullable

**App-level settings** (new — a simple key-value table or config file):
- `timezone` — text, e.g. "Europe/Malta". Defaults from browser on first launch.

**New table: DailySnapshot**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `date` — date (unique per project; in the writer's configured timezone)
- `total_word_count` — integer
- `created_at` — timestamp

No WritingSession table — sessions are derived from save timestamps on demand.

### API Changes

- `PATCH /api/projects/{id}` — accept `target_word_count`, `target_deadline`.
- `PATCH /api/chapters/{id}` — accept `target_word_count`.
- `GET /api/projects/{id}/velocity` — returns daily snapshots, derived session history, calculated averages, projected completion date. Sessions are computed server-side from chapter save timestamps grouped by the configured timezone.
- `GET /api/settings` — returns app-level settings (timezone, etc.).
- `PATCH /api/settings` — update app-level settings.

### UI/UX Notes

- Velocity data should be encouraging, never judgmental. No "you're behind schedule!" alarms. The tone is informational: "At your current pace, you'll reach 80,000 words around September 15." If the writer is behind, they can see it — Smudge doesn't need to editorialize.
- Charts should use the warm color palette. Consider using Recharts (already in the React ecosystem) for the burndown and daily bar chart.
- Session tracking should be entirely invisible during writing. The writer should never be aware of sessions starting or ending while they're in flow. Session summaries are shown when the writer returns to the editor or opens the dashboard, not as interruptions.
- Streaks reset if the writer doesn't write on a calendar day (in their configured timezone). They do not penalize weekends or days the writer explicitly marks as "off" (a future enhancement could add rest days).
- "Added words" should be labeled clearly with a tooltip explaining what it measures and that it's an approximation. Don't call it "gross words" — that implies precision it doesn't have.

### Dependencies

- Phase 1 (dashboard view exists to host velocity data).

---

## Phase 2.5a: Simplify Progress Model
<!-- plan: 2026-04-11-simplify-progress-model-design.md -->

### Goal

Reduce the velocity and progress system to what a writer actually needs: "Am I roughly on track?" The Phase 2 implementation grew toward a save-event analytics pipeline; this phase simplifies it to project-level targets, daily word count totals, and simple pace math. See `docs/simplification-roadmap.md` for the full architectural rationale.

### Features

#### 2.5a.1 Simplify Progress Calculations

Reduce the velocity API to compute from `daily_snapshots` only:

- Words written today
- 7/30-day rolling average
- Remaining words (from project target)
- Days until deadline
- Required pace vs. actual pace
- Projected completion date

This is enough to display a calm, helpful status message:

> 41,200 / 80,000 words. 52 days left. Needed pace: 746 words/day. Recent pace: 680 words/day.

#### 2.5a.2 Demote Save Events

Remove `save_events` from the critical save path. The table can remain for diagnostic purposes but should not drive user-facing features. Remove:

- Server-side derived sessions
- Streaks
- Burndown charts
- `completion_threshold` on projects

#### 2.5a.3 Simplify Velocity Dashboard

Replace the burndown chart and session-based stats with a simple daily word count display and pace summary. The dashboard should show:

- Daily word count (last 30 days)
- Rolling average pace
- Projected completion (if targets set)
- No session tracking, no streaks, no gamification

### Data Model Changes

**Remove columns:**
- `projects.completion_threshold`

**Demote tables:**
- `save_events` — stop writing to this table from the save path; mark as deprecated

**Keep unchanged:**
- `projects.target_word_count`
- `projects.target_deadline`
- `daily_snapshots`
- `settings` (timezone)

### API Changes

- `GET /api/projects/{id}/velocity` — simplify to return only: daily totals, rolling averages, and projected completion. Remove session data, streak data, and burndown data.

### UI/UX Notes

- The goal is *less* UI, not different UI. Remove complexity rather than replacing it.
- The velocity display should feel like a gentle status line, not an analytics dashboard.

### Dependencies

- Phase 2 (Goals & Velocity must exist to be simplified).

---

## Phase 2.5b: Storage Architecture
<!-- plan: 2026-04-12-storage-architecture-design.md -->

### Goal

Introduce clean internal abstractions that separate manuscript storage, draft recovery, and history. This creates seams for the future desktop transition (Phase 8) while making the current architecture easier to reason about. See `docs/simplification-roadmap.md` for the full architectural rationale.

### Features

#### 2.5b.1 ProjectStore Abstraction

Create an internal `ProjectStore` interface that encapsulates all project and chapter data access. Currently, repositories access the SQLite database directly; this layer sits between services and repositories, providing a clean boundary for future storage model changes.

#### 2.5b.2 AssetStore Abstraction

Define an `AssetStore` interface for managing non-manuscript files (images, research documents). This prepares for Phase 4a's image handling and Phase 6a's research library with a consistent storage API. Assets can be:

- **Managed:** copied into a project-local directory
- **Linked:** referenced by path, original stays in place

#### 2.5b.3 SnapshotStore Abstraction

Define a `SnapshotStore` interface for chapter snapshots (manual, automatic, pre-destructive-operation). This prepares for Phase 4b's snapshot feature with a clean API boundary.

### Data Model Changes

No schema changes. This phase introduces code-level abstractions (interfaces/classes) over the existing database.

### API Changes

No API changes. This is an internal refactoring.

### UI/UX Notes

- No user-facing changes. This is purely architectural.

### Dependencies

- Phase 2.5a (progress simplification should be complete before adding new abstractions).

---

## Phase 3a: Export Foundation
<!-- plan: 2026-04-14-export-foundation-design.md -->

### Goal

Turn the manuscript into a deliverable. A book isn't finished until it can leave the tool it was written in. This phase builds the export pipeline and supports the lightweight formats (HTML, Markdown, plain text).

### Features

#### 3a.1 Export Formats

| Format | Use Case | Implementation Approach |
|--------|----------|------------------------|
| **HTML** | Web publication, email to readers | TipTap `generateHTML()` on each chapter's JSON. Wrap in a complete HTML document with embedded CSS for reading typography. |
| **Markdown** | Version control, portability, static site generators | Convert TipTap JSON to Markdown. Use a library like `tiptap-markdown` or write a custom serializer from the JSON tree. |
| **Plain text** | Maximum portability, backup | Strip all formatting, concatenate chapter text with chapter title headers and separator lines. |

#### 3a.2 Export Structure

All exports include:

- **Title page:** Project title, author name (new field needed — see data model).
- **Table of contents:** Generated from chapter titles. For HTML, this is navigable.
- **Chapter structure:** Each chapter starts as a new section (HTML) with the chapter title as a heading.
- **Consistent typography:** Export uses the same serif reading font as the preview, or a close equivalent for the format.

#### 3a.3 Export Configuration

Before exporting, a simple dialog lets the writer set:

- **Format:** Select from the available formats.
- **Author name:** Defaults to a project-level setting, editable per export.
- **Include TOC:** Yes/No (default: Yes for formats that support it).
- **Chapter selection:** Export all chapters, or select a subset. Useful for sending a sample to an agent.
- **Status filter:** Optionally exclude chapters below a certain status (e.g., "export only chapters marked Edited or Final").

**Soft-deleted chapters are always excluded from export.** If a chapter in the `chapter_ids` list has been soft-deleted, it is silently omitted and the export proceeds with the remaining chapters.

#### 3a.4 Export as Download

The export generates a file and offers it as a browser download. No email, no cloud storage. The file name defaults to the project title with the appropriate extension.

#### 3a.5 Export Pipeline Architecture

The export pipeline is designed as a series of composable steps so that later phases can inject new behavior without refactoring:

1. **Gather content** — collect chapters (filtered by selection, status, excluding soft-deleted).
2. **Apply filters** — strip inline notes (Phase 4c), strip fact-check marks (Phase 6a), apply any content transformations.
3. **Generate structure** — add title page, TOC, chapter headings, footnotes/endnotes (Phase 6a), bibliography (Phase 6a), appendices (Phase 5).
4. **Render to format** — convert the structured content to the target file format.

Steps 2 and 3 are initially no-ops or minimal in Phase 3a; later phases add new filter and structure steps without touching the core pipeline.

### Data Model Changes

**Project** — add column:
- `author_name` — text, nullable (used in export title page and metadata)

**Extend app settings:**
- Default export format

### API Changes

- `POST /api/projects/{id}/export` — body: `{ format, author_name, include_toc, chapter_ids (optional), min_status (optional) }`. Returns the generated file as a binary download with appropriate Content-Type and Content-Disposition headers. Initially supports `html`, `markdown`, `plaintext` formats.

### UI/UX Notes

- The export dialog should be simple — not a settings page with 30 options. Most writers will just pick a format and click "Export." Advanced options (chapter selection, status filter) should be collapsed/hidden by default.
- After export, a brief confirmation: "Exported 'Bread, Circuses, and GPUs' as HTML." The word count in the confirmation gives the writer a sense of their manuscript's physicality.
- Export should feel like a proud moment, not a chore. The confirmation could include the total word count as a subtle celebration.

### Dependencies

- Phase 1 (chapter statuses, for the status filter in export config).
- The TipTap JSON -> HTML pipeline from the MVP preview mode is reused here as the foundation for all exports.

---

## Phase 3b: Document Export
<!-- plan: 2026-04-14-document-export-design.md -->

### Goal

Add the heavyweight export formats that writers need for professional workflows: PDF for print/submissions, Word for editors and publishers, EPUB for e-readers.

### Features

#### 3b.1 Export Formats

| Format | Use Case | Implementation Approach |
|--------|----------|------------------------|
| **PDF** | Print, formal submissions | Generate HTML first, then convert to PDF via Puppeteer (headless Chrome) or a library like `pdf-lib` / `react-pdf`. Puppeteer gives the most accurate rendering but adds a heavy dependency; evaluate trade-offs. |
| **Word (.docx)** | Editors, publishers, agents (the industry standard) | Use `docx` npm package to generate .docx programmatically from the TipTap JSON. Requires mapping TipTap node types to docx paragraph styles. |
| **EPUB** | E-readers, Kindle, self-publishing | Use `epub-gen-memory` or similar. Each chapter becomes an EPUB section. Requires cover image support (optional, or a default). |

These formats extend the export pipeline and config dialog built in Phase 3a. The export dialog gains three new format options; the pipeline gains three new renderers in step 4.

#### 3b.2 Format-Specific Structure

- **PDF/Word:** Each chapter starts on a new page. Table of contents includes page numbers.
- **EPUB:** Each chapter becomes a navigable section. TOC is built into the EPUB navigation.

### API Changes

- `POST /api/projects/{id}/export` — gains `pdf`, `docx`, `epub` format options (extends Phase 3a endpoint).

### UI/UX Notes

- After export, the confirmation should include format-specific detail: "Exported 'Bread, Circuses, and GPUs' as PDF (142 pages)."

### Implementation Notes

- PDF generation is the trickiest format. Puppeteer is the most reliable approach (render HTML in headless Chrome, print to PDF) but it's a ~400MB dependency. For a Docker-based app this is fine (Puppeteer runs in the container). For the eventual Electron app, this is heavy — consider lighter alternatives at that point.
- EPUB has specific metadata requirements (OPF manifest, NCX navigation). Libraries handle most of this, but test with real e-readers (Kindle, Apple Books) to catch rendering issues.
- Word export should map TipTap formatting to Word styles (Heading 1, Heading 2, Normal, Block Quote) so the exported document is properly structured, not just visually formatted.

### Dependencies

- Phase 3a (export pipeline, config dialog, and download mechanism must exist).

---

## Phase 4a: Reference Panel & Images
<!-- plan: 2026-04-15-reference-panel-images-design.md -->

### Goal

Build the shared infrastructure used by all later annotation and reference features: a collapsible side panel alongside the editor, and image upload/storage.

### Features

#### 4a.1 Reference Panel Infrastructure

A right-side panel alongside the editor, designed as a generic container that can host different content types via a tab or stack interface. In this phase, the panel is built as empty infrastructure. Later phases add tabs:

- Notes panel, Tags panel, Outtakes panel (Phase 4c)
- Character sheets, Scene cards (Phases 5a, 5b)
- World-building entries (Phase 5c)
- Research library, Citations (Phase 6a)
- Argument structure (Phase 6b)

**Design:** The panel is collapsible, resizable, and keyboard-accessible. It can be toggled via a shortcut. Each content type is a tab within the panel. The panel remembers its last state (open/closed, active tab, width) across sessions.

Building this as shared infrastructure now prevents duplicating effort between later phases. Either fiction or non-fiction mode can come first — neither depends on the other.

#### 4a.2 Image Handling

Writers commonly want images in multiple contexts: reference photos for characters, maps for world-building, diagrams in non-fiction, illustrations within chapters. TipTap supports image nodes, so a writer might paste an image into the editor at any point.

**Implementation:**
- Images are stored as files on disk in the Docker volume alongside the SQLite database (e.g., `/app/data/images/`).
- A simple `/api/images` upload endpoint accepts an image file and returns a URL path.
- TipTap's built-in image extension is enabled, allowing images in chapter content, outtakes, and (in later phases) world-building entries, character sheet notes, research source notes, and journal entries.
- Accepted formats: JPEG, PNG, GIF, WebP. Maximum file size: 10MB per image.
- Images are referenced by URL in the TipTap JSON. Deleting an image node from the document does not delete the file (avoids data loss if the writer undoes). Orphaned image cleanup can be a background task.

**Export integration:** When exporting (Phase 3 pipeline), images referenced in chapter content are embedded in the output file (base64 for HTML, embedded for EPUB/DOCX, rendered for PDF). This phase should also add EPUB cover image support (deferred from Phase 3b) — EPUB natively supports cover images, and the image infrastructure built here makes it straightforward.

### Data Model Changes

No new database tables. The reference panel is UI-only state. Images are stored as files on disk.

### API Changes

- `POST /api/images` — upload an image file. Returns `{ url }`.

### Dependencies

- MVP (TipTap editor with extension support).

---

## Phase 4b: Snapshots & Find-and-Replace
<!-- plan: 2026-04-16-snapshots-find-replace-design.md -->

### Goal

Give the writer a safety net (snapshots) and a powerful editing tool (project-wide find-and-replace), with the safety net protecting against the editing tool's destructive potential.

### Features

#### 4b.1 Manual Snapshots

Manual snapshots of a chapter at a point in time.

- The writer can take a snapshot with an optional label: "v1 — rough draft," "v2 — after structural edit," "before cutting the flashback."
- Snapshots are read-only copies of the chapter's TipTap JSON at that moment.
- A "History" panel for each chapter shows all snapshots, with dates and labels.
- The writer can view a snapshot (read-only) or restore it (replaces current content, with confirmation).
- A diff view between the current content and any snapshot would be ideal but is technically complex (TipTap JSON diffing is not trivial). Defer the diff to a later enhancement; start with view-and-restore.

**Automatic snapshots:** In addition to manual snapshots, Smudge creates automatic snapshots before destructive operations (see §4b.2 find-and-replace). These are labeled with the operation that triggered them.

#### 4b.2 Find and Replace Across Manuscript

Project-wide find and replace — not just the current chapter. Critical for: renaming a character, fixing a recurring typo, changing a place name.

- Search across all chapters (or filter to current chapter only).
- Results are grouped by chapter with surrounding context.
- Replace one, replace all in chapter, replace all in manuscript.
- Match case, whole word options.
- Search counts displayed: "Found 17 occurrences in 8 chapters."

**Safety: automatic snapshots before replace-all.** Before executing a "replace all in manuscript" or "replace all in chapter" operation, Smudge automatically creates a snapshot of every affected chapter, labeled "Before find-and-replace: '[search term]' -> '[replacement]'". This gives the writer a recovery path via the snapshot history (§4b.1).

**Editor synchronization:** The replace-all workflow is: (1) force-save the current chapter (flush any pending debounced changes), (2) execute the replacement server-side across all chapters, (3) the API returns the list of affected chapter IDs, (4) if the currently-open chapter was affected, reload its content from the server into the editor. This follows the same force-save pattern used for chapter switching in the MVP.

### Data Model Changes

**New table: ChapterSnapshot**
- `id` — UUID, primary key
- `chapter_id` — foreign key -> Chapter
- `label` — text, nullable
- `content` — text (TipTap JSON)
- `word_count` — integer
- `created_at` — timestamp

### API Changes

- `POST /api/chapters/{id}/snapshots` — create a manual snapshot (body: optional label).
- `GET /api/chapters/{id}/snapshots` — list snapshots for a chapter.
- `GET /api/snapshots/{id}` — get snapshot content.
- `POST /api/snapshots/{id}/restore` — restore a snapshot (replaces chapter content, with automatic pre-restore snapshot).
- `POST /api/projects/{id}/search` — body: `{ query, options (case_sensitive, whole_word, chapter_ids) }`. Returns matches with context, grouped by chapter.
- `POST /api/projects/{id}/replace` — body: `{ search, replace, options, scope (chapter_id or "all") }`. Auto-snapshots affected chapters before replacing. Returns count of replacements and list of affected chapter IDs.

### UI/UX Notes

- Find and replace is a modal or panel (not a separate page). It should be keyboard-first: Ctrl/Cmd+H opens it, typing starts searching immediately.
- Snapshots should feel like a safety net, not a version control system. The UI should be simple: a chronological list with labels and dates, one-click restore with confirmation.

### Dependencies

- MVP (TipTap editor with extension support).

---

## Phase 4b.1: Editor Orchestration Helper
<!-- plan: 2026-04-19-editor-orchestration-helper-design.md -->

### Goal

Extract the shared "mutate editor content via the server" shape — save-flush, markClean, setEditable, server call, reload — into a single helper. Eliminate the temporal coupling that produced recurring data-loss bugs during Phase 4b.

### Why Now

Phase 4b required 16 rounds of review. Pattern analysis showed the dominant cause was divergent re-implementations of this shape across replace, restore, and chapter-switch paths. Every future phase that mutates chapter content from the server (4c, 5b, 7e) will hit the same rake until this is extracted.

### Scope

Editor mutation flows in `packages/client/src/` currently implemented ad-hoc in `EditorPage.tsx`, `Editor.tsx`, and `useProjectEditor.ts` are rewired to a single helper. The helper enforces CLAUDE.md §Save-Pipeline Invariants.

### Out of Scope

- New features or UX changes.
- Changes to the server-side save path.
- Consolidating error-mapping (Phase 4b.3).

### Definition of Done

- All editor-mutation call sites route through the helper.
- A regression test for the unmount-clobber bug is committed and passing.
- No behavior change visible to the user.

### Dependencies

- Phase 4b (merged 2026-04-19).
- Should land before Phase 4c.

---

## Phase 4b.2: Abortable Sequence Hook
<!-- plan: 2026-04-22-abortable-sequence-hook-design.md -->

### Goal

Replace the ad-hoc sequence refs scattered across the client (`saveSeqRef`, `selectChapterSeqRef`, `searchSeqRef`, `viewSeqRef`, and similar) with a single reusable primitive that makes the "discard stale response" contract explicit.

### Why Now

Each ad-hoc seq-ref is individually correct but their interactions are implicit, which is how stale-closure bugs kept slipping through review in Phase 4b. A single primitive with a tested contract prevents the next flow (reordering, imports, tag edits) from adding a fifth variant.

### Scope

Introduce a hook — shape to be decided at design time — that returns a current sequence value, a bump operation, and a staleness check. Migrate existing seq-refs to use it.

### Out of Scope

- Changes to abort-signal propagation on `fetch` calls (separate concern).
- Server-side sequencing.

### Definition of Done

- No free-standing `seqRef` patterns remain in `packages/client/src/`.
- Tests cover the staleness contract directly.
- Behavior unchanged from the user's perspective.

### Dependencies

- Phase 4b (merged 2026-04-19). Independent of 4b.1; may run in parallel.

---

## Phase 4b.3: Unified API Error Mapper
<!-- plan: 2026-04-23-unified-error-mapper-design.md -->

### Goal

Collapse the three drift-prone error-mapping code paths (search catch, replace errors, generic fallback) into one module that turns API error envelopes into UI strings from `strings.ts`. No raw server text ever reaches the UI.

### Why Now

Error-copy drift was a recurring finding during Phase 4b review — each path was independently correct but they inconsistently handled the same error codes. One mapper makes the contract enforceable and eliminates a class of review findings.

### Scope

One module responsible for all API-error-to-UI-string mapping in the client. All call sites that currently format error text route through it.

### Out of Scope

- Server-side error envelope shape (already defined; see CLAUDE.md §API Design).
- Changes to the `strings.ts` externalization approach itself (Phase 4b.4).

### Definition of Done

- Only one module owns API error → UI string translation.
- No call site contains inline error-to-text mapping.
- All strings emitted by the mapper come from `strings.ts`.

### Dependencies

- Phase 4b (merged 2026-04-19). Independent of 4b.1 and 4b.2.

---

## Phase 4b.3a: 4b.3 Review Follow-ups (Clusters A, D, F)
<!-- plan: 2026-04-25-4b3a-review-followups-design.md -->

### Goal

Address Clusters A (scope-coverage gaps), D (sanitizer hardening), and F (PR-shape retrospective) from the Phase 4b.3 code review (`paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`). The original 4b.3a scope also covered Clusters B, C, and E; those have been split out into Phases 4b.3b, 4b.3c, and 4b.3d so each can ship as a single PR per CLAUDE.md §Pull Request Scope.

### Status

Done.

### What Shipped

**Cluster A — Scope-coverage gaps** (`packages/client/src/errors/scopes.ts`)

- [I1] `chapter.reorder` `byCode: { REORDER_MISMATCH: ... }` — commit `a9d622f`.
- [I2] `chapter.save` `network:` field and `byStatus: { 404: ... }` — commit `0a44166`; e2e at `69b2173`.
- [S1] `trash.restoreChapter` `byStatus: { 404: ... }` — commit `112d33e`.

Cluster A merged via `ovid/cluster-a-error-mapping` (merge `a0cacec`).

**Cluster D — Sanitizer hardening** (`packages/client/src/sanitizer.ts`, `packages/client/src/errors/scopes.ts`)

- [I14] `ALLOWED_URI_REGEXP` pinned to UUID-shaped `/api/images/{uuid}` paths (`115c519`, tightened to UUID form in `be96b70`); `uponSanitizeAttribute` hook on a private DOMPurify instance closes the DATA_URI_TAGS carve-out (`f7d067d`); `ALLOWED_ATTR` frozen at runtime to prevent silent allowlist widening (`2585866`); e2e snapshot-content coverage (`4c44c4a`, `31c8a04`).
- [S21] `image.delete.extrasFrom` bounds chapters at 50 entries / 200 chars per title (`07e1668`); later hardened to validate-then-bound with allowlist shape and surrogate-safe truncate (`c1d90ef`); reject empty-string (`a0a57f5`) and whitespace-only (`52a6699`) titles.

**Cluster B (partial) — AbortSignal API surface and ExportDialog cleanup**

- [I7] API surface — `api.projects.create` and `api.projects.delete` accept `signal?: AbortSignal` (`packages/client/src/api/client.ts`). Call-site threading from `HomePage` is **deferred to Phase 4b.3b**.
- [I8] API surface — `api.chapters.create` accepts `signal?: AbortSignal`. Call-site threading from `useProjectEditor.handleCreateChapter` is **deferred to Phase 4b.3b**.
- [I9] API surface — `api.chapterStatuses.list` accepts `signal?: AbortSignal`. The `EditorPage` retry-with-backoff refactor that consumes it is **deferred to Phase 4b.3b**.
- [I12] `ExportDialog` unmount cleanup — `abortRef` allocated and aborted on unmount (`packages/client/src/components/ExportDialog.tsx:36, 53-54, 133-134`).

**Cluster F — PR-shape retrospective (decision)**

- [I15] The 4b.3 one-feature-rule violation (sanitizer + CONTRIBUTING.md + Node-engines pin bundled with the error-mapper migration) is **accepted as a logged exception** in the design doc (`docs/plans/2026-04-25-4b3a-review-followups-design.md`). The corresponding CLAUDE.md `§Pull Request Scope` text update that records the exception is **deferred to Phase 4b.3d** alongside the other CLAUDE.md edits.

### Dependencies

- Phase 4b.3 (Unified API Error Mapper) merged.

---

## Phase 4b.14: Abortable Async Operation Hook

### Goal

Extract `useAbortableAsyncOperation` covering the "abort prior controller, create fresh, thread `signal` into the request, check `controller.signal.aborted` before setState, abort all on unmount" pattern. Migrate the four cross-confirmed hand-rolled controller refs in `useTrashManager` (open + restore), `useFindReplaceState`, and `ImageGallery` (file-select + save). Other AbortController sites in the client (~8 additional production files) are explicitly out of scope here — see "Out of Scope".

### Why Now

The prior dedup pass already landed `useAbortableSequence` for *response staleness*. `AbortController` solves the orthogonal problem of *network cancellation*; both are correct, neither subsumes the other. The four sites in scope here today encode the same four-step state machine independently, with detailed inline comments in `useTrashManager` that exist only because the abstraction is missing. A new list/detail/upload pane is likely to copy the nearest neighbour, and off-by-one cleanup-on-unmount is easy to miss. (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-13-33-4129d99.md` I3.)

**Re-ordered 2026-04-28** to land before Phase 4b.3b (AbortSignal Threading Completion). The /roadmap brainstorming pass on 2026-04-28 surfaced a collision: 4b.3b would add seven more hand-rolled instances of exactly the pattern this phase extracts, *before* the extraction lands. Doing 4b.14 first means 4b.3b's per-site evaluation can adopt the new hook where it fits and justify hand-rolled threading where it does not, instead of growing the duplication footprint and then cleaning it up later.

### Scope

- Add `useAbortableAsyncOperation()` in `packages/client/src/hooks/`. Suggested shape: `{ run<T>(fn: (signal: AbortSignal) => Promise<T>): { promise; signal }, get aborted(): boolean }`. Auto-abort on unmount via the cleanup effect.
- Add unit tests for the hook (abort-on-rerun, abort-on-unmount, signal threading).
- Migrate one site at a time behind characterization tests:
  - `useTrashManager.ts:55–60` (`openTrash`)
  - `useTrashManager.ts:80–85` (`handleRestore`)
  - `useFindReplaceState.ts:212–213` (instantiation in `search`), `:259` (post-response cleanup); the unmount cleanup at `:100–104` and the project-change cleanup at `:130–131` are subsumed by the new hook's auto-abort effect
  - `ImageGallery.tsx:184–209` (`handleFileSelect`)
  - `ImageGallery.tsx:234–262` (`handleSave`)
- Hooks with two independent operations (trash) keep two hook instances — do not merge unrelated controllers.
- Do not migrate `useFindReplaceState`'s combined `AbortController` + `useAbortableSequence` pairing into a single primitive; keep both, since they solve different problems.

### Out of Scope

- Folding `useAbortableSequence` into the new hook. They solve different problems and are documented in CLAUDE.md as a contract.
- Migrating `useEditorMutation`'s save-cancellation. That hook is canonical for editor mutations and has its own state machine.
- Adding lint enforcement (consider in a follow-up if drift returns).
- The remaining AbortController sites in the client (`App.tsx`, `DashboardView.tsx`, `ExportDialog.tsx`, `ProjectSettingsDialog.tsx`, `SnapshotPanel.tsx`, `useProjectEditor.ts`, `useSnapshotState.ts`, `EditorPage.tsx`, `HomePage.tsx`). Each is its own evaluation: some thread through `useAbortableSequence` already, some are one-shot fetches whose lifecycle does not match this hook's contract, some are dialogs that have their own lifecycle hook coming in Phase 4b.16. Defer these until either a follow-up dedup pass or per-site migration shows the hook fits cleanly. Reassess after the four in-scope migrations have landed. **Phase 4b.3b's per-site evaluation will use this hook where it fits.**
- `Editor.tsx` paste/drop image upload — the original report listed this site, but on verification (`grep -n "AbortController\\|signal.aborted" packages/client/src/components/Editor.tsx` returns nothing) the path actually uses a `projectIdRef.current !== uploadProjectId` stale-id check, not an `AbortController`. Not a member of this dedup set.

### Definition of Done

- New hook in `packages/client/src/hooks/` with unit tests.
- All four in-scope sites migrated via PR-friendly, one-site-at-a-time changes behind characterization tests; do not bundle all four sites into a single extraction PR (the dedup report at `paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-13-33-4129d99.md` lines 145–146 explicitly says each migration is independently shippable).
- No raw `new AbortController()` + manual `signal.aborted` ladder remaining in those four sites. Other client files keep their existing controllers per "Out of Scope".
- All client tests still green.
- `make all` green at PR close.
- No behavior change visible to the user.

### Dependencies

- Independent of all other 4b.X phases. May land in parallel with 4b.15 / 4b.16, since those touch hooks but in different files.
- **Blocks Phase 4b.3b** as of the 2026-04-28 reorder; 4b.3b's per-site evaluation depends on this hook existing.

---

## Phase 4b.3b: AbortSignal Threading Completion

### Goal

Finish Cluster B from the Phase 4b.3 code review (`paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`). Phase 4b.3a shipped the `api/client.ts` surface so every endpoint accepts `signal?: AbortSignal` and shipped the [I12] ExportDialog cleanup. The remaining consumer call sites still either allocate ad-hoc `cancelled` flags or omit the signal entirely; this phase threads signals through them.

### Why Now

CLAUDE.md `§Save-pipeline invariants` rule 4 (bump-the-sequence-before-the-request) is enforced by `useAbortableSequence`, but it depends on the underlying request being cancellable. While these consumers ship without signals, an in-flight response can land on a stale closure and re-set state after the user has navigated away — the same drift `useAbortableSequence` exists to prevent. Landing this before Phase 4b.3c's [S10] is required because the dev-warn gate uses `signal.aborted`.

**Reordering (2026-04-28).** This phase now depends on Phase 4b.14 (`useAbortableAsyncOperation`) landing first. The /roadmap brainstorming pass on 2026-04-28 surfaced a collision with finding I3 of the experimental-dedup pass (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-13-33-4129d99.md`): the eight client AbortController sites are deferred in I3 pending per-site evaluation after the new hook is proven on the four cross-confirmed sites (`useTrashManager`, `useFindReplaceState`, `ImageGallery`). Threading hand-rolled signals through this phase's call sites *before* the hook lands would add to the duplication footprint that 4b.14 was created to reduce. Each call site below will be re-evaluated against the new hook at brainstorm time: where the hook fits, the site migrates to it; where the lifecycle does not match (e.g., sites paired with `useAbortableSequence`), the hand-rolled threading is justified per-site. [I6] has already been removed (see below).

### Scope

- ~~[I6] `Editor.tsx` paste/drop image upload~~ — **removed 2026-04-28.** The experimental-dedup pass finding I3 explicitly excluded this site: `Editor.tsx:315–330` does not currently use an `AbortController`; the path uses a `projectIdRef.current !== uploadProjectId` stale-id check, and the original specialist hit was characterized as a false positive. Adding an AbortController here would contradict the dedup author's per-site evaluation. If a real bug appears at this site later, open a new phase with concrete evidence rather than restoring this item.
- [I7] `HomePage` call-site threading — `HomePage.tsx:61` (`api.projects.create`) and `:104` (`api.projects.delete`) currently omit the signal even though the API surface accepts it. Re-evaluate against `useAbortableAsyncOperation` at brainstorm time; if the hook fits, migrate to it. Otherwise allocate per-handler `AbortController`s and abort on unmount, with a per-site justification for not using the hook.
- [I8] `useProjectEditor.handleCreateChapter` (`packages/client/src/hooks/useProjectEditor.ts:577`) — `api.chapters.create(slug)` omits the signal. Re-evaluate against `useAbortableAsyncOperation`; the recovery branch's `createRecoveryAbortRef` is a strong candidate for migration, the primary POST may or may not fit depending on how the hook composes with the existing `useAbortableSequence` pairing in this hook.
- [I9] `EditorPage` chapterStatuses retry-with-backoff (`packages/client/src/pages/EditorPage.tsx:1224`) — replace `let cancelled = false` and the setTimeout-queue with `AbortController` semantics. Re-evaluate against `useAbortableAsyncOperation`; the retry-with-backoff lifecycle (multiple sequential calls under one logical operation) may not fit the hook's single-run shape and could remain hand-rolled with a justification.
- [I10] `loadProject` (`useProjectEditor.ts:204-268`) — replace the `let cancelled = false` flag with `AbortController` semantics. Re-evaluate against `useAbortableAsyncOperation`; this is a strong fit candidate (single effect-scoped operation that auto-aborts on slug change / unmount).
- [I11] `api.search.replace` at `EditorPage.tsx:775` and `:1018` — neither call site threads a signal. Re-evaluate against `useAbortableAsyncOperation`; the call already runs through `useEditorMutation`, so the hook fit may be limited and a `replaceAbortRef` paired with the mutation may be the right shape.
- [S12] `api.chapters.get` signal threading at remaining `useProjectEditor.ts` call sites (lines 245, 704, 757). The fourth call site (line 849) already threads a signal. These are paired with `selectChapterSeq` (a `useAbortableSequence`) for epoch checks; the `AbortController` complement is orthogonal. Likely keeps a hand-rolled `selectChapterAbortRef` pattern, since 4b.14's "Out of Scope" explicitly notes that the `useAbortableSequence`-paired sites stay paired.

### Out of Scope

- API-surface changes to `api/client.ts` (already shipped in 4b.3a).
- Cluster C consumer recovery work (Phase 4b.3c).
- Cluster E mapper-internals work (Phase 4b.3d).
- Behaviour changes visible to the user; this phase is correctness-and-observability only.
- Re-introducing [I6] without new evidence beyond the dedup pass's per-site evaluation.

### Definition of Done

- All remaining scoped call sites pass `signal` to the underlying API call, via `useAbortableAsyncOperation` where it fits and a per-site-justified hand-rolled `AbortController` where it does not.
- `loadProject` and the EditorPage chapterStatuses retry both abort on cleanup; no `let cancelled = false` flags remain in either site.
- Tests added for unmount-mid-flight at each touched site (CLAUDE.md `§Testing Philosophy`).
- `make all` green.

### Dependencies

- Phase 4b.3a (signal-bearing API surface).
- **Phase 4b.14** (`useAbortableAsyncOperation`) — added 2026-04-28; each call site is re-evaluated against this hook before threading. Independent of 4b.3c and 4b.3d at the file level; Phase 4b.3c [S10] depends on this one.

---

## Phase 4b.3c: Consumer Recovery Completeness

### Goal

Address Cluster C from the Phase 4b.3 code review (`paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`): 15 items where consumers of `mapApiError` mishandle the mapper's output (drop `possiblyCommitted`, silently dismiss errors, duplicate consumer ladders) or where flows lack a dedicated scope. Foundation for the work is `applyMappedError`, a small helper that replaces the 30+ hand-rolled `if (message === null) return; if (message) setX(message)` ladders.

### Why Now

The Phase 4b.3 unified error mapper centralized code-to-string translation, but the 4b.3 review found consumer-side drift: scopes declare `committed:` copy that consumers ignore; recovery branches silently drop dialogs; one-shot recovery `AbortRef`s leak across renders. Each item is small individually, but the absence of a shared `applyMappedError` helper means the same mistake is reintroduced every time a new caller is written. Ships before Phase 4b.4 so the raw-strings lint rule runs against a clean baseline.

### Scope

**Foundation**

- Introduce `packages/client/src/errors/applyMappedError.ts` accepting a `MappedError<S>` plus `{ onMessage, onTransient?, onCommitted?, onExtras? }`. Tests-first; export from `errors/index.ts`. Consumed by [S15] migrations.
- Introduce `ScopeExtras<S>` type alongside the helper (paired with [S9] in Phase 4b.3d).

**Consumer fixes**

- [I3] `SnapshotPanel.handleCreate` (`packages/client/src/components/SnapshotPanel.tsx:305`) — destructure `possiblyCommitted` from `mapApiError`; on success-but-committed, hide create form, clear label, refetch snapshots.
- [I4] `useTrashManager.handleRestore` `possiblyCommitted` branch — refresh `project.chapters` and reseed `confirmedStatusRef` (mirror `handleCreateChapter`'s recovery branch).
- [I5] `useTrashManager.confirmDeleteChapter` — surface mapped error before dismissing the dialog.
- [S3]/[S7] Move `chapter.save` non-2xx BAD_JSON dispatch into the scope (extend `committedCodes` semantics or add `terminalCodes`); remove the call-site allowlist hardcode in `useProjectEditor.ts:357-369, 441-448`.
- [S4] `handleStatusChange` (`useProjectEditor.ts:1032-1040`) — fall back to `setError(message)` when `onError` is omitted (mirror `handleReorderChapters`).
- [S5] `useSnapshotState.restoreSnapshot` (`useSnapshotState.ts:421-434`) — track a `dispatched` flag; only synthesize a 200 BAD_JSON for failures that occurred *after* the request was sent.
- [S8] Reconcile `image.delete.extrasFrom` partial-malformed handling with the [I1]-era all-or-nothing guard. Three options documented in the original 4b.3a plan (drop, reconcile, replace [I1]); pick one and document the choice.
- [S10] Dev-only `console.warn` on silent recovery-catches in `handleStatusChange:1079` and `handleCreateChapter:604`, gated on `!signal.aborted`. Depends on Phase 4b.3b's signal threading. **Reordering note (2026-04-28):** if the recovery sites at `handleStatusChange:1079` and `handleCreateChapter:604` migrate to `useAbortableAsyncOperation` in Phase 4b.14 / 4b.3b, this gate may be re-expressible via the hook's internal `aborted` getter rather than a raw `signal.aborted` check. Re-evaluate the gate's surface during 4b.3c brainstorming after 4b.14 lands.
- [S11] `chapter.create` 404 — gate `isNotFound(err)` and call `navigate("/")` (mirror `EditorPage:1552`).
- [S15] Migrate the 30+ `if (message === null) return; if (message) setX(message)` ladders to `applyMappedError`. One commit per migrated site; mixed-catch sites get a behaviour-pinning test before migration.
- [S16] Add `chapter.flushBeforeNavigate` scope to `scopes.ts`; switch `EditorPage.tsx:1481-1485` to it.
- [S17] Null `createRecoveryAbortRef` after successful create.
- [S18] `Editor.tsx` paste announcement — capture `editorInstanceRef.current` at upload start; gate announcement on `editor === editorInstanceRef.current` to avoid firing on torn-down editor.
- [S19] Null `viewAbortRef` after successful `viewSnapshot`.
- [S20] `handleReorderChapters` — epoch re-check before `setProject` in the `possiblyCommitted` branch.

### Out of Scope

- Phase 4b.3b's signal-threading work (depended on by [S10]).
- Phase 4b.3d's CLAUDE.md / `ScopeExtras<S>` documentation.
- New API error codes or HTTP status codes (allowlist stays per CLAUDE.md `§API Design`).

### Definition of Done

- `applyMappedError` lands with full unit-test coverage (CLAUDE.md `§Testing Philosophy`).
- All 15 consumer items have a behaviour-pinning test before migration; tests pass after.
- `ScopeExtras<S>` type exported from `errors/index.ts`.
- `make all` green.

### Dependencies

- Phase 4b.3a (Unified API Error Mapper baseline + `committedCodes`).
- Phase 4b.3b ([S10] dev-warn gate uses `signal.aborted`).

---

## Phase 4b.3d: Mapper Internals & CLAUDE.md Updates

### Goal

Address Cluster E from the Phase 4b.3 code review: small mapper-internal hardenings, type-safety polish, and the deferred CLAUDE.md edit that documents the `committedCodes` extension and the `applyMappedError` consumer pattern. Closes the Phase 4b.3a follow-up backlog.

### Why Now

The CLAUDE.md update is the artifact that keeps the next contributor (or the next `/paad:agentic-architecture` run) from rediscovering the consumer-ladder pattern that Phase 4b.3c just removed. The four small refactors are independent of 4b.3c's migrations but read more cleanly once `applyMappedError` and `ScopeExtras<S>` are in place.

### Scope

- [S2] Update CLAUDE.md `§Key Architecture Decisions / "Unified API error mapping"` to describe (a) the `committedCodes` extension and the codes it handles, (b) `ScopeExtras<S>` as the typed `extras` accessor, (c) `applyMappedError(mapped, handlers)` as the canonical consumer pattern (parallel with `useEditorMutation` and `useAbortableSequence` references already in the doc).
- Update CLAUDE.md `§Pull Request Scope` with a one-line acknowledgement of the 4b.3 bundling exception (Cluster F [I15] follow-through).
- [S6] Wrap `safeExtrasFrom` dev-log in try/catch (`packages/client/src/errors/apiErrorMapper.ts`) — `import.meta.env?.DEV` access can throw under some test environments, inverting the must-never-throw guard.
- [S9] Drop the `extras.chapters` cast in `ImageGallery` once `ScopeExtras<S>` (introduced in Phase 4b.3c) makes it redundant; add a compile-time type-test in `errors/apiErrorMapper.test.ts`.
- [S13] Extract `refreshTrashList()` helper from `useTrashManager.ts:53-71` and `:158-178`; both sites call it.
- [S14] Dedupe `SnapshotPanel` mount effect at `:139-159` and `:164-189` — mount effect calls `fetchSnapshots()` directly; remove the duplicate.
- [S22]/[S23] PR-shape transparency for already-merged 4b.3 commits (`vitest.config.ts` worker cap and ESLint sequence-rule test infra adjustments). The 4b.3 PR is already merged, so retroactive splitting is impossible; instead, accept the bundling as part of the same exception logged for [I15], and verify the 4b.3 PR description contains a justification line for each. If missing, append a postscript comment to the merged PR rather than amending history. No code change.

### Out of Scope

- Re-running the full set of consumer migrations (Phase 4b.3c).
- New CLAUDE.md sections beyond the error-mapping update and the PR-scope acknowledgement.
- Amending the merged 4b.3 commit history ([S22]/[S23] resolved via PR-comment postscript only).

### Definition of Done

- CLAUDE.md `committedCodes` / `ScopeExtras<S>` / `applyMappedError` paragraph lands.
- All four code refactors pass tests; coverage at or above thresholds.
- `make all` green.
- Phase 4b.3a → Phase 4b.3d row in the Phase Structure table all marked Done.

### Dependencies

- Phase 4b.3c (`applyMappedError` and `ScopeExtras<S>` introduced there).

---

## Phase 4b.4: Raw-Strings ESLint Rule

### Goal

Make the "all UI strings live in `strings.ts`" rule (CLAUDE.md §String externalization) enforceable by lint instead of review vigilance. Fix existing violations to bring the client package to a clean baseline.

### Why Now

The externalization rule has been repeatedly violated despite being a documented CLAUDE.md requirement. Until lint enforces it, every PR risks reintroducing raw strings, and every reviewer spends time catching them by hand.

### Scope

- Configure an ESLint rule that rejects raw string literals in JSX and common UI surfaces within `packages/client/src/`.
- Tune the rule's allowlist (e.g. test files, type-level literals) to avoid false positives.
- Fix existing violations so the rule can run without warnings.

### Out of Scope

- Server-side strings (they don't reach the UI directly; already covered by API error mapper).
- `strings.ts` restructuring or namespacing.
- i18n extraction (Phase 7f).

### Definition of Done

- `make lint` fails on a new raw UI string.
- Current client code passes lint cleanly.
- No behavior change visible to the user.

### Dependencies

- Phase 4b (merged 2026-04-19). Independent of 4b.1–4b.3; may land last.

---

## Phase 4b.5: Editor State Machine

### Goal

Replace the scattered editor-state refs (`editable`, `editorLockedMessage`, `inFlightRef`, `reloadFailed`, `reloadSucceeded`) with a single state machine that owns the editor's operational state. Close the divergence gap between the lock banner and the editor's actual editable state, and add an explicit "committed but unreloaded" mutation stage covering the cases where the server succeeded but the client cannot confirm.

### Why Now

Pattern analysis across the six `ovid/architecture` code reviews (2026-04-19 to 2026-04-20) identified three recurring Critical findings that all trace to the same structural shape: editor state lives in N separate refs/state kept in sync by discipline. When any one diverges — stale `expectedChapterId` skip in `reloadActiveChapter`, 2xx `BAD_JSON` on a replace or restore response, a caller that forgets to clear the lock — the editor becomes editable while the banner still says "read-only", and the next keystroke's auto-save silently overwrites the committed server change. Phase 4b.1 centralized the *flow* but not the *state*; without this phase, Phases 4c / 5b / 7e will rediscover the same class of data-loss race.

### Scope

- One `EditorMutationState` primitive (shape decided at design time) that owns `{ editable, locked, busy }` as a machine driven by explicit events, not by independent setState calls.
- Extend `MutationResult.stage` with a `"committed_but_unreloaded"` variant covering:
  - 2xx `BAD_JSON` on replace / restore response bodies.
  - `expectedChapterId` skip where the hook would otherwise treat skip as success.
- Callers handle the new stage exhaustively (compile-time `: never` default) and route to the persistent lock banner.
- Migrate `editorLockedMessage` in `EditorPage.tsx` to read from the state machine rather than its own `useState` + side-effect clear on `chapterReloadKey`.

### Out of Scope

- New user-facing behavior.
- Changes to the server-side save path or response envelope.
- Migration of hand-composed flush sequences in external callers (covered under Phase 4b.1's "all call sites route through the helper" DoD).
- Codifying CLAUDE.md §Save-Pipeline Invariants as type constraints beyond the editor-mutation state itself.

### Definition of Done

- A single source of truth for the editor's `{ editable, locked, busy }` state — no free-standing `editorLockedMessage` / `inFlightRef` / `reloadFailed` / `reloadSucceeded` tracking.
- `MutationResult` includes `"committed_but_unreloaded"`; every caller handles it exhaustively.
- Regression tests cover the three Critical findings from the 2026-04-20 review: stale-`expectedChapterId` skip, 2xx `BAD_JSON` on replace, 2xx `BAD_JSON` on restore — each asserting the editor stays read-only and the lock banner stays visible.
- No behavior change visible to the user in the happy path.

### Dependencies

- Phase 4b.1 (Editor Orchestration Helper) — should land first; this phase tightens the state surface the helper operates on.
- Should land before Phase 4c (Notes, Tags & Outtakes), which adds a new class of content-mutating flow.

---

## Phase 4b.6: E2E Test Isolation

### Goal

Make the e2e harness bind to test-only ports and a test-only database so an e2e run alongside `make dev` cannot piggy-back on the dev server or touch the dev workflow's data.

### Why Now

Once the `ovid/shared-port-validation` branch lands, `packages/server/src/index.ts` will validate `SMUDGE_PORT` via the shared `parsePort` utility (`@smudge/shared`) and `packages/client/vite.config.ts` will validate `SMUDGE_PORT` / `SMUDGE_CLIENT_PORT` via an inline mirror of the same rules (vite's config resolver runs under bare Node ESM and cannot import `@smudge/shared`; the parity is enforced for the default port literal by `packages/shared/src/__tests__/vite-config-default-port.test.ts`). The explicit rationale on both sides is that the e2e harness would set these env vars to test-only ports for isolation. But `playwright.config.ts` hardcodes `port: 3456` / `port: 5173`, passes no `env`, and uses `reuseExistingServer: true` — so the env-var contract will have no consumer once the precursor branch merges, and the documented isolation rationale is forward-looking until this phase wires it up. Identified as OOSI1 in the `ovid/shared-port-validation` agentic review (2026-04-26).

### Scope

- Set `env: { SMUDGE_PORT, SMUDGE_CLIENT_PORT, DB_PATH }` to test-only values on each `webServer` entry in `playwright.config.ts`.
- Update the matching `port:` waits and the top-level `baseURL` to the test-only client port.
- Restore the present-tense isolation claim in `vite.config.ts:5-10` once the harness actually does what the comment says (the comment was made forward-looking under the same branch — this phase makes the original claim true).
- Confirm `make e2e` running alongside `make dev` does not collide on ports and does not share the dev database.

### Out of Scope

- Test-isolation concerns for unit/integration tests (they already use real SQLite per `CLAUDE.md` §Testing Philosophy).
- New env-var contracts beyond `SMUDGE_PORT` / `SMUDGE_CLIENT_PORT` / `DB_PATH`.

### Definition of Done

- `make e2e` and `make dev` can run simultaneously without port collisions.
- The e2e database is isolated from the dev database (different `DB_PATH`).
- The `vite.config.ts:5-10` comment reflects what `playwright.config.ts` actually does — no forward-looking TODO left behind.

### Dependencies

- The shared `parsePort` utility and env-driven port reading in `vite.config.ts` / `server/index.ts` (introduced in `ovid/shared-port-validation`) must be merged.

---

## Phase 4b.7: Test Warning-Pin Audit

### Goal

Make the CLAUDE.md §Testing Philosophy "Zero warnings in test output" rule enforceable in the existing test suite. Every `vi.spyOn(console, "warn"|"error")` install that suppresses output must either assert the expected call (pinning the production-side warn as part of the test's contract) or be removed if the spy is purely defensive against unrelated noise.

### Why Now

CLAUDE.md §Testing Philosophy says: *"When a test deliberately triggers an error path that logs a warning, spy on the output, suppress it, and assert the expected message — e.g. `const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); ... expect(warnSpy).toHaveBeenCalledWith(...); warnSpy.mockRestore();`."* The 4b.3a Cluster A code review (`paad/code-reviews/ovid-cluster-a-error-mapping-2026-04-27-14-13-42-91476d8.md`, finding I1) surfaced two tests violating this rule; a follow-up audit found 52 more across 9 files. Each unasserted spy is a contract that isn't pinned: a future change that drops or alters the production warn would silently pass. This phase closes that gap before Phase 4b.4's raw-strings lint rule lands, so the test suite is clean of latent contract gaps when lint-driven cleanup begins.

### Scope

Audit and fix all `vi.spyOn(console, …).mockImplementation(() => {})` installs that lack a corresponding `expect(spy).toHaveBeenCalled…` assertion in client test files. Each fix requires per-test contract analysis:

- **Production warn fires deliberately** → add `expect(spy).toHaveBeenCalledWith(…)` matching the production call site. Mirror the shape of the already-pinned tests in `useProjectEditor.test.ts:1290,1314,1334`.
- **Production warn fires defensively (e.g. unrelated library noise)** → either remove the spy entirely (let the warn through if it's harmless) or assert `expect(spy).not.toHaveBeenCalled()` to pin absence.
- **Multi-warn paths** → assert with `toHaveBeenCalledTimes(N)` plus `toHaveBeenNthCalledWith` where the order matters.

The 52 occurrences (post-I1 fix) are distributed:

| Count | File |
|---|---|
| 27 | `packages/client/src/__tests__/useProjectEditor.test.ts` |
| 6 | `packages/client/src/__tests__/DashboardView.test.tsx` |
| 4 | `packages/client/src/__tests__/EditorPageFeatures.test.tsx` |
| 4 | `packages/client/src/__tests__/HomePage.test.tsx` |
| 3 | `packages/client/src/__tests__/ProjectSettingsDialog.test.tsx` |
| 3 | `packages/client/src/hooks/useEditorMutation.test.tsx` |
| 2 | `packages/client/src/__tests__/ExportDialog.test.tsx` |
| 2 | `packages/client/src/hooks/useAbortableSequence.test.ts` |
| 1 | `packages/client/src/__tests__/useSnapshotState.test.ts` |

Consider whether a small ESLint rule (or test-side helper that wraps spy + assertion) could prevent regressions. If so, fold it into the phase; if not, document the manual review checkpoint in CONTRIBUTING.md.

### Out of Scope

- Server-side test files — server tests don't currently exhibit this pattern (no installs found under `packages/server/`).
- E2e tests — Playwright doesn't use vi.spyOn; warning discipline there is governed by browser console listeners, separate concern.
- Adding new tests beyond the assertions needed to pin existing spies. Coverage may rise as a side effect; do not chase it.
- Refactoring tests for unrelated reasons (mock setup, render helpers).

### Definition of Done

- Every `vi.spyOn(console, …)` install in `packages/client/src/` either asserts on the spy or is removed.
- A grep-based regression guard documented in CONTRIBUTING.md (or implemented as an ESLint rule) prevents new unasserted spy installs.
- Coverage thresholds in `vitest.config.ts` unchanged or higher; no minimum-floor coast.
- `make all` green at PR close.
- No behavior change visible to the user (this is a test-only phase).

### Dependencies

- Phase 4b.3a Cluster A merged (this phase exists because of an I1 finding from that review).
- Independent of Phase 4b.4 (Raw-Strings ESLint Rule); may land before, in parallel, or after. Landing before 4b.4 is mildly preferred so 4b.4's lint-driven cleanup operates on a contract-clean test suite.

---

## Phase 4b.8: TipTap Extension Consolidation

### Goal

Eliminate the byte-for-byte duplicated TipTap extension config that lives in both `packages/client/src/editorExtensions.ts` and `packages/server/src/export/editorExtensions.ts`. Move the array to `packages/shared/`; both packages become one-line re-exports. The parity test (`packages/server/src/__tests__/editorExtensions.test.ts`) — which today renders a reference doc through both configs and asserts identical HTML — becomes a single import-equality assert or is removed.

### Why Now

The two files declare the same StarterKit + Heading levels 3–5 + Image inline:false/allowBase64:false config and explicitly state in their headers that the configs "must match." A test enforces it. The parity-test pattern is the smell: the maintenance contract belongs in code, not in a test asserting two literals match. Adding a TipTap extension to one side without the other silently changes export rendering vs editor display until the parity test catches it after the fact. This is the lowest-risk extraction in the dedup backlog (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md` C1).

### Scope

- Create `packages/shared/src/editorExtensions.ts` exporting the shared array.
- `packages/client/src/editorExtensions.ts` and `packages/server/src/export/editorExtensions.ts` re-export from shared.
- Reduce or delete `packages/server/src/__tests__/editorExtensions.test.ts` — at most a sanity import-equality assert remains.

### Out of Scope

- Adding new TipTap extensions or changing the existing config.
- Restructuring `packages/shared/`'s public surface beyond the new file.

### Definition of Done

- One source declaration of the TipTap extension array.
- Both client and server import from shared.
- Parity test removed or reduced to import-equality.
- `make all` green at PR close.
- No behavior change visible to the user.

### Dependencies

- None. Phase 4b merged. Independently shippable.

---

## Phase 4b.9: Chapter Status Type Alignment

### Goal

Close the type-system gap where `Chapter.status: string` and `ChapterStatusRow.status: string` in `packages/shared/src/types.ts` denote a wider set than the Zod schema's `z.enum(["outline", "rough_draft", "revised", "edited", "final"])`. Replace the `string` declarations with a `z.infer` alias so the TS type matches the runtime contract.

### Why Now

Today, TypeScript silently accepts `chapter.status === "published"` typos because the static type is wider than the schema. Refactors that iterate over the literal set must reach for the schema rather than the type. Runtime safety is unaffected (Zod gates write paths), but the type system is not load-bearing where it should be (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md` I3).

### Scope

- Add `export type ChapterStatusValue = z.infer<typeof ChapterStatus>` to `packages/shared/src/schemas.ts`.
- Replace `status: string` with `status: ChapterStatusValue` in `Chapter` and `ChapterStatusRow` interfaces in `packages/shared/src/types.ts`.
- Surface and fix any callers comparing against unknown literals (TypeScript will identify them).

### Out of Scope

- DB or API changes — both already enforce the enum at write time.
- Migration of `chapter_statuses` table seed data.
- Renaming `ChapterStatus` (the schema export name).

### Definition of Done

- `Chapter.status` and `ChapterStatusRow.status` typed as `ChapterStatusValue`.
- `tsc` green; any caller using a string literal outside the enum fixed.
- `make all` green.
- No behavior change visible to the user.

### Dependencies

- None. Independently shippable. May land alongside or in parallel with 4b.8.

---

## Phase 4b.10: Shared TipTap Unsafe-Keys Set

### Goal

Eliminate the duplicate `__proto__`/`prototype`/`constructor` strip-set declared as `CANONICAL_UNSAFE_KEYS` in `packages/shared/src/tiptap-text.ts` and as `UNSAFE_KEYS` in `packages/server/src/snapshots/content-hash.ts`. Export a single set from `packages/shared/`; both consumers import it.

### Why Now

The two declarations describe the same prototype-pollution defense for TipTap canonicalization. A future change (e.g. adding `__defineGetter__` to the unsafe set) needs to land in both files; today nothing enforces that they agree (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md` I4). Full canonicalizer extraction is *blocked* by return-type mismatch — `tiptap-text.ts` returns a string, `content-hash.ts` returns an object — so this phase scopes only to the unsafe-key set, which is trivially shareable.

### Scope

- Create `packages/shared/src/canonicalize.ts` exporting `CANONICAL_UNSAFE_KEYS`.
- `tiptap-text.ts` and `content-hash.ts` import from shared instead of declaring their own.
- Keep both canonicalization functions in place — only the constant is shared.

### Out of Scope

- Extracting a unified canonicalize function (different return types; future work).
- Changing the unsafe-key set itself.
- Production-code changes to the depth guard or the depth-guarded walkers are out of scope for this phase. Phase 4b.13 is a test-only phase (it adds a regression test against the existing walkers) and does not own the guard itself.

### Definition of Done

- One declaration of the unsafe-key set in `packages/shared/`.
- Both consumers import it.
- Existing tests in `tiptap-text.test.ts` and `content-hash.test.ts` still green.
- `make all` green at PR close.
- No behavior change visible to the user.

### Dependencies

- None. Independently shippable.

---

## Phase 4b.11: 404 Route-Response Helper

### Goal

Replace the ~20 hand-written `if (!result) { res.status(404).json({ error: { code: "NOT_FOUND", message: "X not found." } }); return; }` blocks across `projects.routes.ts`, `chapters.routes.ts`, `snapshots.routes.ts`, and `search.routes.ts` with a single `notFound(res, resource)` helper in `packages/server/src/app.ts`.

### Why Now

The pattern is the implementation of one rule from CLAUDE.md §API Design (404 envelope shape). It is repeated verbatim at ~20 sites with only the resource-name string changing. Today the contract lives in CLAUDE.md and reviewer memory; the code carries no enforcement. If the API contract evolves (request-id header for tracing, `details` field, structured metadata), every site must be updated in lockstep. (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-13-33-4129d99.md` I1.)

### Scope

- Add `export function notFound(res: Response, resource: string): void` to `packages/server/src/app.ts`. Body: `res.status(404).json({ error: { code: "NOT_FOUND", message: \`${resource} not found.\` } })`.
- Migrate all ~20 sites: `projects.routes.ts:50–53, 84–87, 98–101, 121–124, 150–153, 163–167, 177–181`; `chapters.routes.ts:14–17, 38–41, 77–80, 92–95`; `snapshots.routes.ts:50–53, 74–77, 97–100, 114–117, 131–137`; `search.routes.ts:86–89, 94–97, 131–134, 146–149`.
- Use the existing route integration tests (`*.routes.test.ts`) as the regression net; they already cover every 404 path.

### Out of Scope

- Adding a request-id header, `details` field, or any envelope evolution. Pure mechanical extraction.
- Touching the validation envelope (Phase 4b.12 owns that).
- Server-internal logging changes.

### Definition of Done

- `notFound` helper exists in `app.ts`.
- All ~20 sites migrated; no remaining inline `code: "NOT_FOUND"` literals in route files.
- All `*.routes.test.ts` files still green without modification.
- `make all` green at PR close.
- No wire-level change visible to clients.

### Dependencies

- None. Independently shippable. Pairs naturally with 4b.12 (both touch `app.ts`); CLAUDE.md one-feature rule allows bundling these two as "server error-envelope helpers" if scope stays tight, otherwise they are separate PRs.
- Independent of Phase 4b.4 (Raw-Strings ESLint Rule): the template literal `\`${resource} not found.\`` in the helper body lives in `packages/server/src/app.ts`, which is outside 4b.4's scope (4b.4 explicitly excludes server-side strings — the lint rule applies to `packages/client/src/`). May land before, in parallel, or after 4b.4 with no interaction.

---

## Phase 4b.12: Validation Error Response Helper

### Goal

Centralize the 400 `VALIDATION_ERROR` envelope. Add `validationError(res, msg)` and `respondValidationParse(res, parsed)` helpers in `packages/server/src/app.ts`; migrate the ~6 routes that hand-roll `Schema.safeParse(...)` + 400-emit and the projects/chapters routes that re-wrap a service `{ validationError }` discriminant.

### Why Now

The validation envelope contract is implicit. Six sites parse Zod and emit a near-identical 400. The fallback string differs subtly: direct-`safeParse` sites use `parsed.error.issues[0]?.message ?? "Invalid input"`; service-discriminant sites use the service's message verbatim. A future Zod major bump or a request to include the field name in errors requires touching every site. (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-13-33-4129d99.md` I2.)

### Scope

- `validationError(res, msg)`: wraps `res.status(400).json({ error: { code: "VALIDATION_ERROR", message } })`.
- `respondValidationParse(res, parsed)`: returns `parsed.data` on success, calls `validationError` and returns `undefined` on failure.
- Migrate direct-safeParse sites: `snapshots.routes.ts:38–44`, `:16–22` (UUID parse), `search.routes.ts:70–76`, `:115–121`, `settings.routes.ts:22–28`, `projects.routes.ts:15–18` (createProject).
- Migrate service-discriminant sites to use `validationError(res, result.validationError)` directly: `projects.routes.ts:55–59`, `:126–130`, `chapters.routes.ts:52–56` (the chapters PATCH `validationError` discriminant), and `settings.routes.ts:34–40` (the settings-update service-error path that emits `VALIDATION_ERROR` with `Invalid settings: ${messages}` — currently missed by the source report). All five-line ranges cover the full guard-and-emit block; do not narrow to the 3-line `res.status(400).json({...})` core, since Phase 4b.12 replaces the whole block with a single helper call.
- Before phase entry, run `grep -rn 'code: "VALIDATION_ERROR"' packages/server/src/*/routes/` (and `chapters/`, `projects/`, `settings/`, `search/`, `snapshots/` route files) to itemize every site in scope. The phase migrates the closed list returned by that grep.

### Out of Scope

- Adding field-name awareness or structured Zod error projection. Helper signature stays minimal.
- Changing validation rules or schemas.
- The 404 envelope (Phase 4b.11 owns that).

### Definition of Done

- Two helpers exist in `app.ts`.
- All ~6 direct-safeParse sites and the service-discriminant sites use them.
- After migration, `grep -rn 'code: "VALIDATION_ERROR"' packages/server/src/*/routes/` returns zero matches in route files (the helper definition in `app.ts` is the only remaining literal).
- All `*.routes.test.ts` files still green without modification.
- `make all` green at PR close.

### Dependencies

- None. Pairs with Phase 4b.11; both touch `app.ts`. Independent of all other 4b.X phases.

---

## Phase 4b.13: TipTap Depth-Guard Regression Test

### Goal

Pin the contract that *every* consumer of TipTap JSON honors `MAX_TIPTAP_DEPTH = 64` and bails safely on a depth-65 document. The six current consumers — `validateTipTapDepth` (canonical, in `tiptap-depth.ts`), `extractText` (wordcount), `canonicalize` (content-hash), `walk` (images.references), plus `collectLeafBlocks` and `canonicalJSON` (both in `tiptap-text.ts`) — each implement their own depth-counted recursion; the constant is shared but the recursions are not.

### Why Now

The prior dedup pass (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md` I5) flagged the duplicated traversals but the verifier downgraded "extract a generic walker" because each consumer's per-node work is intertwined with its recursion (e.g. images.references' regex filter is called during the walk). The source report enumerated four consumers; a sweep of `tiptap-text.ts` against HEAD turned up two more (`collectLeafBlocks`, `canonicalJSON`) that share the same depth-cap pattern, so the contract test must cover all six. The verifier's recommendation: keep the traversals separate, but add a contract test that constructs a depth-65 doc and asserts each of the six walkers bails safely. That test does not exist today. This phase adds it. A seventh walker can later trigger an extraction-vs-test re-evaluation.

### Scope

- One new test (location: `packages/shared/src/__tests__/tiptap-depth-walkers.test.ts` is fine, or wherever the existing depth test lives) that:
  - Constructs a TipTap doc nested to depth 65.
  - Calls each of the six consumers and asserts each returns or throws safely (no stack overflow, no unbounded recursion). Verify each consumer's actual bail behavior by reading source before writing assertions; do not lift expectations from this phase text alone. Today's bail behaviors (verified against HEAD): `validateTipTapDepth` returns `false`, `extractText` returns `""` for the over-depth subtree, `canonicalize` throws `CanonicalizeDepthError`, `walk` returns `void`, `collectLeafBlocks` returns `[]`, `canonicalJSON` returns the literal string `"null"`.
- Document in the test file's header that any new TipTap walker must be added to this regression and to the constant import.

### Out of Scope

- Extracting a generic walker (deferred until a fifth consumer appears).
- Changing the existing six consumers' implementations or bail behaviors.
- Lint/automation that enforces the documentation discipline (consider only if a fifth walker arrives without joining the test).

### Definition of Done

- A test that fails if any of the six consumers leaks a stack overflow on a depth-65 doc.
- Test file header documents the "new walker → add here" rule.
- `make all` green at PR close.
- No production-code change.

### Dependencies

- None. Test-only phase. May land in any order relative to 4b.10 (both touch the canonicalize area but they don't conflict).

---

## Phase 4b.15: Inline Title-Editing Hook

### Goal

Extract a generic `useInlineTitleEditing(currentId, save, gates, options?)` capturing the inline edit/cancel/commit state machine (enter edit mode, escape-cancel sentinel, `isSavingRef` re-entry guard, `prevIdRef` stale-draft discard, trim-and-compare, keep modal open on error). Reduce `useChapterTitleEditing.ts` and `useProjectTitleEditing.ts` to thin wrappers that pass an optional `driftCheck` predicate (the project's slug-change race) and an optional `onAfterSave` callback (project's `navigate(newSlug)`).

### Why Now

The two hooks are ~85% line-by-line identical (105 + 119 lines, same refs, same lifecycle, same gates). Bug fixes (a future Escape race or busy-gate tightening) require synchronized edits in two files; tests on one path don't cover the other. The slug-drift check and post-save navigate are load-bearing in the project hook and *intentionally absent* from the chapter hook (chapters have no slug). Extraction must preserve those differences as opt-in callbacks. (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md` I1, cross-confirmed by two specialists in that pass.)

### Scope

- Add characterization tests covering both existing hooks first — they exist (`useChapterTitleEditing.test.ts`, `useProjectTitleEditing.test.ts`), verify they pin the differences (slug drift, post-save navigate). Add test cases if any are missing.
- Add `useInlineTitleEditing(currentId, save, gates, options?)` in `packages/client/src/hooks/` with its own unit tests. The `options` argument exposes `driftCheck?: () => boolean` and `onAfterSave?: (result) => void`.
- Rewrite `useChapterTitleEditing` and `useProjectTitleEditing` as 10–20 line wrappers. Project wrapper passes `driftCheck = () => project.slug !== slug` and `onAfterSave = (result) => navigate(result.newSlug)`.
- Verify all callers and existing tests pass without modification.

### Out of Scope

- Extending the hook to non-title inline editing.
- Changing keyboard semantics, cancel-on-escape, or trim-before-compare behavior.
- Migrating any other dialog/modal hook.

### Definition of Done

- One canonical `useInlineTitleEditing` hook with unit tests.
- Two thin wrappers around it; the slug-drift check and post-save navigate remain load-bearing in the project wrapper.
- All existing title-editing tests green without modification.
- `make all` green at PR close.
- No behavior change visible to the user.

### Dependencies

- Independent of other 4b.X phases. Should land before any new title-style inline editing surface (none currently planned).

---

## Phase 4b.16: Dialog Lifecycle Hook

### Goal

Extract `useDialogLifecycle(dialogRef, { open, onClose, initialFocusRef, blockEscapePropagation, safeShowClose, role })` capturing the show-on-mount, focus-an-actionable-element, Escape-closes (sometimes with `stopImmediatePropagation`), backdrop-click-closes pattern that is reimplemented across `ConfirmDialog`, `ExportDialog`, `NewProjectDialog`, `ProjectSettingsDialog`, and `ShortcutHelpDialog`. Migrate the dialogs one at a time behind characterization tests; preserve `stopImmediatePropagation` and the happy-dom `showModal/close` try/catch as opt-ins.

### Why Now

The five dialogs reimplement the same three affordances with arbitrary inclusions/exclusions: some attach manual Escape listeners, others rely on browser default; `ConfirmDialog` calls `stopImmediatePropagation` on Escape to keep the find-replace panel's listener from also handling it; `ProjectSettingsDialog` is a slide-out, not a centered modal, with happy-dom-safe `showModal/close`; `ExportDialog` carries the same happy-dom try/catch guard at `ExportDialog.tsx:66–69`; the remaining dialogs (`NewProjectDialog`, `ShortcutHelpDialog`) call `showModal()` directly and rely on jsdom/happy-dom passing. New dialogs are likely to copy whichever neighbour they were spawned from rather than a single policy — accessibility variance, test-environment fragility, and silent drift in keyboard semantics follow. (`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md` I2.)

### Scope

- Add `useDialogLifecycle` in `packages/client/src/hooks/` with unit tests. The options expose `blockEscapePropagation: boolean` (default false; `ConfirmDialog` opts in), `safeShowClose: boolean` (default false; `ExportDialog` and `ProjectSettingsDialog` opt in to wrap `dialog.showModal()` / `dialog.close()` in try/catch for happy-dom compatibility — alternatively, make this an always-on guard if no caller needs the throw to surface), and a `role` for ARIA classification.
- Migrate in this order to control risk: `ExportDialog` and `ConfirmDialog` first (vanilla + opt-in propagation block + happy-dom safety), then `NewProjectDialog` and `ShortcutHelpDialog` (vanilla), then `ProjectSettingsDialog` last. The slide-out positioning and happy-dom guard in `ProjectSettingsDialog` may not factor cleanly — if it doesn't, leave it on a hand-rolled implementation and document why in a code comment. Do not force migration when extraction would break the slide-out semantics.
- Verify a11y at each step: focus management, Escape behavior, backdrop click, ARIA role. The existing component tests cover each dialog; treat them as the regression net.

### Out of Scope

- Replacing the native `<dialog>` element with a custom modal primitive.
- Changing visual design, animation, or `prefers-reduced-motion` handling.
- Bundling Phase 4b.15 (title hooks) into the same PR. Each dialog migration is its own commit; per CLAUDE.md one-feature rule the whole hook extraction is one PR (`useDialogLifecycle` + 4 to 5 migrations bundled is fine; force-fitting `ProjectSettingsDialog` is not).

### Definition of Done

- One canonical `useDialogLifecycle` hook with unit tests.
- All four of `ConfirmDialog`, `ExportDialog`, `NewProjectDialog`, and `ShortcutHelpDialog` migrated; `ProjectSettingsDialog` migrated *or* explicitly documented as opt-out with the specific reason (slide-out positioning that does not factor through the hook's contract).
- All existing dialog component tests green without modification (focus, Escape, backdrop).
- aXe-core e2e checks green.
- `make all` green at PR close.
- No behavior change visible to the user.

### Dependencies

- Independent of other 4b.X phases. Should land after 4b.4 (Raw-Strings ESLint Rule) only if dialog-internal strings are surfaced during the migration; otherwise independent.

---

### Phase 4b.X dedup suggestions deferred (not roadmap'd)

The two dedup reports under `paad/duplicate-code-reports/` flagged four Suggestion-tier findings; three are **deliberately not** captured as 4b.X phases and are recorded here so the evidence trail is not lost:

- **Report 1 S2** — `author_name` column is unbounded `text` in migration `011_add_author_name.js` while the schema caps at 500. Standard "API cap with permissive DB" pattern; pick up only if a hardening pass is undertaken across all string-typed columns.
- **Report 1 S3** — Chapter status is seeded by migration 003 (with `sort_order` and `label`) and *also* declared as a Zod enum (values only). DB is the source of truth for UI labels (via `/api/chapter-statuses`); enum exists for input validation. Document the sync requirement in `CLAUDE.md` rather than refactoring; pick up in a CLAUDE.md doc-pass.
- **Report 2 S1** — `possiblyCommitted` refresh recipe is duplicated at three image-upload sites (`ImageGallery.handleFileSelect`, `ImageGallery.handleSave`, `Editor.tsx` paste/drop). Three sites with two in the same file is below the consolidation threshold; pick up only if a fourth image-upload entry point appears (e.g. drag-drop on detail view, bulk import).
- **Report 1 S1** — *(partially addressed)*: `ProjectSettingsDialog`/`ExportDialog` hand-rolled `AbortController` is intentionally distinct from `useAbortableSequence` (different problems) and is now explicitly deferred under Phase 4b.14's "Out of Scope" along with the other ~8 production AbortController sites.

If a hardening pass (S2), a CLAUDE.md doc-pass (S3), or a fourth image-upload entry point (Report 2 S1) appears, surface the corresponding suggestion as a candidate phase.

---

## Phase 4c: Notes, Tags & Outtakes

### Goal

Give the writer a private annotation layer on top of their manuscript — notes to self, content tagging for cross-referencing, and a safe place for text that's been cut but might be needed later.

### Features

#### 4c.1 Inline Notes

Notes attached to specific text ranges in the manuscript. Visible while editing, invisible in preview and export.

**Behavior:**
- Select text, click "Add Note" (or keyboard shortcut), type a note in a popover.
- The noted text is visually marked (e.g., a subtle highlight or underline in a distinct color — configurable).
- Hovering or clicking the marked text shows the note.
- Notes can be edited and deleted.
- A "Notes Panel" tab in the reference panel (Phase 4a) lists all notes in the current chapter, in document order, showing the noted text and the note content. Clicking a note scrolls to it.
- Notes do not appear in preview mode or any export format.

**Implementation:** TipTap custom mark. The note text is stored as a mark attribute on the relevant text range in the TipTap JSON. No separate database table needed — the notes live inside the document structure.

#### 4c.2 Scratchpad / Outtakes Folder

A per-project space for text that's been cut from the manuscript but might be useful later. Writers call these "killed darlings."

- Outtakes are free-form text entries with an optional label (e.g., "Cut from Chapter 7 — the marketplace scene").
- Outtakes are searchable.
- A writer can move text from the editor to outtakes (cut selection -> paste to outtakes) and vice versa.
- Outtakes are not included in the manuscript word count, preview, or export.

#### 4c.3 Tags and Cross-References

Paragraph-level or section-level tags that allow the writer to find all content related to a concept across the entire manuscript.

- A writer can tag any paragraph (or selection) with one or more tags.
- Tags are freeform text (not from a predefined list), with autocomplete from previously used tags.
- A "Tags" tab in the reference panel (Phase 4a) shows all tags used in the project, with counts. Clicking a tag shows all tagged passages across all chapters, with links to navigate to each one.
- Use cases: "everywhere I mention Athens," "every scene where the theme of betrayal appears," "all passages citing Smith (2019)."

**Implementation:** TipTap custom mark with a `tags` attribute (array of strings). Tags are extracted from the JSON tree and indexed for fast lookup.

### Data Model Changes

**New table: Outtake**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `label` — text, nullable
- `content` — text (TipTap JSON, same format as chapters)
- `word_count` — integer
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable (soft delete)

No separate tables for notes or tags — these are stored within the TipTap JSON as custom marks.

### API Changes

- `GET /api/projects/{id}/notes` — extract and return all notes from all chapters (aggregation across JSON documents).
- `POST /api/projects/{id}/outtakes` — create an outtake.
- `GET /api/projects/{id}/outtakes` — list outtakes.
- `PATCH /api/outtakes/{id}` — update outtake.
- `DELETE /api/outtakes/{id}` — soft-delete outtake.
- `GET /api/projects/{id}/tags` — return all unique tags with occurrence counts and locations.

### UI/UX Notes

- Inline notes should feel like margin scribbles, not formal annotations. The visual treatment should be subtle — a soft highlight or a small icon in the gutter, not a heavy underline that disrupts reading flow.
- The scratchpad should be easily accessible (reference panel tab) but out of the way. It's a drawer, not a second editor.
- Tags should auto-suggest as you type, drawing from existing tags. This encourages consistency (using "Athens" everywhere rather than "Athens" and "athens" and "Greece - Athens").

### Dependencies

- MVP (TipTap editor with custom extension support).
- Phase 4a (reference panel infrastructure to host the Notes, Tags, and Outtakes tabs).
- Extending TipTap with custom marks (notes, tags) is the core technical challenge. ProseMirror makes this well-supported but it requires understanding the ProseMirror schema and decoration system.

---

## Phase 5a: Fiction — Characters

### Goal

Give novelists structured character records — the reference tool writers reach for most often while drafting.

### Features

#### 5a.1 Character Sheets

Structured records for each character in the story.

**Structured fields:**
- Name (required)
- Aliases / nicknames
- Age / date of birth
- Physical description
- Personality traits
- Background / backstory
- Character arc (brief: where they start, where they end)
- Relationships (text-based in this phase; linked relationships come in Phase 5d)
- Status (alive, deceased, unknown)
- First appearance (link to chapter)

**Freeform notes area:** Unstructured text (TipTap editor, supporting images via Phase 4a's image handling) for anything that doesn't fit the fields — character voice notes, inspiration references, open questions about the character.

Design principle: structured fields are for quick reference lookups; freeform notes are for creative thinking. Both are needed.

Characters are displayed in the reference panel (Phase 4a infrastructure). The writer can have a character sheet visible while writing the corresponding chapter.

### Data Model Changes

**New table: Character**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `name` — text, required
- `aliases` — text, nullable
- `age` — text, nullable
- `physical_description` — text, nullable
- `personality` — text, nullable
- `backstory` — text (TipTap JSON), nullable
- `character_arc` — text, nullable
- `relationships_text` — text, nullable (freeform; structured relationships in Phase 5d)
- `status` — enum: "alive" | "deceased" | "unknown", default "alive"
- `first_appearance_chapter_id` — foreign key -> Chapter, nullable
- `notes` — text (TipTap JSON), nullable
- `sort_order` — integer
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

### UI/UX Notes

- Character sheets live in the reference panel (built in Phase 4a). A new "Characters" tab is added.
- Character sheets should have a search/filter function. A novel with 30+ characters needs quick lookup.

### Dependencies

- Phase 4a (reference panel infrastructure, image handling for character photos).

---

## Phase 5b: Fiction — Scene Cards

### Goal

Give novelists scene-level story structure — a layer of organization that sits above (or alongside) chapters, enabling outlining and structural experimentation without moving prose.

### Features

#### 5b.1 Scene Cards / Outline Mode

Each scene card captures:

- **Title:** Short description ("Maria discovers the betrayal")
- **POV character:** Link to character sheet
- **Setting/location:** Freeform text (linked to world-building entries in Phase 5c)
- **Characters present:** Links to character sheets (the "who's in the room" data)
- **Purpose:** Why this scene exists in the story (advances plot, reveals character, builds world, creates tension)
- **Mood/tone:** Freeform tag (e.g., "tense," "comedic relief," "melancholy")
- **Status:** Draft, written, revised (tied to chapter status if linked to a chapter)
- **Chapter link:** Optional link to the chapter where this scene lives in prose

Scene cards can be:
- Viewed as a card grid (spatial overview of the story)
- Reordered by drag-and-drop (to experiment with story structure without moving actual prose)
- Filtered by POV character, location, mood, or status
- Used as an outlining tool before chapters exist (write the scene card, then create the chapter from it)

### Data Model Changes

**New table: SceneCard**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `title` — text, required
- `pov_character_id` — foreign key -> Character, nullable
- `setting` — text, nullable
- `purpose` — text, nullable
- `mood` — text, nullable
- `status` — enum: "draft" | "written" | "revised"
- `chapter_id` — foreign key -> Chapter, nullable
- `sort_order` — integer
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

**New table: SceneCharacter** (many-to-many)
- `scene_card_id` — foreign key -> SceneCard
- `character_id` — foreign key -> Character

### UI/UX Notes

- Scene cards live in the reference panel (built in Phase 4a). A new "Scenes" tab is added.
- Scene cards should feel like index cards. Consider a visual design that echoes physical index cards (slightly off-white background, subtle shadow, compact typography).

### Dependencies

- Phase 4a (reference panel infrastructure).
- Phase 5a (character sheets — scene cards reference characters for POV and "characters present").

---

## Phase 5c: Fiction — World-Building

### Goal

Give novelists the tools to build and reference a consistent, detailed story world. Essential for speculative fiction, historical fiction, and any story with a complex setting.

### Features

#### 5c.1 World-Building Bible

A hierarchical knowledge base for the story's setting.

**Structure:** World -> Region -> City/Area -> Notable Location, but the hierarchy is flexible — the writer defines the levels. Each entry has:

- **Name**
- **Description** (rich text, TipTap editor, supporting images)
- **Parent entry** (for hierarchy)
- **Category:** Location, system (magic, political, technological), history, culture/society, other
- **Tags** (for cross-referencing, using the Phase 4c tag system)
- **Related characters** (links to character sheets from Phase 5a)
- **Related chapters** (which chapters feature this entry)
- **Image** (optional — a reference image, map, etc., via Phase 4a image handling)

The world-building bible is displayed in the reference panel with collapsible hierarchy navigation.

#### 5c.2 "Who's in the Room?" Tracker

A per-scene annotation (linked to scene cards from Phase 5b) tracking which characters are present. This prevents the common continuity error where a character speaks dialogue but was never established as being in the scene, or where a character is present but never acknowledged.

This is stored as part of the scene card's "characters present" field (SceneCharacter table from Phase 5b), but surfaced as a quick-reference widget in the reference panel when the writer is editing the corresponding chapter. The widget shows the characters present in the linked scene and allows quick edits.

### Data Model Changes

**New table: WorldEntry**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `name` — text, required
- `description` — text (TipTap JSON), nullable
- `parent_id` — self-referential foreign key, nullable (for hierarchy)
- `category` — enum: "location" | "system" | "history" | "culture" | "other"
- `tags` — text (JSON array of strings)
- `image_url` — text, nullable
- `sort_order` — integer
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

**New cross-reference tables:**
- `CharacterWorldEntry` — many-to-many: Character <-> WorldEntry
- `ChapterWorldEntry` — many-to-many: Chapter <-> WorldEntry

### UI/UX Notes

- The world-building bible should support collapsible sections and hierarchy navigation. For a complex fantasy world, this could be dozens or hundreds of entries.
- The "who's in the room" widget should be small and unobtrusive — a compact list of character names with a link to each character sheet, displayed in the reference panel when a scene-linked chapter is active.

### Dependencies

- Phase 5a (character sheets, which this phase cross-references).
- Phase 5b (scene cards, for the "who's in the room" tracker).

---

## Phase 5d: Fiction — Visualizations

### Goal

Provide specialized visual tools for understanding story structure: how characters relate to each other, and how story time maps to narrative time.

### Features

#### 5d.1 Relationship Map

A visual graph showing connections between characters.

- Nodes are characters (from character sheets).
- Edges are relationships, labeled with the relationship type (e.g., "married to," "rival of," "mentor," "sibling").
- Relationships are directional when appropriate ("reports to" vs. "manages").
- The graph is interactive: drag to rearrange, click a node to view the character sheet in the reference panel.
- Relationships are defined as structured data and automatically reflected in the graph — the map is a *view*, not a separate data source.

#### 5d.2 Timeline View

Two parallel timelines:

- **Story chronology:** Events as they happen in the story world (what actually occurred in what order).
- **Narrative order:** Events as the reader encounters them (the order chapters present information).

This is critical for stories with flashbacks, multiple timelines, or nonlinear narration. A timeline entry includes:

- Event description
- Date/time in the story world (can be relative: "3 days before the fall of the city")
- Characters involved (links to character sheets)
- Chapter where this event is narrated (if written yet)

The writer can view both timelines side by side to spot structural issues: "The reader learns about the betrayal in Chapter 3, but the betrayal actually happens chronologically after events in Chapter 7."

### Data Model Changes

**New table: Relationship** (replaces the freeform `relationships_text` in Character)
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `character_a_id` — foreign key -> Character
- `character_b_id` — foreign key -> Character
- `relationship_type` — text (e.g., "married to," "rival of")
- `is_directional` — boolean, default false
- `created_at` — timestamp
- `updated_at` — timestamp

**New table: TimelineEvent**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `description` — text, required
- `story_date` — text, nullable (text to support relative dates like "3 days before the fall")
- `story_sort_order` — integer (for ordering on the chronological timeline)
- `narrative_sort_order` — integer (for ordering on the narrative timeline; defaults to the linked chapter's sort_order)
- `chapter_id` — foreign key -> Chapter, nullable
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

**New cross-reference table:**
- `TimelineEventCharacter` — many-to-many: TimelineEvent <-> Character

### UI/UX Notes

- The relationship map should be a simple force-directed graph. Don't over-invest in graph visualization — this is a reference tool, not a social network analysis platform. Libraries like `react-force-graph` or a simple D3 force layout are sufficient.
- The relationship map must be keyboard-navigable and have screen reader equivalents (a list of all relationships, grouped by character, as an accessible alternative to the visual graph).
- The timeline view should focus on clarity over visual richness. A vertical timeline with events as cards, color-coded by chapter, is sufficient. The dual-timeline comparison (story vs. narrative) is the key insight — the visualization should make discrepancies between the two orderings immediately obvious.

### Dependencies

- Phase 5a (character sheets — the relationship map and timeline both reference characters).
- Phase 5b is NOT required — the visualizations work with characters and chapters alone.

---

## Phase 6a: Non-Fiction — Research & Citations

### Goal

Give the non-fiction writer (specifically: the kind writing *Bread, Circuses, and GPUs* — research-heavy, argument-driven, historically grounded) the tools to manage sources, track claims, and link them to the prose.

### Features

#### 6a.1 Research Library

A per-project collection of sources. Each source entry includes:

- **Title** (required)
- **Author(s)**
- **Type:** Book, article, paper, website, podcast, video, interview, primary source, data set, other
- **Publication date**
- **URL** (if applicable)
- **Tags** (freeform, with autocomplete from existing tags — reusing Phase 4c tag infrastructure)
- **Notes** (rich text TipTap editor, supporting images — writer's summary, key quotes, reactions, page references)
- **Status:** Unread, reading, read, to-revisit

The library is searchable and filterable by tag, type, status, and full text. When writing, the writer can search the library from the research side panel (§6a.4) and drag a reference into their text (creating a citation link — see §6a.2).

#### 6a.2 Citation Management

A lightweight citation system — not full academic citation management (that's Zotero's job), but enough to track the connection between claims in the prose and their supporting sources.

**Behavior:**
- A writer can link any text selection to one or more sources from the research library.
- The link is stored as a TipTap custom mark (similar to inline notes in Phase 4c), with the source ID(s) as attributes.
- In the editor, cited text has a subtle visual indicator (e.g., a superscript number or a colored underline).
- Hovering shows the source title and a link to the full source entry.
- A "Citations" panel in the reference panel lists all citations in the current chapter, in document order.

**On export (Phase 3 pipeline integration):**
- The writer chooses a citation style: footnotes, endnotes, inline references, or hidden (strip all citations).
- For footnotes/endnotes, Smudge generates them automatically from the source data: Author, Title, Year (a simplified format — not trying to replicate Chicago/MLA/APA perfectly, but sufficient for a draft manuscript).
- A bibliography/references section is generated at the end of the export.
- This is implemented as new filter and structure steps in the Phase 3a export pipeline (§3a.5).

#### 6a.3 Fact-Check Status Flags

A per-claim annotation system. Any text selection can be marked with a verification status:

- **Verified** — the writer has confirmed this claim against a source.
- **Needs verification** — the writer believes it's true but hasn't checked.
- **Disputed** — the writer is aware of counter-evidence or conflicting sources.
- **Placeholder** — the writer knows this is wrong/incomplete and intends to fix it.

**Implementation:** TipTap custom mark with a `factcheck_status` attribute.

**Dashboard integration:** The project dashboard (Phase 1) shows a fact-check summary: "42 claims verified, 12 need verification, 3 disputed, 5 placeholder." The writer can click each category to see all passages with that status.

**Visual distinction from inline notes:** Fact-check flags use a cooler color indicator with an icon (checkmark, question mark, exclamation mark, construction sign), distinct from the warm highlight used for inline notes (Phase 4c).

#### 6a.4 Research Side Panel

The reference panel (built in Phase 4a) gets new tabs for research:

- **Source search:** Search the research library from within the editor.
- **Relevant sources:** Automatically suggested sources based on the tags of the current chapter (if the chapter is tagged "enclosure movement," sources tagged "enclosure movement" are surfaced).
- **Recent sources:** The last 5-10 sources the writer viewed or cited.
- **Quick-add:** Add a new source to the library without leaving the editor.

### Data Model Changes

**New table: Source**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `title` — text, required
- `authors` — text, nullable
- `source_type` — enum: "book" | "article" | "paper" | "website" | "podcast" | "video" | "interview" | "primary_source" | "dataset" | "other"
- `publication_date` — text, nullable (text rather than date to handle approximate dates like "ca. 1750")
- `url` — text, nullable
- `tags` — text (JSON array of strings)
- `notes` — text (TipTap JSON)
- `status` — enum: "unread" | "reading" | "read" | "to_revisit"
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

Citations and fact-check flags live in the TipTap JSON as custom marks (no separate tables).

### UI/UX Notes

- The research library should feel like a personal card catalog, not an academic database. Keep the entry form simple — most writers will only fill in title, author, tags, and notes. The other fields are optional.
- Citation style in export doesn't need to be publication-ready. This is a *working manuscript*, not a final typeset book. A consistent format (Author, Title, Year) is sufficient. If a publisher or editor wants Chicago style, that's a post-export concern.

### Dependencies

- Phase 1 (dashboard for fact-check summary).
- Phase 3a (export pipeline, for generating footnotes/endnotes/bibliography).
- Phase 4a (reference panel infrastructure, image handling).
- Phase 4c (TipTap custom marks infrastructure, tags system).
- Phase 5 is NOT required — non-fiction mode is fully independent of fiction mode.

---

## Phase 6b: Non-Fiction — Argument Structure

### Goal

Make the logical structure of a non-fiction argument visible and navigable, separately from the prose.

### Features

#### 6b.1 Argument Structure Visualization

Non-fiction, especially the kind Ovid writes, has a logical structure: thesis -> supporting arguments -> evidence -> counterarguments -> rebuttals. This feature makes that structure visible separately from the prose.

**Approach:** A tree/outline view where:

- The top-level node is the book's central thesis.
- Child nodes are the main supporting arguments (roughly corresponding to chapters or chapter groups).
- Under each argument: evidence nodes (linked to specific passages and sources) and counterargument nodes (with rebuttals).

This is a *separate view* in the reference panel, not embedded in the prose. It's a tool for the writer to ask: "Is my argument logically complete? Did I claim X but never provide evidence for it? Did I address the strongest counterargument?"

Each node in the argument tree can link to:
- A chapter or passage (where the argument is made in prose)
- A source (evidence, from the Phase 6a research library)
- Another node (logical dependency)

Nodes can be reordered via drag-and-drop to experiment with argument structure.

### Data Model Changes

**New table: ArgumentNode**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `parent_id` — self-referential foreign key (nullable for root thesis)
- `node_type` — enum: "thesis" | "argument" | "evidence" | "counterargument" | "rebuttal"
- `title` — text
- `description` — text, nullable
- `sort_order` — integer
- `linked_chapter_id` — foreign key -> Chapter, nullable
- `linked_source_id` — foreign key -> Source, nullable
- `created_at` — timestamp
- `updated_at` — timestamp

### UI/UX Notes

- The argument visualization should be a simple indented tree or outline — not a mind map or complex graph. Writers think in outlines. If the tree gets large, collapsible sections are essential.
- The tree is displayed as a tab in the reference panel. The writer can view it alongside the editor to check that their prose matches their argument structure.
- Keyboard-navigable: arrow keys to move between nodes, Enter to expand/collapse, Tab to navigate to linked chapters.
- This feature deserves design iteration. The right UX for "map your argument" is a design challenge — expect to prototype and refine.

### Dependencies

- Phase 6a (research library — evidence nodes link to sources).
- Phase 4a (reference panel infrastructure).

---

## Phase 7a: Writing Environment

### Goal

Make the writing space itself more comfortable and focused. Dark mode reduces eye strain for evening writers; distraction-free mode eliminates all UI chrome for deep focus.

### Features

#### 7a.1 Dark Mode

A full dark theme. Not just inverting colors — a carefully designed dark palette that maintains the warm, writerly tone:

- Dark warm gray background (not pure black — more like #1A1A1E).
- Warm off-white text (not pure white — more like #E8E4DF).
- Accent color adjusted for dark backgrounds.
- All WCAG AA contrast requirements still met.
- Respects `prefers-color-scheme: dark` system preference, with a manual toggle.
- Stored as a user preference (persisted in the app settings table from Phase 2).

**Prerequisite:** The MVP must use CSS custom properties / Tailwind theme tokens for all colors, backgrounds, and borders. If this groundwork is in place, dark mode is a theme swap.

#### 7a.2 Distraction-Free Mode

A full-screen writing mode that strips all UI chrome: no sidebar, no toolbar, no status bar, no reference panel. Just the writer's text, centered, with generous margins. The cursor and the text are the only visible elements.

- Activated via a dedicated shortcut or button.
- Mouse movement or a specific key (Escape) reveals the UI temporarily.
- The formatting toolbar can appear on text selection (contextual, not persistent).
- Word count is hidden (or shown as a faint, unobtrusive element at the very bottom of the screen).
- Auto-save continues to function silently in the background.

### Data Model Changes

**Extend app settings:**
- Theme preference (light/dark/system)

### Dependencies

- MVP only. Dark mode requires CSS custom properties groundwork.

---

## Phase 7b: Self-Editing Tools

### Goal

Help the writer revise their own prose. Style linting makes patterns visible; text-to-speech makes awkward phrasing audible. Both are self-editing aids, not prescriptive rules.

### Features

#### 7b.1 Style Linting

A non-prescriptive writing quality tool. It does not enforce rules — it makes patterns visible so the writer can decide what to change.

**Detections:**
- **Adverb density:** Highlights sentences with high adverb density, with a per-chapter ratio.
- **Passive voice:** Identifies passive constructions.
- **Repeated sentence openings:** Flags sequences of 3+ sentences starting with the same word (especially "I" or "The").
- **Crutch words:** Writer-configurable list of words they overuse (e.g., "just," "very," "really," "actually"). Smudge highlights occurrences and shows counts.
- **Sentence length variation:** Highlights passages where sentence lengths are very uniform (suggesting monotonous rhythm).
- **Repeated words in proximity:** Flags the same uncommon word used twice within N words (e.g., "The labyrinthine corridors felt labyrinthine" — catches unintentional repetition).

**Presentation:** A "Style" panel shows statistics and allows the writer to jump to highlighted passages. Highlighting is optional (togglable) and non-intrusive — a faint underline or gutter marker, never a red squiggly that makes the writer feel attacked.

**Implementation:** All analysis runs client-side on the TipTap JSON text nodes. No server-side processing needed. Consider using or adapting `write-good` or `retext` ecosystem.

#### 7b.2 Text-to-Speech (Read Aloud)

The browser's native SpeechSynthesis API reads the current chapter (or a selected passage) aloud. Hearing prose read back is one of the most effective self-editing techniques — awkward phrasing that the eye skips over becomes immediately obvious when heard.

- Play, pause, stop controls.
- Adjustable speed and voice (from system-available voices).
- Current word highlighted in the editor as it's spoken.
- Reading respects chapter structure (reads the title, then the content).

**Caveat:** Browser TTS quality varies significantly. This is a "good enough" tool, not a professional narration feature. Note the limitation in the UI.

### Data Model Changes

**Extend app settings:**
- Crutch words list

### Dependencies

- MVP only (operates on TipTap JSON; browser API for TTS).

---

## Phase 7c: Writing Journal

### Goal

Give the writer a space for writing *about* their writing, separate from the manuscript. A place for daily reflections, process notes, and creative thinking.

### Features

#### 7c.1 Writing Journal / Log

A per-project, date-keyed journal. Entries might include:

- "Struggled with Chapter 6 today — the transition from the Rome argument to the modern parallel feels forced."
- "Realized the character of Alexei needs a clearer motivation in Act 2."
- "Hit 50,000 words! The first half is drafted."

The journal is a simple dated-entry system using the same TipTap editor. It's searchable and browsable by date. It does not appear in exports or word counts.

### Data Model Changes

**New table: JournalEntry**
- `id` — UUID, primary key
- `project_id` — foreign key -> Project
- `date` — date
- `content` — text (TipTap JSON)
- `created_at` — timestamp
- `updated_at` — timestamp

### Dependencies

- MVP only (reuses TipTap editor).

---

## Phase 7d: Split View

### Goal

Allow the writer to view two pieces of content side by side within the editor.

### Features

#### 7d.1 Split View

Side-by-side panels within the editor. Possible configurations:

- Two chapters (write Chapter 7 while referencing Chapter 3).
- Chapter + character sheet (fiction mode).
- Chapter + research source (non-fiction mode).
- Chapter + preview of the same chapter.

The split is created via a menu or shortcut. Each panel independently scrolls and can be any content type (chapter, reference, preview).

Note: the reference panel (Phase 4a) already provides a side panel for reference material. Split view extends this by allowing *two full editor panes* or *two arbitrary content types*, not just "editor + reference."

### Dependencies

- Phase 4a (reference panel infrastructure).

---

## Phase 7e: Import

### Goal

Let writers bring existing manuscripts into Smudge from external formats.

### Features

#### 7e.1 Import Formats

Import existing manuscripts into Smudge:

- **Markdown:** Split on H1/H2 headings into chapters. Map formatting to TipTap nodes.
- **Word (.docx):** Map Word styles to TipTap nodes. Split on Heading 1 into chapters.
- **Plain text:** Split on blank-line-separated sections or manual markers.

These cover the most common "I have an existing manuscript" scenarios. Import is critical for Electron distribution (new users need to bring their existing work).

### Dependencies

- Phase 3a (format conversion knowledge from the export pipeline).

---

## Phase 7f: i18n

### Goal

Make Smudge's UI accessible to non-English speakers.

### Features

#### 7f.1 UI Translation

Replace the string constants file (MVP's `strings.ts`) with a proper i18n system (react-i18next). Provide initial translations for high-value languages (French, Spanish, German — based on user demand). Community translation contributions welcome via a simple JSON file format.

This also includes setting the `lang` attribute correctly on content regions based on the project's or chapter's language setting.

### Data Model Changes

**Extend app settings:**
- Language preference

### Dependencies

- MVP string externalization.

---

## Phase 8a: Project Package Format

### Goal

Transform the storage model so each project is a self-contained folder on disk, rather than rows in a shared application database. This is the foundation for desktop (Electron) distribution, where writers expect to "open a file" and have it be their project. See `docs/simplification-roadmap.md` for the full architectural rationale.

### Features

#### 8a.1 Project-as-Folder Structure

Each project becomes a `.smudge/` folder:

```
My Novel.smudge/
  manifest.json
  project.sqlite
  assets/
  snapshots/
  exports/
```

- `project.sqlite` stores manuscript structure, chapters, and metadata.
- `assets/` stores managed research files and images.
- `snapshots/` stores recovery checkpoints and explicit version points.
- `exports/` stores generated export files.
- `manifest.json` stores schema version, app version, and package metadata.

#### 8a.2 Project Migration

Migrate existing projects from the shared application database to individual project folders. This must be:

- Non-destructive (keep the original data until migration is verified)
- Incremental (migrate one project at a time)
- Reversible (can fall back to shared DB if issues arise)

#### 8a.3 "Open Recent" Support

With projects as folders, implement an "Open Recent" mechanism that tracks recently opened project paths. This is the natural behavior for a desktop app.

### Data Model Changes

**Per-project SQLite database** containing:
- All project-specific tables (chapters, characters, scenes, world entries, sources, etc.)

**Application-level database** (separate, for app settings):
- `recent_projects` — path, last_opened_at
- `settings` — app-level preferences

### Dependencies

- Phase 2.5b (storage abstractions must exist to swap the backing store).
- All feature phases that the writer uses should be stable, since migration affects the database structure.

---

## Phase 8b: Bundle Export (.smg)

### Goal

Provide a portable single-file format for sharing, backup, and future OS-level "double-click to open" integration.

### Features

#### 8b.1 .smg Export

Export a project as a `.smg` file — a zip archive of the `.smudge/` project folder. This is the portable format for:

- Backup and archival
- Sharing with others
- Moving between machines
- Email attachment

#### 8b.2 .smg Import

Import a `.smg` file to create a new project. This unpacks the archive into a `.smudge/` folder and registers it with the application.

#### 8b.3 OS Integration (Electron)

Register `.smg` as a file type so double-clicking opens it in Smudge. This is Electron-specific and depends on the desktop distribution being available.

### API Changes

- `POST /api/projects/import` — accept a `.smg` file upload, unpack, and create a project.
- `GET /api/projects/{id}/bundle` — download the project as a `.smg` file.

### Dependencies

- Phase 8a (project package format must exist to bundle it).

---

## Cross-Phase Considerations

### Performance

As the data model grows across phases, query performance should be monitored. Specific concerns:

- **Phase 2:** Daily snapshots grow indefinitely. Consider archiving or aggregating old data (e.g., keep daily granularity for the last 90 days, weekly aggregates beyond that).
- **Phase 4b/4c:** Full-text search across all chapters (find and replace) may require an index. SQLite's FTS5 extension is well-suited and could be added without changing the database engine.
- **Phase 5/6:** Cross-reference queries (all characters in a scene, all sources tagged X) involve multi-table joins. Denormalization or materialized views may be needed if performance degrades.

### Migration Path

Each phase adds tables and columns to the SQLite database. The Knex migration system (established in the MVP) handles this, but each phase's PRD should include the specific migration scripts. Migrations must be idempotent and safe to run against an existing database with live data.

### The Reference Panel (Phase 4a -> all later phases)

The right-side reference panel is built in Phase 4a as shared infrastructure. It is a generic container that hosts different content types via a tab or stack interface. Phases 4b, 4c, 5a, 5b, 5c, 5d, 6a, and 6b all add tabs to this panel. Building it once in Phase 4a prevents duplicating effort and ensures later phases are truly independent.

### Image Handling (Phase 4a -> all later phases)

Image upload and storage is introduced in Phase 4a and used by chapter content, outtakes (4c), character sheet notes (5a), world-building entries (5c), research source notes (6a), and journal entries (7c). The image handling infrastructure is built once and reused everywhere.

### Export Evolution (Phase 3a -> 4c, 5, 6a)

The export pipeline (Phase 3a) is designed as composable steps (§3a.5). As later phases add features that affect export:

- Phase 4c: Strip inline notes from export. Optionally include/exclude tagged content.
- Phase 5: Optionally include character sheets or world-building as appendices.
- Phase 6a: Generate footnotes, endnotes, and bibliography from citation marks and source data.

Each of these inserts new filter or structure steps into the existing pipeline without rebuilding it.

### Accessibility Continuity

Every phase must maintain the WCAG 2.1 AA standard established in the MVP. Each phase's PRD should include an accessibility section that addresses the specific a11y concerns for the new features (e.g., the relationship map in Phase 5d must be keyboard-navigable and have screen reader equivalents; the style linting highlights in Phase 7b must not rely on color alone).

### Testing Continuity

Each phase extends the test suite established in the MVP. At minimum:

- New API endpoints get integration tests.
- New user workflows get e2e tests.
- New shared functions (word count is the precedent) get unit tests.
- New UI components get aXe accessibility scans.

---

## Appendix: Review Decisions

These issues were identified during spec review and resolved. They are recorded here for context.

| # | Issue | Decision |
|---|-------|----------|
| 1 | Phase 2 gross word tracking is inaccurate | Renamed to "added words," acknowledged as approximation, kept simple save-comparison approach |
| 2 | Phase 5 is three phases of work | Split into 5a (characters + scenes), 5b (world-building + who's in room), 5c (relationship map + timeline) |
| 3 | Phase 6 falsely lists Phase 5 as dependency | Reference panel extracted into Phase 4a as shared infrastructure; Phases 5 and 6 are fully independent |
| 4 | Find-and-replace can corrupt entire manuscript with no recovery | Manual snapshots pulled forward into Phase 4b as prerequisite; auto-snapshot before replace-all |
| 5 | Session lifecycle has orphaned state and edge cases | Sessions derived from save timestamps instead of explicit start/end; removed three API endpoints |
| 6 | No image handling anywhere in roadmap | Image upload/storage added as Phase 4a cross-phase infrastructure |
| 7 | Export doesn't address soft-deleted chapters | Soft-deleted chapters silently excluded from export |
| 8 | Argument structure visualization is separate concern from research tools | Split into Phase 6a (research tools) and Phase 6b (argument tree) |
| 9 | Chapter status defaults to "rough_draft" for empty chapters | Default changed to "outline" |
| 10 | Dark mode needs MVP groundwork (CSS custom properties) | Flagged — owner is updating MVP PRD directly |
| 11 | No import capability | Deferred to Phase 7e |
| 12 | Find-and-replace conflicts with open editor state | Force-save before replace, reload affected chapter from server after |
| 13 | Daily snapshots ignore timezone | Timezone setting added to Phase 2, defaults from browser |
| 14 | PRs too large per phase | Phases restructured into smaller sub-phases (v0.5.0): Phase 3 split into 3a/3b, Phase 4 into 4a/4b/4c, Phase 5a into 5a/5b (old 5b->5c, 5c->5d), Phase 7 into 7a-7f, added Phase 2.5 (simplification) and Phase 8 (desktop packaging) |
