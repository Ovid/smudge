Here’s a concrete design note you can use.

## Smudge: simplifying project storage, autosave, and deadline tracking

### Executive summary

Smudge already has a strong core identity: it is “for people writing books, not documents,” organized as **projects made of chapters**, with the **manuscript as the unit of work** rather than isolated files. The MVP also explicitly says the essentials are projects, chapters, reordering, preview, trusted saving, and word count; it says **goals come later**. The current implementation is a React client plus Express/SQLite server, with autosave built around chapter updates, retry/backoff, and a local cache for unsaved chapter content. ([GitHub][1])

The design has started to drift in two directions at once. First, the product is moving toward a richer **project/workspace** model: research files, citations, snapshots, exports, and future desktop-opening behavior. Second, the progress system has become increasingly analytical: the roadmap and migrations add project and chapter targets, app settings, `save_events`, `daily_snapshots`, timezone-aware `save_date`, server-side derived sessions, streaks, and burndown-oriented APIs. That is a meaningful expansion from “trust the save” into “infer and analyze writer behavior.” ([GitHub][2])

My recommendation is to separate three concerns that are currently entangled: **project storage**, **draft recovery**, and **progress calculation**. Once those are separated, the architecture gets much simpler.

---

## 1. Diagnosis

### What is currently solid

The current core schema is simple and appropriate for a writing app: `projects` and `chapters`, each with timestamps and soft-delete columns, plus chapter ordering and word counts. That fits the book-first model well. The autosave behavior is also directionally sound: content changes update local chapter word counts, cache unsaved content locally, save with retry/backoff, and clear the cache on successful save. ([GitHub][3])

### What is currently overextended

The overengineering is not primarily “autosave.” It is that autosave is being used as the raw material for a fairly elaborate **velocity subsystem**. Phase 2 adds deadlines, targets, daily word histories, derived sessions, averages, streaks, burndown charts, per-chapter targets, timezone settings, and projected completion. The migrations reflect that growth: `target_word_count`, `target_deadline`, `completion_threshold`, `settings`, `save_events`, `daily_snapshots`, chapter-nullable save events to preserve history, and then a timezone-aware `save_date` plus an index for those queries. ([GitHub][2])

That creates a mismatch with the MVP’s original promise. The MVP says, in effect, “Can I write my book safely today?” The current velocity model is closer to “Can Smudge become an observability system for writing behavior?” Those are different product levels. ([GitHub][4])

---

## 2. The conceptual fix

You need three distinct models:

### A. Project model

What the writer is working on: manuscript, chapters, notes, research assets, exports, snapshots.

### B. Recovery model

What protects against crashes, failed saves, and accidental loss.

### C. Progress model

What tells the writer whether they are roughly on track.

Right now, these bleed into each other. The consequence is that saving text also becomes an event stream for analytics, and that makes future storage/file-format decisions harder than they need to be.

---

## 3. Recommended storage model

The key move is this:

**Make “project” the first-class artifact, not “document” and not “autosave stream.”**

### Active project format

I would make the active editable format a **project folder/package**, not a single monolithic file:

```text
My Novel.smudge/
  manifest.json
  project.sqlite
  assets/
  snapshots/
  exports/
```

`project.sqlite` stores manuscript structure and metadata.
`assets/` stores managed research files such as PDFs, DOCX files, and images.
`snapshots/` stores recovery checkpoints and explicit version points.
`manifest.json` stores schema version, app version, and package metadata.

This solves several problems at once:

* “Open Recent” becomes “recent projects,” which fits how writers think.
* Future double-click opening has a real target.
* Research files stop distorting the manuscript model.
* Backup and corruption handling are easier than with one giant opaque file.

### Portable format

Later, define `.smg` as a **portable bundle/export format**. In practice, that can be a zip-like container of the project folder. That gives you a single-file thing for sharing, email, import/export, and OS integration without forcing the live editing model to be a single-file artifact.

### Asset handling

Support two research-asset modes:

* **Linked asset**: store path + metadata; original file stays where it is.
* **Managed asset**: copy file into `assets/` so the project is portable.

That is much more flexible than assuming all research material should live inside one database or one `.smg` file.

---

## 4. Recommended database shape

### Keep the manuscript schema small

For the editable project database, I would keep something close to this:

```sql
projects(
  id,
  title,
  mode,
  slug,
  target_word_count nullable,
  target_deadline nullable,
  created_at,
  updated_at,
  deleted_at nullable
)

chapters(
  id,
  project_id,
  title,
  content,
  sort_order,
  word_count,
  status nullable,
  created_at,
  updated_at,
  deleted_at nullable
)

assets(
  id,
  project_id,
  kind,              -- pdf, docx, image, web-link, note, etc.
  storage_mode,      -- linked | managed
  path_or_uri,
  title,
  mime_type,
  size_bytes nullable,
  extracted_text nullable,
  created_at,
  updated_at,
  deleted_at nullable
)

snapshots(
  id,
  project_id,
  chapter_id nullable,
  snapshot_type,     -- auto | manual | pre-destructive-op
  label nullable,
  content,
  created_at
)
```

### Remove or demote the event-heavy analytics tables

I would **remove from the critical path**:

* `save_events`
* server-side derived sessions
* per-chapter target word counts
* `completion_threshold`
* timezone-driven session grouping logic
* streak infrastructure

You do not necessarily need to delete those tables immediately, but I would stop building product assumptions on them.

### Keep only one lightweight progress history table

If you still want historical progress, keep one tiny table:

```sql
daily_progress(
  project_id,
  date,
  total_word_count,
  created_at,
  primary key (project_id, date)
)
```

This is enough to support:

* words today
* last 7 days
* last 30 days
* rough average pace
* projected completion date

You do not need save-level event logging to answer those questions.

---

## 5. Recommended autosave model

Autosave should do one job: **preserve work**.

I would define three distinct save concepts.

### 1. Working save

The normal debounced save of the active chapter into the project database.

Current behavior is already close: on content change, the chapter word count updates locally, the content is cached locally, and save retries happen with backoff. ([GitHub][5])

### 2. Crash recovery cache

This is not history. It is just an emergency buffer.

Right now your client cache is localStorage-backed by chapter id. That is a decent start for recovery on browser crash or failed network save. In Electron, I would keep the same abstraction but back it with a local app store or local DB table instead of browser localStorage. ([GitHub][6])

### 3. Snapshots

This is history.

Create snapshots:

* before destructive operations,
* on explicit writer request,
* optionally every N minutes if content changed significantly.

Do **not** generate a permanent historical record for every save. That is the step that turns a writing app into a telemetry system.

---

## 6. Simplified deadline/progress model

This is where I think you should be much harsher with scope.

### What to keep

At project level only:

* `target_word_count`
* `target_deadline`
* current total manuscript word count
* optional daily progress snapshots

That lets you compute:

* remaining words
* days until deadline
* required words/day
* 7-day rolling average
* rough projected completion date

That is enough for a writer-facing status message like:

> 41,200 / 80,000 words.
> 52 days left.
> Needed pace: 746 words/day.
> Recent pace: 680 words/day.

That is helpful and calm.

### What to drop or defer

I would defer:

* derived sessions
* streaks
* burndown charts
* per-chapter targets
* chapter-completion thresholds
* timezone settings UI unless you genuinely need cross-timezone correctness now

The reason is simple: these features answer questions that most writers do not urgently need, while introducing policy arguments that you will need to maintain forever.

For example:

* Does heavy editing count as writing?
* Does deleting 2,000 words mean the writer “lost progress”?
* What is a session if they leave for lunch?
* What happens when a chapter is split or merged?
* What timezone owns the project if the writer travels?

Those are all real questions, but they are second-order questions. The first-order question is just: **am I roughly on track?**

---

## 7. Migration plan from where you are now

### Phase A: freeze complexity

Stop adding more velocity features until the storage model is settled.

### Phase B: define the project container

Introduce a clear internal concept of:

* `ProjectStore`
* `AssetStore`
* `SnapshotStore`

Even if you keep the current web architecture for now, this gives you a seam for Electron later.

### Phase C: simplify progress

Keep project-level `target_word_count` and `target_deadline`. Keep `daily_snapshots` only if you want lightweight trend data. Stop relying on `save_events` for core UX.

### Phase D: demote event history

Mark `save_events` as transitional or diagnostic, not product-defining. Do not build more user-facing logic around it.

### Phase E: introduce explicit snapshots

Before replace-all, import operations, chapter merge/split, or delete/purge, create a snapshot. This gives you meaningful recovery without pretending every autosave is a version-control commit.

### Phase F: move toward package-based projects

When you begin Electron work, let each project become a package/folder with its own SQLite DB and assets. Then later add bundle export/import as `.smg`.

---

## 8. What I would implement next

In order:

1. **Lock the progress feature set down** to project target + deadline + simple pace math.
2. **Add a `snapshots` table** and use it before destructive operations.
3. **Introduce an `assets` concept** even if the UI is initially minimal.
4. **Create an internal project-package abstraction** so the storage model is no longer “the app has one SQLite database.”
5. **Treat `.smg` as an export/import concern first**, not the live-editing storage primitive.

---

## 9. The decision in one sentence

Smudge should store a writer’s work as a **project container**, protect it with **draft recovery plus snapshots**, and report progress with **simple project-level math**, not with a save-event analytics pipeline.

---

## 10. Concrete recommendation

If you want the strongest default path, I would choose this:

* **Live editing model:** project package/folder
* **Project database:** SQLite inside the package
* **Research files:** linked or managed assets
* **Autosave:** frequent draft persistence + crash cache
* **History:** snapshots, not save-event archaeology
* **Progress:** project-level target/deadline plus daily totals only
* **`.smg`:** bundle/export format for portability and future OS open behavior

That gives you a cleaner mental model, a saner future Electron path, and a much smaller surface area for accidental complexity.

If you want, I can turn this into a **repo-ready markdown design doc** with sections like “Problem,” “Goals,” “Non-goals,” “Data Model,” “Migration Plan,” and “Open Questions.”

[1]: https://github.com/Ovid/smudge/ "GitHub - Ovid/smudge: Write, write, baby · GitHub"
[2]: https://raw.githubusercontent.com/Ovid/smudge/main/docs/roadmap.md "raw.githubusercontent.com"
[3]: https://github.com/Ovid/smudge/blob/main/packages/server/src/db/migrations/001_create_projects_and_chapters.js "smudge/packages/server/src/db/migrations/001_create_projects_and_chapters.js at main · Ovid/smudge · GitHub"
[4]: https://raw.githubusercontent.com/Ovid/smudge/main/docs/plans/mvp.md "raw.githubusercontent.com"
[5]: https://github.com/Ovid/smudge/blob/main/packages/client/src/hooks/useProjectEditor.ts "smudge/packages/client/src/hooks/useProjectEditor.ts at main · Ovid/smudge · GitHub"
[6]: https://github.com/Ovid/smudge/blob/main/packages/client/src/hooks/useContentCache.ts "smudge/packages/client/src/hooks/useContentCache.ts at main · Ovid/smudge · GitHub"

