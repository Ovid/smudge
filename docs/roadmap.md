# Smudge — Feature Roadmap (Phases 1–7)

**Version:** 0.4.0
**Date:** 2026-03-29
**Author:** Ovid / Claude (collaborative)
**Companion to:** Smudge MVP PRD v0.3.0
**Status:** Post-review

---

## How to Use This Document

Each phase below contains enough detail to serve as input for generating a full PRD. For each phase you'll find: the goal (what the writer gains), detailed feature descriptions, data model changes, API additions, UI/UX considerations, and implementation notes including dependencies on earlier phases.

Phases are ordered by writer impact: Phases 1–3 complete the core writing tool. Phase 4 builds the revision and annotation infrastructure. Phases 5a–5c and 6a–6b differentiate Smudge as a *writer's* tool for fiction and non-fiction respectively. Phase 7 is polish, delight, and depth.

**A note on scope within phases:** Each phase is designed to be a single deliverable increment — something you can build, ship, and use before starting the next. Phases 5 and 6 have been subdivided into sub-phases, each independently shippable.

### Phase Structure

| Phase | Name | Summary |
|-------|------|---------|
| 1 | Writer's Dashboard | Chapter status labels, project overview, chapter navigation shortcuts |
| 2 | Goals & Velocity | Word targets, deadlines, daily tracking, session stats, burndown |
| 3 | Export | HTML, PDF, Word, Markdown, EPUB, plain text |
| 4 | Writer's Annotations & Infrastructure | Snapshots, inline notes, scratchpad, find-and-replace, tags, reference panel, image handling |
| 5a | Fiction: Characters & Scenes | Character sheets, scene cards / outline mode |
| 5b | Fiction: World-Building | World-building bible, "who's in the room" tracker |
| 5c | Fiction: Visualizations | Relationship map, timeline view |
| 6a | Non-Fiction: Research & Citations | Research library, citation management, fact-check flags, research side panel |
| 6b | Non-Fiction: Argument Structure | Argument tree visualization |
| 7 | Polish & Power | Dark mode, distraction-free, split view, style linting, TTS, versioning, writing journal, i18n |

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

Deferred from MVP to avoid auto-save timing edge cases. Now that the save-on-switch behavior (§6.1 and §7.3 of MVP PRD) is solid:

- **Ctrl/Cmd + ↑** — Navigate to the previous chapter in order.
- **Ctrl/Cmd + ↓** — Navigate to the next chapter in order.

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
- **Projected completion date:** If a word count target is set, calculate: remaining words ÷ daily average = days remaining. Display as a date.

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
- `project_id` — foreign key → Project
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

## Phase 3: Export

### Goal

Turn the manuscript into a deliverable. A book isn't finished until it can leave the tool it was written in.

### Features

#### 3.1 Export Formats

| Format | Use Case | Implementation Approach |
|--------|----------|------------------------|
| **HTML** | Web publication, email to readers | TipTap `generateHTML()` on each chapter's JSON. Wrap in a complete HTML document with embedded CSS for reading typography. |
| **Markdown** | Version control, portability, static site generators | Convert TipTap JSON to Markdown. Use a library like `tiptap-markdown` or write a custom serializer from the JSON tree. |
| **PDF** | Print, formal submissions | Generate HTML first, then convert to PDF via Puppeteer (headless Chrome) or a library like `pdf-lib` / `react-pdf`. Puppeteer gives the most accurate rendering but adds a heavy dependency; evaluate trade-offs. |
| **Word (.docx)** | Editors, publishers, agents (the industry standard) | Use `docx` npm package to generate .docx programmatically from the TipTap JSON. Requires mapping TipTap node types to docx paragraph styles. |
| **EPUB** | E-readers, Kindle, self-publishing | Use `epub-gen-memory` or similar. Each chapter becomes an EPUB section. Requires cover image support (optional, or a default). |
| **Plain text** | Maximum portability, backup | Strip all formatting, concatenate chapter text with chapter title headers and separator lines. |

#### 3.2 Export Structure

All exports include:

- **Title page:** Project title, author name (new field needed — see data model).
- **Table of contents:** Generated from chapter titles. For HTML/EPUB, this is navigable. For PDF/Word, it includes page numbers.
- **Chapter structure:** Each chapter starts on a new page (PDF/Word) or a new section (HTML/EPUB), with the chapter title as a heading.
- **Consistent typography:** Export uses the same serif reading font as the preview, or a close equivalent for the format.

#### 3.3 Export Configuration

Before exporting, a simple dialog lets the writer set:

- **Format:** Select from the list above.
- **Author name:** Defaults to a project-level setting, editable per export.
- **Include TOC:** Yes/No (default: Yes for formats that support it).
- **Chapter selection:** Export all chapters, or select a subset. Useful for sending a sample to an agent.
- **Status filter:** Optionally exclude chapters below a certain status (e.g., "export only chapters marked Edited or Final").

**Soft-deleted chapters are always excluded from export.** If a chapter in the `chapter_ids` list has been soft-deleted, it is silently omitted and the export proceeds with the remaining chapters.

#### 3.4 Export as Download

The export generates a file and offers it as a browser download. No email, no cloud storage. The file name defaults to the project title with the appropriate extension.

#### 3.5 Export Pipeline Architecture

The export pipeline should be designed as a series of composable steps so that later phases can inject new behavior without refactoring:

1. **Gather content** — collect chapters (filtered by selection, status, excluding soft-deleted).
2. **Apply filters** — strip inline notes (Phase 4), strip fact-check marks (Phase 6a), apply any content transformations.
3. **Generate structure** — add title page, TOC, chapter headings, footnotes/endnotes (Phase 6a), bibliography (Phase 6a), appendices (Phase 5).
4. **Render to format** — convert the structured content to the target file format.

Steps 2 and 3 are initially no-ops or minimal in Phase 3; later phases add new filter and structure steps without touching the core pipeline.

### Data Model Changes

**Project** — add column:
- `author_name` — text, nullable (used in export title page and metadata)

### API Changes

- `POST /api/projects/{id}/export` — body: `{ format, author_name, include_toc, chapter_ids (optional), min_status (optional) }`. Returns the generated file as a binary download with appropriate Content-Type and Content-Disposition headers.

### UI/UX Notes

- The export dialog should be simple — not a settings page with 30 options. Most writers will just pick a format and click "Export." Advanced options (chapter selection, status filter) should be collapsed/hidden by default.
- After export, a brief confirmation: "Exported 'Bread, Circuses, and GPUs' as PDF (142 pages)." The page/word count in the confirmation gives the writer a sense of their manuscript's physicality.
- Export should feel like a proud moment, not a chore. The confirmation could include the total word count as a subtle celebration.

### Dependencies

- Phase 1 (chapter statuses, for the status filter in export config).
- The TipTap JSON → HTML pipeline from the MVP preview mode is reused here as the foundation for all exports.

### Implementation Notes

- PDF generation is the trickiest format. Puppeteer is the most reliable approach (render HTML in headless Chrome, print to PDF) but it's a ~400MB dependency. For a Docker-based app this is fine (Puppeteer runs in the container). For the eventual Electron app, this is heavy — consider lighter alternatives at that point.
- EPUB has specific metadata requirements (OPF manifest, NCX navigation). Libraries handle most of this, but test with real e-readers (Kindle, Apple Books) to catch rendering issues.
- Word export should map TipTap formatting to Word styles (Heading 1, Heading 2, Normal, Block Quote) so the exported document is properly structured, not just visually formatted.

---

## Phase 4: Writer's Annotations & Infrastructure

### Goal

Give the writer a private layer of commentary on top of their manuscript — notes to self, reminders, open questions, and a safe place for text that's been cut but might be needed later. This is the "revision" toolbox.

This phase also builds shared infrastructure used by later phases: manual snapshots (safety net for destructive operations), the reference panel (used by Phases 5 and 6), and image handling.

### Features

#### 4.1 Manual Snapshots

Manual snapshots of a chapter at a point in time. This feature was originally planned for Phase 7 but is pulled forward because it provides a critical safety net for find-and-replace (§4.5).

- The writer can take a snapshot with an optional label: "v1 — rough draft," "v2 — after structural edit," "before cutting the flashback."
- Snapshots are read-only copies of the chapter's TipTap JSON at that moment.
- A "History" panel for each chapter shows all snapshots, with dates and labels.
- The writer can view a snapshot (read-only) or restore it (replaces current content, with confirmation).
- A diff view between the current content and any snapshot would be ideal but is technically complex (TipTap JSON diffing is not trivial). Defer the diff to a later enhancement; start with view-and-restore.

**Automatic snapshots:** In addition to manual snapshots, Smudge creates automatic snapshots before destructive operations (see §4.5 find-and-replace). These are labeled with the operation that triggered them.

#### 4.2 Inline Notes

Notes attached to specific text ranges in the manuscript. Visible while editing, invisible in preview and export.

**Behavior:**
- Select text, click "Add Note" (or keyboard shortcut), type a note in a popover.
- The noted text is visually marked (e.g., a subtle highlight or underline in a distinct color — configurable).
- Hovering or clicking the marked text shows the note.
- Notes can be edited and deleted.
- A "Notes Panel" sidebar tab lists all notes in the current chapter, in document order, showing the noted text and the note content. Clicking a note scrolls to it.
- Notes do not appear in preview mode or any export format.

**Implementation:** TipTap custom mark. The note text is stored as a mark attribute on the relevant text range in the TipTap JSON. No separate database table needed — the notes live inside the document structure.

#### 4.3 Scratchpad / Outtakes Folder

A per-project space for text that's been cut from the manuscript but might be useful later. Writers call these "killed darlings."

- Outtakes are free-form text entries with an optional label (e.g., "Cut from Chapter 7 — the marketplace scene").
- Outtakes are searchable.
- A writer can move text from the editor to outtakes (cut selection → paste to outtakes) and vice versa.
- Outtakes are not included in the manuscript word count, preview, or export.

#### 4.4 Tags and Cross-References

Paragraph-level or section-level tags that allow the writer to find all content related to a concept across the entire manuscript.

- A writer can tag any paragraph (or selection) with one or more tags.
- Tags are freeform text (not from a predefined list), with autocomplete from previously used tags.
- A "Tags" sidebar panel shows all tags used in the project, with counts. Clicking a tag shows all tagged passages across all chapters, with links to navigate to each one.
- Use cases: "everywhere I mention Athens," "every scene where the theme of betrayal appears," "all passages citing Smith (2019)."

**Implementation:** TipTap custom mark with a `tags` attribute (array of strings). Tags are extracted from the JSON tree and indexed for fast lookup.

#### 4.5 Find and Replace Across Manuscript

Project-wide find and replace — not just the current chapter. Critical for: renaming a character, fixing a recurring typo, changing a place name.

- Search across all chapters (or filter to current chapter only).
- Results are grouped by chapter with surrounding context.
- Replace one, replace all in chapter, replace all in manuscript.
- Match case, whole word options.
- Search counts displayed: "Found 17 occurrences in 8 chapters."

**Safety: automatic snapshots before replace-all.** Before executing a "replace all in manuscript" or "replace all in chapter" operation, Smudge automatically creates a snapshot of every affected chapter, labeled "Before find-and-replace: '[search term]' → '[replacement]'". This gives the writer a recovery path via the snapshot history (§4.1).

**Editor synchronization:** The replace-all workflow is: (1) force-save the current chapter (flush any pending debounced changes), (2) execute the replacement server-side across all chapters, (3) the API returns the list of affected chapter IDs, (4) if the currently-open chapter was affected, reload its content from the server into the editor. This follows the same force-save pattern used for chapter switching in the MVP.

#### 4.6 Reference Panel Infrastructure

A right-side panel alongside the editor, designed as a generic container that can host different content types via a tab or stack interface. In this phase, the panel hosts:

- Notes panel (inline notes for the current chapter)
- Tags panel (all tags across the project)
- Outtakes panel

In later phases, the same panel hosts:
- Character sheets, scene cards (Phase 5a)
- World-building entries (Phase 5b)
- Research library, citations (Phase 6a)
- Argument structure (Phase 6b)

**Design:** The panel is collapsible, resizable, and keyboard-accessible. It can be toggled via a shortcut. Each content type is a tab within the panel. The panel remembers its last state (open/closed, active tab, width) across sessions.

Building this as shared infrastructure now prevents duplicating effort between Phases 5 and 6. Either fiction or non-fiction mode can come first — neither depends on the other.

#### 4.7 Image Handling

Writers commonly want images in multiple contexts: reference photos for characters, maps for world-building, diagrams in non-fiction, illustrations within chapters. TipTap supports image nodes, so a writer might paste an image into the editor at any point.

**Implementation:**
- Images are stored as files on disk in the Docker volume alongside the SQLite database (e.g., `/app/data/images/`).
- A simple `/api/images` upload endpoint accepts an image file and returns a URL path.
- TipTap's built-in image extension is enabled, allowing images in chapter content, outtakes, and (in later phases) world-building entries, character sheet notes, research source notes, and journal entries.
- Accepted formats: JPEG, PNG, GIF, WebP. Maximum file size: 10MB per image.
- Images are referenced by URL in the TipTap JSON. Deleting an image node from the document does not delete the file (avoids data loss if the writer undoes). Orphaned image cleanup can be a background task.

**Export integration:** When exporting (Phase 3 pipeline), images referenced in chapter content are embedded in the output file (base64 for HTML, embedded for EPUB/DOCX, rendered for PDF).

### Data Model Changes

**New table: ChapterSnapshot**
- `id` — UUID, primary key
- `chapter_id` — foreign key → Chapter
- `label` — text, nullable
- `content` — text (TipTap JSON)
- `word_count` — integer
- `created_at` — timestamp

**New table: Outtake**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
- `label` — text, nullable
- `content` — text (TipTap JSON, same format as chapters)
- `word_count` — integer
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable (soft delete)

No separate tables for notes or tags — these are stored within the TipTap JSON as custom marks.

### API Changes

- `POST /api/chapters/{id}/snapshots` — create a manual snapshot (body: optional label).
- `GET /api/chapters/{id}/snapshots` — list snapshots for a chapter.
- `GET /api/snapshots/{id}` — get snapshot content.
- `POST /api/snapshots/{id}/restore` — restore a snapshot (replaces chapter content, with automatic pre-restore snapshot).
- `GET /api/projects/{id}/notes` — extract and return all notes from all chapters (aggregation across JSON documents).
- `POST /api/projects/{id}/outtakes` — create an outtake.
- `GET /api/projects/{id}/outtakes` — list outtakes.
- `PATCH /api/outtakes/{id}` — update outtake.
- `DELETE /api/outtakes/{id}` — soft-delete outtake.
- `POST /api/projects/{id}/search` — body: `{ query, options (case_sensitive, whole_word, chapter_ids) }`. Returns matches with context, grouped by chapter.
- `POST /api/projects/{id}/replace` — body: `{ search, replace, options, scope (chapter_id or "all") }`. Auto-snapshots affected chapters before replacing. Returns count of replacements and list of affected chapter IDs.
- `GET /api/projects/{id}/tags` — return all unique tags with occurrence counts and locations.
- `POST /api/images` — upload an image file. Returns `{ url }`.

### UI/UX Notes

- Inline notes should feel like margin scribbles, not formal annotations. The visual treatment should be subtle — a soft highlight or a small icon in the gutter, not a heavy underline that disrupts reading flow.
- The scratchpad should be easily accessible (reference panel tab) but out of the way. It's a drawer, not a second editor.
- Find and replace is a modal or panel (not a separate page). It should be keyboard-first: Ctrl/Cmd+H opens it, typing starts searching immediately.
- Tags should auto-suggest as you type, drawing from existing tags. This encourages consistency (using "Athens" everywhere rather than "Athens" and "athens" and "Greece - Athens").
- Snapshots should feel like a safety net, not a version control system. The UI should be simple: a chronological list with labels and dates, one-click restore with confirmation.

### Dependencies

- MVP (TipTap editor with custom extension support).
- Extending TipTap with custom marks (notes, tags) is the core technical challenge. ProseMirror makes this well-supported but it requires understanding the ProseMirror schema and decoration system.

---

## Phase 5a: Fiction — Characters & Scenes

### Goal

Give novelists the two most essential reference tools: structured character records and scene-level story structure. These are the tools writers reach for most often while drafting.

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
- Relationships (text-based in this phase; linked relationships come in Phase 5c)
- Status (alive, deceased, unknown)
- First appearance (link to chapter)

**Freeform notes area:** Unstructured text (TipTap editor, supporting images via Phase 4's image handling) for anything that doesn't fit the fields — character voice notes, inspiration references, open questions about the character.

Design principle: structured fields are for quick reference lookups; freeform notes are for creative thinking. Both are needed.

Characters are displayed in the reference panel (Phase 4 infrastructure). The writer can have a character sheet visible while writing the corresponding chapter.

#### 5a.2 Scene Cards / Outline Mode

A layer of story structure that sits above (or alongside) chapters. Each scene card captures:

- **Title:** Short description ("Maria discovers the betrayal")
- **POV character:** Link to character sheet
- **Setting/location:** Freeform text (linked to world-building entries in Phase 5b)
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

**New table: Character**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
- `name` — text, required
- `aliases` — text, nullable
- `age` — text, nullable
- `physical_description` — text, nullable
- `personality` — text, nullable
- `backstory` — text (TipTap JSON), nullable
- `character_arc` — text, nullable
- `relationships_text` — text, nullable (freeform; structured relationships in 5c)
- `status` — enum: "alive" | "deceased" | "unknown", default "alive"
- `first_appearance_chapter_id` — foreign key → Chapter, nullable
- `notes` — text (TipTap JSON), nullable
- `sort_order` — integer
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

**New table: SceneCard**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
- `title` — text, required
- `pov_character_id` — foreign key → Character, nullable
- `setting` — text, nullable
- `purpose` — text, nullable
- `mood` — text, nullable
- `status` — enum: "draft" | "written" | "revised"
- `chapter_id` — foreign key → Chapter, nullable
- `sort_order` — integer
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

**New table: SceneCharacter** (many-to-many)
- `scene_card_id` — foreign key → SceneCard
- `character_id` — foreign key → Character

### UI/UX Notes

- Character sheets and scene cards live in the reference panel (built in Phase 4). New tabs are added to the panel for "Characters" and "Scenes."
- Character sheets should have a search/filter function. A novel with 30+ characters needs quick lookup.
- Scene cards should feel like index cards. Consider a visual design that echoes physical index cards (slightly off-white background, subtle shadow, compact typography).

### Dependencies

- Phase 4 (reference panel infrastructure, image handling for character photos, tags for cross-referencing).

---

## Phase 5b: Fiction — World-Building

### Goal

Give novelists the tools to build and reference a consistent, detailed story world. Essential for speculative fiction, historical fiction, and any story with a complex setting.

### Features

#### 5b.1 World-Building Bible

A hierarchical knowledge base for the story's setting.

**Structure:** World → Region → City/Area → Notable Location, but the hierarchy is flexible — the writer defines the levels. Each entry has:

- **Name**
- **Description** (rich text, TipTap editor, supporting images)
- **Parent entry** (for hierarchy)
- **Category:** Location, system (magic, political, technological), history, culture/society, other
- **Tags** (for cross-referencing, using the Phase 4 tag system)
- **Related characters** (links to character sheets from Phase 5a)
- **Related chapters** (which chapters feature this entry)
- **Image** (optional — a reference image, map, etc., via Phase 4 image handling)

The world-building bible is displayed in the reference panel with collapsible hierarchy navigation.

#### 5b.2 "Who's in the Room?" Tracker

A per-scene annotation (linked to scene cards from Phase 5a) tracking which characters are present. This prevents the common continuity error where a character speaks dialogue but was never established as being in the scene, or where a character is present but never acknowledged.

This is stored as part of the scene card's "characters present" field (SceneCharacter table from Phase 5a), but surfaced as a quick-reference widget in the reference panel when the writer is editing the corresponding chapter. The widget shows the characters present in the linked scene and allows quick edits.

### Data Model Changes

**New table: WorldEntry**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
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
- `CharacterWorldEntry` — many-to-many: Character ↔ WorldEntry
- `ChapterWorldEntry` — many-to-many: Chapter ↔ WorldEntry

### UI/UX Notes

- The world-building bible should support collapsible sections and hierarchy navigation. For a complex fantasy world, this could be dozens or hundreds of entries.
- The "who's in the room" widget should be small and unobtrusive — a compact list of character names with a link to each character sheet, displayed in the reference panel when a scene-linked chapter is active.

### Dependencies

- Phase 5a (character sheets and scene cards, which this phase extends).

---

## Phase 5c: Fiction — Visualizations

### Goal

Provide specialized visual tools for understanding story structure: how characters relate to each other, and how story time maps to narrative time.

### Features

#### 5c.1 Relationship Map

A visual graph showing connections between characters.

- Nodes are characters (from character sheets).
- Edges are relationships, labeled with the relationship type (e.g., "married to," "rival of," "mentor," "sibling").
- Relationships are directional when appropriate ("reports to" vs. "manages").
- The graph is interactive: drag to rearrange, click a node to view the character sheet in the reference panel.
- Relationships are defined as structured data and automatically reflected in the graph — the map is a *view*, not a separate data source.

#### 5c.2 Timeline View

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
- `project_id` — foreign key → Project
- `character_a_id` — foreign key → Character
- `character_b_id` — foreign key → Character
- `relationship_type` — text (e.g., "married to," "rival of")
- `is_directional` — boolean, default false
- `created_at` — timestamp
- `updated_at` — timestamp

**New table: TimelineEvent**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
- `description` — text, required
- `story_date` — text, nullable (text to support relative dates like "3 days before the fall")
- `story_sort_order` — integer (for ordering on the chronological timeline)
- `narrative_sort_order` — integer (for ordering on the narrative timeline; defaults to the linked chapter's sort_order)
- `chapter_id` — foreign key → Chapter, nullable
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable

**New cross-reference table:**
- `TimelineEventCharacter` — many-to-many: TimelineEvent ↔ Character

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
- **Tags** (freeform, with autocomplete from existing tags — reusing Phase 4 tag infrastructure)
- **Notes** (rich text TipTap editor, supporting images — writer's summary, key quotes, reactions, page references)
- **Status:** Unread, reading, read, to-revisit

The library is searchable and filterable by tag, type, status, and full text. When writing, the writer can search the library from the research side panel (§6a.4) and drag a reference into their text (creating a citation link — see §6a.2).

#### 6a.2 Citation Management

A lightweight citation system — not full academic citation management (that's Zotero's job), but enough to track the connection between claims in the prose and their supporting sources.

**Behavior:**
- A writer can link any text selection to one or more sources from the research library.
- The link is stored as a TipTap custom mark (similar to inline notes in Phase 4), with the source ID(s) as attributes.
- In the editor, cited text has a subtle visual indicator (e.g., a superscript number or a colored underline).
- Hovering shows the source title and a link to the full source entry.
- A "Citations" panel in the reference panel lists all citations in the current chapter, in document order.

**On export (Phase 3 pipeline integration):**
- The writer chooses a citation style: footnotes, endnotes, inline references, or hidden (strip all citations).
- For footnotes/endnotes, Smudge generates them automatically from the source data: Author, Title, Year (a simplified format — not trying to replicate Chicago/MLA/APA perfectly, but sufficient for a draft manuscript).
- A bibliography/references section is generated at the end of the export.
- This is implemented as new filter and structure steps in the Phase 3 export pipeline (§3.5).

#### 6a.3 Fact-Check Status Flags

A per-claim annotation system. Any text selection can be marked with a verification status:

- **Verified** — the writer has confirmed this claim against a source.
- **Needs verification** — the writer believes it's true but hasn't checked.
- **Disputed** — the writer is aware of counter-evidence or conflicting sources.
- **Placeholder** — the writer knows this is wrong/incomplete and intends to fix it.

**Implementation:** TipTap custom mark with a `factcheck_status` attribute.

**Dashboard integration:** The project dashboard (Phase 1) shows a fact-check summary: "42 claims verified, 12 need verification, 3 disputed, 5 placeholder." The writer can click each category to see all passages with that status.

**Visual distinction from inline notes:** Fact-check flags use a cooler color indicator with an icon (checkmark, question mark, exclamation mark, construction sign), distinct from the warm highlight used for inline notes (Phase 4).

#### 6a.4 Research Side Panel

The reference panel (built in Phase 4) gets new tabs for research:

- **Source search:** Search the research library from within the editor.
- **Relevant sources:** Automatically suggested sources based on the tags of the current chapter (if the chapter is tagged "enclosure movement," sources tagged "enclosure movement" are surfaced).
- **Recent sources:** The last 5–10 sources the writer viewed or cited.
- **Quick-add:** Add a new source to the library without leaving the editor.

### Data Model Changes

**New table: Source**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
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
- Phase 3 (export pipeline, for generating footnotes/endnotes/bibliography).
- Phase 4 (TipTap custom marks infrastructure, tags system, reference panel, image handling).
- Phase 5 is NOT required — non-fiction mode is fully independent of fiction mode.

---

## Phase 6b: Non-Fiction — Argument Structure

### Goal

Make the logical structure of a non-fiction argument visible and navigable, separately from the prose.

### Features

#### 6b.1 Argument Structure Visualization

Non-fiction, especially the kind Ovid writes, has a logical structure: thesis → supporting arguments → evidence → counterarguments → rebuttals. This feature makes that structure visible separately from the prose.

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
- `project_id` — foreign key → Project
- `parent_id` — self-referential foreign key (nullable for root thesis)
- `node_type` — enum: "thesis" | "argument" | "evidence" | "counterargument" | "rebuttal"
- `title` — text
- `description` — text, nullable
- `sort_order` — integer
- `linked_chapter_id` — foreign key → Chapter, nullable
- `linked_source_id` — foreign key → Source, nullable
- `created_at` — timestamp
- `updated_at` — timestamp

### UI/UX Notes

- The argument visualization should be a simple indented tree or outline — not a mind map or complex graph. Writers think in outlines. If the tree gets large, collapsible sections are essential.
- The tree is displayed as a tab in the reference panel. The writer can view it alongside the editor to check that their prose matches their argument structure.
- Keyboard-navigable: arrow keys to move between nodes, Enter to expand/collapse, Tab to navigate to linked chapters.
- This feature deserves design iteration. The right UX for "map your argument" is a design challenge — expect to prototype and refine.

### Dependencies

- Phase 6a (research library — evidence nodes link to sources).
- Phase 4 (reference panel infrastructure).

---

## Phase 7: Polish & Power

### Goal

Refine the experience for writers who use Smudge daily. These features aren't essential — the tool works without them — but they're the difference between a tool you use and a tool you love.

### Features

#### 7.1 Distraction-Free Mode

A full-screen writing mode that strips all UI chrome: no sidebar, no toolbar, no status bar, no reference panel. Just the writer's text, centered, with generous margins. The cursor and the text are the only visible elements.

- Activated via a dedicated shortcut or button.
- Mouse movement or a specific key (Escape) reveals the UI temporarily.
- The formatting toolbar can appear on text selection (contextual, not persistent).
- Word count is hidden (or shown as a faint, unobtrusive element at the very bottom of the screen).
- Auto-save continues to function silently in the background.

#### 7.2 Split View

Side-by-side panels within the editor. Possible configurations:

- Two chapters (write Chapter 7 while referencing Chapter 3).
- Chapter + character sheet (fiction mode).
- Chapter + research source (non-fiction mode).
- Chapter + preview of the same chapter.

The split is created via a menu or shortcut. Each panel independently scrolls and can be any content type (chapter, reference, preview).

Note: the reference panel (Phase 4) already provides a side panel for reference material. Split view extends this by allowing *two full editor panes* or *two arbitrary content types*, not just "editor + reference."

#### 7.3 Dark Mode

A full dark theme. Not just inverting colors — a carefully designed dark palette that maintains the warm, writerly tone:

- Dark warm gray background (not pure black — more like #1A1A1E).
- Warm off-white text (not pure white — more like #E8E4DF).
- Accent color adjusted for dark backgrounds.
- All WCAG AA contrast requirements still met.
- Respects `prefers-color-scheme: dark` system preference, with a manual toggle.
- Stored as a user preference (persisted in the app settings table from Phase 2).

**Prerequisite:** The MVP must use CSS custom properties / Tailwind theme tokens for all colors, backgrounds, and borders. If this groundwork is in place, dark mode is a theme swap. (This prerequisite should be captured in the MVP PRD.)

#### 7.4 Style Linting

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

#### 7.5 Text-to-Speech (Read Aloud)

The browser's native SpeechSynthesis API reads the current chapter (or a selected passage) aloud. Hearing prose read back is one of the most effective self-editing techniques — awkward phrasing that the eye skips over becomes immediately obvious when heard.

- Play, pause, stop controls.
- Adjustable speed and voice (from system-available voices).
- Current word highlighted in the editor as it's spoken.
- Reading respects chapter structure (reads the title, then the content).

**Caveat:** Browser TTS quality varies significantly. This is a "good enough" tool, not a professional narration feature. Note the limitation in the UI.

#### 7.6 Writing Journal / Log

A per-project, date-keyed journal for writing *about* the writing. Separate from the manuscript. Entries might include:

- "Struggled with Chapter 6 today — the transition from the Rome argument to the modern parallel feels forced."
- "Realized the character of Alexei needs a clearer motivation in Act 2."
- "Hit 50,000 words! The first half is drafted."

The journal is a simple dated-entry system using the same TipTap editor. It's searchable and browsable by date. It does not appear in exports or word counts.

#### 7.7 UI Translation (Full i18n)

Replace the string constants file (MVP's `strings.ts`) with a proper i18n system (react-i18next). Provide initial translations for high-value languages (French, Spanish, German — based on user demand). Community translation contributions welcome via a simple JSON file format.

This also includes setting the `lang` attribute correctly on content regions based on the project's or chapter's language setting.

#### 7.8 Import

Import existing manuscripts into Smudge from external formats:

- **Markdown:** Split on H1/H2 headings into chapters. Map formatting to TipTap nodes.
- **Word (.docx):** Map Word styles to TipTap nodes. Split on Heading 1 into chapters.
- **Plain text:** Split on blank-line-separated sections or manual markers.

These cover the most common "I have an existing manuscript" scenarios. Import is critical for Electron distribution (new users need to bring their existing work).

### Data Model Changes

**New table: JournalEntry**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
- `date` — date
- `content` — text (TipTap JSON)
- `created_at` — timestamp
- `updated_at` — timestamp

**User preferences** (extend the app settings table from Phase 2):
- Theme preference (light/dark/system)
- Crutch words list
- Default export format
- Language preference

### Dependencies

- 7.1 (Distraction-free): MVP only.
- 7.2 (Split view): Phase 4 (reference panel infrastructure).
- 7.3 (Dark mode): MVP only (requires CSS custom properties groundwork).
- 7.4 (Style linting): MVP only (operates on TipTap JSON).
- 7.5 (TTS): MVP only (browser API).
- 7.6 (Writing journal): MVP only.
- 7.7 (i18n): MVP string externalization.
- 7.8 (Import): Phase 3 (format conversion knowledge).

### Notes on Ordering Within Phase 7

Phase 7 is a grab-bag by design — these features are independent. They can be built in any order based on what the writer wants most. A suggested priority based on effort-to-impact ratio:

1. **Dark mode** — cheapest if CSS custom properties are used from the start. High daily-use impact.
2. **Distraction-free mode** — relatively simple (hide UI elements, add a new shortcut). High writing-flow impact.
3. **Writing journal** — small feature, reuses existing editor. Nice for reflection.
4. **Style linting** — moderate effort, high editing-phase impact.
5. **Split view** — moderate-to-high effort (new layout system). High reference impact.
6. **TTS** — low effort (browser API), moderate impact (useful but quality varies).
7. **Import** — moderate effort, critical for Electron distribution.
8. **Full i18n** — high effort (translation work), impact depends on user base.

Note: Versioning/snapshots was originally in Phase 7 but has been moved to Phase 4, where it provides a safety net for find-and-replace.

---

## Cross-Phase Considerations

### Performance

As the data model grows across phases, query performance should be monitored. Specific concerns:

- **Phase 2:** Daily snapshots grow indefinitely. Consider archiving or aggregating old data (e.g., keep daily granularity for the last 90 days, weekly aggregates beyond that).
- **Phase 4:** Full-text search across all chapters (find and replace) may require an index. SQLite's FTS5 extension is well-suited and could be added without changing the database engine.
- **Phase 5/6:** Cross-reference queries (all characters in a scene, all sources tagged X) involve multi-table joins. Denormalization or materialized views may be needed if performance degrades.

### Migration Path

Each phase adds tables and columns to the SQLite database. The Knex migration system (established in the MVP) handles this, but each phase's PRD should include the specific migration scripts. Migrations must be idempotent and safe to run against an existing database with live data.

### The Reference Panel (Phase 4 → all later phases)

The right-side reference panel is built in Phase 4 as shared infrastructure. It is a generic container that hosts different content types via a tab or stack interface. Phases 5a, 5b, 5c, 6a, and 6b all add tabs to this panel. Building it once in Phase 4 prevents duplicating effort and ensures Phases 5 and 6 are truly independent — either fiction or non-fiction mode can come first.

### Image Handling (Phase 4 → all later phases)

Image upload and storage is introduced in Phase 4 and used by chapter content, outtakes, character sheet notes (5a), world-building entries (5b), research source notes (6a), and journal entries (7). The image handling infrastructure is built once and reused everywhere.

### Export Evolution (Phase 3 → 4, 5, 6a)

The export pipeline (Phase 3) is designed as composable steps (§3.5). As later phases add features that affect export:

- Phase 4: Strip inline notes from export. Optionally include/exclude tagged content.
- Phase 5: Optionally include character sheets or world-building as appendices.
- Phase 6a: Generate footnotes, endnotes, and bibliography from citation marks and source data.

Each of these inserts new filter or structure steps into the existing pipeline without rebuilding it.

### Accessibility Continuity

Every phase must maintain the WCAG 2.1 AA standard established in the MVP. Each phase's PRD should include an accessibility section that addresses the specific a11y concerns for the new features (e.g., the relationship map in Phase 5c must be keyboard-navigable and have screen reader equivalents; the style linting highlights in Phase 7 must not rely on color alone).

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
| 3 | Phase 6 falsely lists Phase 5 as dependency | Reference panel extracted into Phase 4 as shared infrastructure; Phases 5 and 6 are fully independent |
| 4 | Find-and-replace can corrupt entire manuscript with no recovery | Manual snapshots pulled from Phase 7 into Phase 4 as prerequisite; auto-snapshot before replace-all |
| 5 | Session lifecycle has orphaned state and edge cases | Sessions derived from save timestamps instead of explicit start/end; removed three API endpoints |
| 6 | No image handling anywhere in roadmap | Image upload/storage added as Phase 4 cross-phase infrastructure |
| 7 | Export doesn't address soft-deleted chapters | Soft-deleted chapters silently excluded from export |
| 8 | Argument structure visualization is separate concern from research tools | Split into Phase 6a (research tools) and Phase 6b (argument tree) |
| 9 | Chapter status defaults to "rough_draft" for empty chapters | Default changed to "outline" |
| 10 | Dark mode needs MVP groundwork (CSS custom properties) | Flagged — owner is updating MVP PRD directly |
| 11 | No import capability | Deferred to Phase 7 |
| 12 | Find-and-replace conflicts with open editor state | Force-save before replace, reload affected chapter from server after |
| 13 | Daily snapshots ignore timezone | Timezone setting added to Phase 2, defaults from browser |
