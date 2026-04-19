# Phase 4b: Snapshots & Find-and-Replace — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give writers a safety net (snapshots) and a powerful editing tool (project-wide find-and-replace), split into two sub-phases: 4b-i (snapshots) and 4b-ii (find-and-replace).

**Architecture:** New `snapshots` domain module (routes/service/types) following the existing chapters pattern. Snapshot CRUD via ProjectStore interface. Find-and-replace uses a shared TipTap text-walker utility for searching/replacing across the JSON tree, with server-side transactional replacement. Client adds two slide-out panels (snapshot history, find-and-replace) using the existing ReferencePanel pattern.

**Tech Stack:** Express routes, Knex migrations, Zod validation, Vitest + Supertest (server), React + TipTap (client), Playwright (e2e)

**Design doc:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`

---

## TDD Methodology (applies to all tasks)

Every task that produces code follows **RED → GREEN → REFACTOR**:

### RED — Write a failing test first
- Define expected behavior before writing implementation code
- Run the test and **verify it fails for the right reason** (e.g., "module not found" or "function not defined", not a syntax error in the test)
- **If it passes unexpectedly:** stop and investigate. Either the feature already exists, your test is wrong, or your assumptions about the codebase are wrong. All three are valuable to discover early.

### GREEN — Write minimal code to pass
- Implement the simplest thing that makes the test pass
- No anticipatory abstractions, no "while I'm here" improvements
- If you need to suppress console output in tests that exercise error paths, spy on the logger/console and assert the expected message

### REFACTOR — Clean up what you just wrote
After each GREEN pass, explicitly check for:
- **Duplicated logic** to extract into a helper (especially patterns shared with existing chapter/image code)
- **Hard-coded values** that belong in constants or config
- **Inconsistent patterns** with existing code in the same domain (naming, error handling, return types)
- **Missing type exports** from index files
- **Test helper opportunities** — shared fixtures or factories that would reduce test duplication

Focus refactoring on what you just wrote. Touching surrounding code is fine when the refactor requires it (e.g., extracting a shared helper from existing code, or changing a function signature to support reuse) — the test suite will catch regressions. Don't do drive-by cleanup unrelated to the current task.

### Commit cadence
Commit after each task's GREEN+REFACTOR pass. Each commit should leave the codebase in a passing state.

---

## Sub-phase 4b-i: Snapshots

### Task 1: Database Migration

Create the `chapter_snapshots` table.

**Files:**
- Create: `packages/server/src/db/migrations/014_create_chapter_snapshots.js`

**Step 1: Write the migration**

```js
// 014_create_chapter_snapshots.js
export async function up(knex) {
  await knex.schema.createTable("chapter_snapshots", (table) => {
    table.text("id").primary();
    table.text("chapter_id").notNullable().references("id").inTable("chapters");
    table.text("label");
    table.text("content").notNullable();
    table.integer("word_count").notNullable();
    table.boolean("is_auto").notNullable().defaultTo(false);
    table.text("created_at").notNullable();
    table.index(["chapter_id", "created_at"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("chapter_snapshots");
}
```

**Step 2: Verify migration runs**

Run: `npm test -w packages/server -- --run -t "health"`
Expected: PASS (migrations run in test setup via `testDb.migrate.latest()`)

**Step 3: Commit**

```
feat: add chapter_snapshots migration (014)
```

---

### Task 2: Snapshot Types & Shared Schema

Define TypeScript types and Zod validation for snapshots.

**Files:**
- Create: `packages/server/src/snapshots/snapshots.types.ts`
- Modify: `packages/shared/src/schemas.ts` (add CreateSnapshotSchema)
- Modify: `packages/shared/src/index.ts` (re-export)

**Step 1: Create snapshot types**

```ts
// packages/server/src/snapshots/snapshots.types.ts
export interface SnapshotRow {
  id: string;
  chapter_id: string;
  label: string | null;
  content: string;
  word_count: number;
  is_auto: boolean;
  created_at: string;
}

export interface SnapshotListItem {
  id: string;
  chapter_id: string;
  label: string | null;
  word_count: number;
  is_auto: boolean;
  created_at: string;
}

export interface CreateSnapshotData {
  id: string;
  chapter_id: string;
  label: string | null;
  content: string;
  word_count: number;
  is_auto: boolean;
  created_at: string;
}
```

**Step 2: Add Zod schema to shared**

In `packages/shared/src/schemas.ts`, add:

```ts
export const CreateSnapshotSchema = z.object({
  label: z.string().trim().max(500, "Label is too long").optional(),
});
```

Re-export from `packages/shared/src/index.ts`.

**Step 3: Commit**

```
feat: add snapshot types and CreateSnapshotSchema
```

---

### Task 3: ProjectStore Interface & SQLite Implementation

Add snapshot methods to the store interface and implement them.

**Files:**
- Modify: `packages/server/src/stores/project-store.types.ts` (add snapshot section)
- Create: `packages/server/src/snapshots/snapshots.repository.ts`
- Modify: `packages/server/src/stores/sqlite-project-store.ts` (add delegation)
- Modify: `packages/server/src/__tests__/test-helpers.ts` (clear snapshots in beforeEach)

**Step 1: Add to ProjectStore interface**

Add a new `// --- Snapshots ---` section to `project-store.types.ts` after the Images section. Import `SnapshotRow`, `SnapshotListItem`, `CreateSnapshotData` from snapshots types:

```ts
// --- Snapshots ---
insertSnapshot(data: CreateSnapshotData): Promise<SnapshotRow>;
findSnapshotById(id: string): Promise<SnapshotRow | null>;
listSnapshotsByChapter(chapterId: string): Promise<SnapshotListItem[]>;
deleteSnapshot(id: string): Promise<number>;
getLatestSnapshotContentHash(chapterId: string): Promise<string | null>;
deleteSnapshotsByChapter(chapterId: string): Promise<number>;
```

**Step 2: Create snapshots repository**

```ts
// packages/server/src/snapshots/snapshots.repository.ts
import type { Knex } from "knex";
import type { SnapshotRow, SnapshotListItem, CreateSnapshotData } from "./snapshots.types";
import { createHash } from "crypto";

const TABLE = "chapter_snapshots";

export async function insert(db: Knex, data: CreateSnapshotData): Promise<SnapshotRow> {
  await db(TABLE).insert(data);
  return data as SnapshotRow;
}

export async function findById(db: Knex, id: string): Promise<SnapshotRow | null> {
  const row = await db(TABLE).where({ id }).first();
  return row ?? null;
}

export async function listByChapter(db: Knex, chapterId: string): Promise<SnapshotListItem[]> {
  return db(TABLE)
    .where({ chapter_id: chapterId })
    .select("id", "chapter_id", "label", "word_count", "is_auto", "created_at")
    .orderBy("created_at", "desc");
}

export async function remove(db: Knex, id: string): Promise<number> {
  return db(TABLE).where({ id }).del();
}

export async function getLatestContentHash(db: Knex, chapterId: string): Promise<string | null> {
  const row = await db(TABLE)
    .where({ chapter_id: chapterId })
    .orderBy("created_at", "desc")
    .select("content")
    .first();
  if (!row) return null;
  return createHash("sha256").update(row.content).digest("hex");
}

export async function deleteByChapter(db: Knex, chapterId: string): Promise<number> {
  return db(TABLE).where({ chapter_id: chapterId }).del();
}
```

**Step 3: Add delegation to SqliteProjectStore**

In `sqlite-project-store.ts`, import `* as snapshotsRepo` and add methods delegating to the repository, same pattern as other domains.

**Step 4: Update test-helpers.ts**

In `beforeEach`, add `await testDb("chapter_snapshots").del();` before the `chapters` delete (due to FK).

**Step 5: Write tests for repository layer**

Create `packages/server/src/__tests__/snapshots.repository.test.ts`:
- Test insert + findById returns full row
- Test listByChapter returns newest first, excludes content
- Test remove returns 1 for existing, 0 for non-existing
- Test getLatestContentHash returns null for no snapshots, hash for existing
- Test deleteByChapter removes all snapshots for that chapter

**Step 6: Run tests**

Run: `npm test -w packages/server -- --run`
Expected: All PASS

**Step 7: Commit**

```
feat: add snapshot store methods and repository with tests
```

---

### Task 4: Snapshot Service

Business logic for creating, listing, viewing, deleting, and restoring snapshots.

**Files:**
- Create: `packages/server/src/snapshots/snapshots.service.ts`
- Create: `packages/server/src/__tests__/snapshots.service.test.ts`

**Step 1: Write failing tests for the service**

Test cases:
- `createSnapshot` — creates a manual snapshot from current chapter content; returns snapshot
- `createSnapshot` — returns `null` if chapter not found
- `createSnapshot` — skips creation if content hash matches latest snapshot (dedup guard), returns existing latest
- `createSnapshot` with `is_auto: true` — creates auto-snapshot with generated label
- `listSnapshots` — returns list for chapter, newest first, no content
- `listSnapshots` — returns `null` if chapter not found
- `getSnapshot` — returns full snapshot with content
- `getSnapshot` — returns `null` if not found
- `deleteSnapshot` — returns `true` on success, `false` if not found
- `restoreSnapshot` — replaces chapter content, creates auto "before restore" snapshot, adjusts image reference counts, recalculates word count
- `restoreSnapshot` — returns `null` if snapshot not found
- `restoreSnapshot` — returns `null` if chapter not found (snapshot's chapter was purged)

**Step 2: Run tests to verify failures**

Run: `npm test -w packages/server -- --run -t "snapshot"`
Expected: FAIL (service doesn't exist yet)

**Step 3: Implement the service**

```ts
// packages/server/src/snapshots/snapshots.service.ts
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { countWords } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { extractImageIds, diffImageReferences } from "../images/images.references";
import type { SnapshotRow, SnapshotListItem } from "./snapshots.types";

export async function createSnapshot(
  chapterId: string,
  label?: string | null,
  isAuto = false,
): Promise<SnapshotRow | null | "duplicate"> {
  const store = getProjectStore();
  const chapter = await store.findChapterByIdRaw(chapterId);
  if (!chapter || chapter.deleted_at) return null;

  const content = chapter.content ?? JSON.stringify({ type: "doc", content: [] });

  // Dedup guard: skip if content matches latest snapshot (manual snapshots only)
  if (!isAuto) {
    const contentHash = createHash("sha256").update(content).digest("hex");
    const latestHash = await store.getLatestSnapshotContentHash(chapterId);
    if (latestHash === contentHash) return "duplicate";
  }

  const now = new Date().toISOString();
  const snapshot = await store.insertSnapshot({
    id: uuidv4(),
    chapter_id: chapterId,
    label: label?.trim() || null,
    content,
    word_count: chapter.word_count,
    is_auto: isAuto,
    created_at: now,
  });

  return snapshot;
}

export async function listSnapshots(chapterId: string): Promise<SnapshotListItem[] | null> {
  const store = getProjectStore();
  const chapter = await store.findChapterById(chapterId);
  if (!chapter) return null;
  return store.listSnapshotsByChapter(chapterId);
}

export async function getSnapshot(id: string): Promise<SnapshotRow | null> {
  const store = getProjectStore();
  return store.findSnapshotById(id);
}

export async function deleteSnapshot(id: string): Promise<boolean> {
  const store = getProjectStore();
  const count = await store.deleteSnapshot(id);
  return count > 0;
}

export async function restoreSnapshot(
  snapshotId: string,
): Promise<{ chapter: Record<string, unknown> } | null> {
  const store = getProjectStore();
  const snapshot = await store.findSnapshotById(snapshotId);
  if (!snapshot) return null;

  const result = await store.transaction(async (txStore) => {
    const chapter = await txStore.findChapterByIdRaw(snapshot.chapter_id);
    if (!chapter || chapter.deleted_at) return null;

    // Auto-snapshot current content before restore
    const currentContent = chapter.content ?? JSON.stringify({ type: "doc", content: [] });
    const snapshotLabel = snapshot.label
      ? `Before restore to '${snapshot.label}'`
      : `Before restore to snapshot from ${snapshot.created_at}`;

    // Skip dedup check for auto-restore snapshots — always create
    await txStore.insertSnapshot({
      id: uuidv4(),
      chapter_id: chapter.id,
      label: snapshotLabel,
      content: currentContent,
      word_count: chapter.word_count,
      is_auto: true,
      created_at: new Date().toISOString(),
    });

    // Compute image reference diff
    let oldContent: Record<string, unknown> | null = null;
    if (chapter.content) {
      try { oldContent = JSON.parse(chapter.content); } catch { /* corrupt */ }
    }
    let newContent: Record<string, unknown> | null = null;
    try { newContent = JSON.parse(snapshot.content); } catch { /* corrupt */ }

    const oldIds = extractImageIds(oldContent);
    const newIds = extractImageIds(newContent);
    const diff = diffImageReferences(oldIds, newIds);

    // Replace content and recalculate word count
    const newWordCount = newContent ? countWords(newContent) : 0;
    const now = new Date().toISOString();
    await txStore.updateChapter(chapter.id, {
      content: snapshot.content,
      word_count: newWordCount,
      updated_at: now,
    });
    await txStore.updateProjectTimestamp(chapter.project_id, now);

    // Adjust image reference counts
    for (const id of diff.added) {
      await txStore.incrementImageReferenceCount(id, 1);
    }
    for (const id of diff.removed) {
      await txStore.incrementImageReferenceCount(id, -1);
    }

    return { chapter_id: chapter.id };
  });

  if (!result) return null;

  // Re-read the updated chapter
  const updated = await store.findChapterById(result.chapter_id);
  if (!updated) return null;
  return { chapter: updated as unknown as Record<string, unknown> };
}
```

**Step 4: Run tests**

Run: `npm test -w packages/server -- --run -t "snapshot"`
Expected: All PASS

**Step 5: REFACTOR checklist**

- The image ref diff pattern (parse JSON → extractImageIds → diffImageReferences → increment/decrement) is duplicated from `chapters.service.ts`. Consider extracting a shared helper like `applyImageRefDiff(txStore, oldContent, newContent)` that both services can call. Only do this if the duplication is genuinely identical — if the error handling or context differs, keep them separate.
- The `restoreSnapshot` return type uses `Record<string, unknown>` — check if it should return a proper `ChapterWithLabel` enriched type for consistency with the chapters service.
- Verify that the service test fixtures follow the same patterns as `chapters.service.test.ts` for consistency.

**Step 6: Commit**

```
feat: add snapshot service with dedup guard and image ref tracking
```

---

### Task 5: Snapshot Routes

HTTP endpoints for snapshot CRUD.

**Files:**
- Create: `packages/server/src/snapshots/snapshots.routes.ts`
- Modify: `packages/server/src/app.ts` (mount routes)
- Create: `packages/server/src/__tests__/snapshots.routes.test.ts`

**Step 1: Write failing route tests**

Test cases via Supertest:
- `POST /api/chapters/:id/snapshots` — 201 with snapshot, label optional
- `POST /api/chapters/:id/snapshots` — 404 for non-existent chapter
- `POST /api/chapters/:id/snapshots` — 200 (or 204) for duplicate content (returns existing-like response)
- `GET /api/chapters/:id/snapshots` — 200 with list, no content field
- `GET /api/chapters/:id/snapshots` — 404 for non-existent chapter
- `GET /api/snapshots/:id` — 200 with full content
- `GET /api/snapshots/:id` — 404
- `DELETE /api/snapshots/:id` — 204 on success
- `DELETE /api/snapshots/:id` — 404
- `POST /api/snapshots/:id/restore` — 200, chapter content replaced, auto-snapshot created
- `POST /api/snapshots/:id/restore` — 404

**Step 2: Run tests to verify failures**

Run: `npm test -w packages/server -- --run -t "snapshot route"`
Expected: FAIL (routes don't exist)

**Step 3: Implement routes**

```ts
// packages/server/src/snapshots/snapshots.routes.ts
import { Router } from "express";
import { asyncHandler } from "../app";
import { CreateSnapshotSchema } from "@smudge/shared";
import * as SnapshotService from "./snapshots.service";

export function snapshotChapterRouter(): Router {
  const router = Router();

  // POST /api/chapters/:id/snapshots
  router.post("/:id/snapshots", asyncHandler(async (req, res) => {
    const parsed = CreateSnapshotSchema.safeParse(req.body);
    const label = parsed.success ? parsed.data.label : undefined;

    const result = await SnapshotService.createSnapshot(req.params.id, label);
    if (result === null) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Chapter not found." } });
      return;
    }
    if (result === "duplicate") {
      res.status(200).json({ message: "Snapshot skipped — content unchanged since last snapshot." });
      return;
    }
    res.status(201).json(result);
  }));

  // GET /api/chapters/:id/snapshots
  router.get("/:id/snapshots", asyncHandler(async (req, res) => {
    const result = await SnapshotService.listSnapshots(req.params.id);
    if (result === null) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Chapter not found." } });
      return;
    }
    res.json(result);
  }));

  return router;
}

export function snapshotDirectRouter(): Router {
  const router = Router();

  // GET /api/snapshots/:id
  router.get("/:id", asyncHandler(async (req, res) => {
    const snapshot = await SnapshotService.getSnapshot(req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Snapshot not found." } });
      return;
    }
    res.json(snapshot);
  }));

  // DELETE /api/snapshots/:id
  router.delete("/:id", asyncHandler(async (req, res) => {
    const deleted = await SnapshotService.deleteSnapshot(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Snapshot not found." } });
      return;
    }
    res.status(204).send();
  }));

  // POST /api/snapshots/:id/restore
  router.post("/:id/restore", asyncHandler(async (req, res) => {
    const result = await SnapshotService.restoreSnapshot(req.params.id);
    if (!result) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Snapshot or chapter not found." } });
      return;
    }
    res.json(result.chapter);
  }));

  return router;
}
```

**Step 4: Mount routes in app.ts**

Add to `packages/server/src/app.ts`:

```ts
import { snapshotChapterRouter, snapshotDirectRouter } from "./snapshots/snapshots.routes";
// ...
app.use("/api/chapters", snapshotChapterRouter());
app.use("/api/snapshots", snapshotDirectRouter());
```

**Step 5: Run tests**

Run: `npm test -w packages/server -- --run -t "snapshot"`
Expected: All PASS

**Step 6: Commit**

```
feat: add snapshot API routes
```

---

### Task 6: Cascade Snapshots on Chapter Purge

Ensure snapshots are deleted when a chapter is hard-purged (30-day trash expiry).

**Files:**
- Find and modify the purge logic (wherever hard-delete of chapters happens)
- Add test coverage

**Step 1: Find the purge code**

Search for hard-delete logic — look for `DELETE FROM chapters` or `.del()` on chapters table in the purge/cleanup code. The FK constraint with SQLite may not cascade by default — verify and add explicit snapshot cleanup.

**Step 2: Write a failing test**

Test: create a chapter, create snapshots, hard-purge the chapter → snapshots should be gone.

**Step 3: Implement cascade**

Before hard-deleting a chapter, call `store.deleteSnapshotsByChapter(chapterId)`.

**Step 4: Run tests, commit**

```
feat: cascade-delete snapshots on chapter purge
```

---

### Task 7: Ctrl/Cmd+S Interception

Intercept the browser save shortcut app-wide.

**Files:**
- Modify: `packages/client/src/hooks/useKeyboardShortcuts.ts`
- Modify: `packages/client/src/__tests__/useKeyboardShortcuts.test.ts` (or create if not exists)

**Step 1: Write a failing test**

Test: simulate Ctrl+S keydown → `preventDefault()` should be called, and a `flushSave` callback should fire.

**Step 2: Add to useKeyboardShortcuts**

In the `handleKeyDown` function, before the dialog-blocking guard, add:

```ts
if (ctrl && e.code === "KeyS") {
  e.preventDefault();
  flushSaveRef.current?.();
  return;
}
```

Add `flushSave?: () => void` to `KeyboardShortcutDeps` and wire it from `EditorPage` using the editor ref's `flushSave()`.

**Step 3: Add to shortcut help strings**

In `strings.ts`, add: `save: "Save now"` to the shortcuts section. Update the shortcut help dialog if one exists.

**Step 4: Run tests, commit**

```
feat: intercept Ctrl/Cmd+S to flush auto-save
```

---

### Task 8: Snapshot API Client

Add snapshot endpoints to the client API layer.

**Files:**
- Modify: `packages/client/src/api/client.ts`

**Step 1: Add snapshot methods to the api object**

```ts
snapshots: {
  list: (chapterId: string) =>
    apiFetch<SnapshotListItem[]>(`/chapters/${chapterId}/snapshots`),

  create: (chapterId: string, label?: string) =>
    apiFetch<SnapshotRow | { message: string }>(`/chapters/${chapterId}/snapshots`, {
      method: "POST",
      body: JSON.stringify(label ? { label } : {}),
    }),

  get: (id: string) =>
    apiFetch<SnapshotRow>(`/snapshots/${id}`),

  delete: (id: string) =>
    apiFetch<void>(`/snapshots/${id}`, { method: "DELETE" }),

  restore: (id: string) =>
    apiFetch<Chapter>(`/snapshots/${id}/restore`, { method: "POST" }),
},
```

Define `SnapshotListItem` and `SnapshotRow` types in shared package or locally in the client types.

**Step 2: Commit**

```
feat: add snapshot endpoints to API client
```

---

### Task 9: Snapshot Panel UI Component

The slide-out panel showing snapshot history with create/view/delete actions.

**Files:**
- Create: `packages/client/src/components/SnapshotPanel.tsx`
- Create: `packages/client/src/__tests__/SnapshotPanel.test.tsx`
- Modify: `packages/client/src/strings.ts` (add snapshot strings)

**Step 1: Add strings**

In `strings.ts`, add a `snapshots` namespace:

```ts
snapshots: {
  panelTitle: "Snapshots",
  createButton: "Create Snapshot",
  labelPlaceholder: "Optional label (e.g., 'before major rewrite')",
  save: "Save",
  cancel: "Cancel",
  untitled: "Untitled snapshot",
  auto: "auto",
  view: "View",
  delete: "Delete",
  deleteConfirm: "Delete this snapshot? This cannot be undone.",
  restoreButton: "Restore",
  restoreConfirm: "Replace current chapter content with this snapshot? A snapshot of your current content will be saved automatically.",
  backToEditing: "Back to editing",
  viewingBanner: (label: string, date: string) => `Viewing snapshot: ${label} — ${date}`,
  emptyState: "No snapshots yet. Create one to save a checkpoint of your work.",
  count: (manual: number, auto: number) => `${manual + auto} snapshots (${manual} manual, ${auto} auto)`,
  duplicateSkipped: "Content unchanged since last snapshot.",
},
```

**Step 2: Write failing tests**

Test cases:
- Renders empty state when no snapshots
- Renders snapshot list with labels, dates, word counts
- Auto-snapshots show "auto" tag
- "Create Snapshot" button shows inline form
- Submit creates snapshot via API
- "View" button calls onView callback
- "Delete" button shows confirmation, then calls API

**Step 3: Implement SnapshotPanel**

A panel component that:
- Accepts `chapterId`, `isOpen`, `onClose` props
- Fetches snapshots via `api.snapshots.list(chapterId)` on mount/chapterId change
- Shows snapshot count summary at top
- Has "Create Snapshot" button that expands inline form with label input
- Lists snapshots newest-first with View/Delete actions
- Delete shows confirmation dialog before calling `api.snapshots.delete(id)`
- **Escape key closes the panel** — add a `keydown` listener for Escape that calls `onClose`
- **Focus management:** when panel opens, move focus to the panel (e.g., the "Create Snapshot" button or the panel heading). When panel closes, return focus to the clock icon toolbar button that triggered it. Pass a `triggerRef` prop for focus return.

**Step 4: Run tests, commit**

```
feat: add SnapshotPanel component
```

---

### Task 10: Snapshot View Mode & Restore Flow

Wire snapshot viewing (read-only in editor area) and restore into EditorPage.

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/components/Editor.tsx` (read-only mode support)
- Modify: `packages/client/src/components/EditorToolbar.tsx` (clock icon button)
- Create: `packages/client/src/components/SnapshotBanner.tsx`
- Create: `packages/client/src/hooks/useSnapshotState.ts`

**Step 1: Create useSnapshotState hook**

Manages: panel open/closed, viewing snapshot (id + content), snapshot count for badge.

```ts
interface SnapshotState {
  panelOpen: boolean;
  togglePanel: () => void;
  viewingSnapshot: { id: string; label: string | null; content: Record<string, unknown>; created_at: string } | null;
  viewSnapshot: (id: string) => Promise<void>;
  exitSnapshotView: () => void;
  restoreSnapshot: (id: string) => Promise<boolean>;
  snapshotCount: number;
  refreshSnapshots: () => void;
}
```

**Step 2: Add clock icon to EditorToolbar**

Add a button after the existing toolbar buttons with a clock icon (use a simple SVG or unicode ⏱). Show snapshot count badge. onClick calls `togglePanel`.

**Step 3: Wire into EditorPage**

- When `viewingSnapshot` is non-null, render the editor in read-only mode with snapshot content instead of chapter content
- Show `SnapshotBanner` above the editor with snapshot label, date, Restore button, "Back to editing" button
- **Before calling `api.snapshots.restore(id)`, call `await editorRef.current.flushSave()` to ensure pending edits are saved to the server.** This is critical — the auto-snapshot of "current content" must capture the writer's latest unsaved edits, not stale server-side content. Same force-save pattern used for chapter switching.
- After restore completes, reload chapter content from server into the editor
- "Back to editing" calls `exitSnapshotView()`

**Step 4: Write tests for the integration**

Test: viewing a snapshot shows banner and read-only content; clicking "Back to editing" returns to normal editor; restore triggers API call and refreshes chapter.

**Step 5: Run tests, commit**

```
feat: wire snapshot view mode and restore into editor
```

---

### Task 11: Snapshot E2e Tests

Playwright tests for the full snapshot workflow.

**Files:**
- Create: `e2e/snapshots.spec.ts`

**Step 1: Write e2e tests**

Test scenarios:
1. Create a snapshot with label → appears in snapshot panel
2. Create a snapshot without label → shows "Untitled snapshot"
3. View a snapshot → banner appears, content is read-only
4. "Back to editing" → returns to editor
5. Restore a snapshot → chapter content changes, auto-snapshot created
6. Delete a snapshot → removed from list
7. Duplicate snapshot is skipped → message shown
8. aXe accessibility audit on snapshot panel

**Step 2: Run e2e**

Run: `make e2e`
Expected: All PASS

**Step 3: Commit**

```
test: add e2e tests for snapshot workflow
```

---

## Sub-phase 4b-ii: Find-and-Replace

### Task 12: TipTap Text Walker Utility

A shared utility that extracts plain text from TipTap JSON per block, and can apply replacements back to the node structure while preserving marks.

**Files:**
- Create: `packages/shared/src/tiptap-text.ts`
- Create: `packages/shared/src/__tests__/tiptap-text.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Step 1: Write failing tests**

Test cases for `extractBlockTexts(doc)`:
- Extracts text from a single paragraph
- Extracts text from multiple paragraphs as separate blocks
- Concatenates text nodes within a paragraph (including across marks)
- Handles headings, blockquotes, list items as separate blocks
- Returns empty array for empty doc
- Handles nested structures (blockquote containing paragraphs)

Test cases for `searchInDoc(doc, query, options)`:
- Finds literal match in single paragraph
- Finds multiple matches across chapters
- Case-insensitive search
- Whole-word search
- Regex search
- Returns match with surrounding context (~40 chars)
- Finds match that spans two text nodes with different marks (e.g., "**sud**denly" matches "suddenly")

Test cases for `replaceInDoc(doc, query, replacement, options)`:
- Replaces in single text node
- Replaces across mark boundaries (preserving marks on surrounding text)
- Replaces all occurrences
- Case-insensitive replacement
- Whole-word replacement
- Regex replacement with capture groups
- Returns unchanged doc if no matches
- Returns count of replacements made

**Step 2: Run tests to verify failures**

Run: `npm test -w packages/shared -- --run -t "tiptap-text"`
Expected: FAIL

**Step 3: Implement the utility**

Key algorithm for `replaceInDoc`:
1. For each block-level node, concatenate all text node contents into a flat string, tracking each text node's start/end offset and marks
2. Run the search/replace on the flat string
3. Re-segment the replaced string back into text nodes, preserving the original mark boundaries where possible
4. When a replacement crosses a mark boundary, the replacement text inherits the marks of the first matched text node

This is the most complex piece of the feature. Take care with:
- Empty text nodes after replacement (remove them)
- Adjacent text nodes with identical marks after replacement (merge them)
- Regex capture group expansion in the replacement string

**Step 4: Run tests**

Run: `npm test -w packages/shared -- --run -t "tiptap-text"`
Expected: All PASS

**Step 5: REFACTOR checklist**

This is the most complex utility in the feature. After GREEN, specifically check:
- Can the tree-walking logic be shared with `extractImageIds` in `images.references.ts`? Both walk TipTap JSON. If the walk patterns differ enough, don't force it — but note if a shared `walkTipTapNodes()` iterator would simplify both.
- Can the text-node flattening logic be shared with `countWords` in `packages/shared/src/wordcount.ts`? Both need to extract text from the JSON tree.
- Are the regex construction and escaping functions cleanly separated from the tree-walking logic?
- Are edge cases (empty text nodes, adjacent-same-mark merging) handled in named helper functions, not inline in the main algorithm?

**Step 6: Commit**

```
feat: add TipTap text walker with search and replace support
```

---

### Task 13: Search Service

Server-side search across all chapters in a project.

**Files:**
- Create: `packages/server/src/search/search.service.ts`
- Create: `packages/server/src/search/search.types.ts`
- Create: `packages/server/src/__tests__/search.service.test.ts`

**Step 1: Write failing tests**

Test cases:
- `searchProject` — finds matches across multiple chapters, grouped by chapter
- Returns total count and per-chapter counts
- Respects `case_sensitive` option
- Respects `whole_word` option
- Respects `regex` option
- Returns 40 chars of surrounding context per match
- Returns empty results for no matches
- Returns null for non-existent project
- Skips chapters with corrupt JSON content

**Step 2: Run tests to verify failures**

**Step 3: Implement search service**

```ts
// packages/server/src/search/search.service.ts
import { getProjectStore } from "../stores/project-store.injectable";
import { searchInDoc } from "@smudge/shared";
import type { SearchResult } from "./search.types";

export async function searchProject(
  projectId: string,
  query: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
): Promise<SearchResult | null> {
  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  const chapters = await store.listChapterContentByProject(projectId);
  const result: SearchResult = { total_count: 0, chapters: [] };

  for (const ch of chapters) {
    if (!ch.content) continue;
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(ch.content); } catch { continue; }

    const matches = searchInDoc(doc, query, options);
    if (matches.length > 0) {
      result.total_count += matches.length;
      result.chapters.push({
        chapter_id: ch.id,
        chapter_title: ch.title,
        matches,
      });
    }
  }

  return result;
}
```

**Step 4: Run tests, commit**

```
feat: add project-wide search service
```

---

### Task 14: Replace Service

Server-side replace with auto-snapshots in a transaction.

**Files:**
- Create: `packages/server/src/search/search.replace.ts` (or add to `search.service.ts`)
- Add to: `packages/server/src/__tests__/search.service.test.ts`

**Step 1: Write failing tests**

Test cases:
- `replaceInProject` — replaces across all chapters, returns count and affected IDs
- Auto-snapshots are created for every affected chapter before replacement
- Word counts are recalculated
- Image reference counts are adjusted
- Chapters with no matches are not snapshotted or modified
- Transaction is atomic — if one chapter fails, none are modified
- Scoped to single chapter when `scope.type === "chapter"`
- Returns null for non-existent project
- Returns 0 replacements when no matches
- Invalid regex returns validation error

**Step 2: Implement replace service**

```ts
export async function replaceInProject(
  projectId: string,
  search: string,
  replace: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
  scope?: { type: "project" } | { type: "chapter"; chapter_id: string },
): Promise<{ replaced_count: number; affected_chapter_ids: string[] } | null | { validationError: string }> {
  // Validate regex if enabled
  if (options?.regex) {
    try { new RegExp(search); } catch (e) {
      return { validationError: `Invalid regex: ${(e as Error).message}` };
    }
  }

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  return store.transaction(async (txStore) => {
    const chapters = scope?.type === "chapter"
      ? [await txStore.findChapterByIdRaw(scope.chapter_id)].filter(Boolean)
      : await txStore.listChapterContentByProject(projectId);

    let totalReplaced = 0;
    const affectedIds: string[] = [];

    for (const ch of chapters) {
      if (!ch.content) continue;
      let doc: Record<string, unknown>;
      try { doc = JSON.parse(ch.content); } catch { continue; }

      const { doc: newDoc, count } = replaceInDoc(doc, search, replace, options);
      if (count === 0) continue;

      // Auto-snapshot before modification
      await txStore.insertSnapshot({
        id: uuidv4(),
        chapter_id: ch.id,
        label: `Before find-and-replace: '${search}' → '${replace}'`,
        content: ch.content,
        word_count: ch.word_count,
        is_auto: true,
        created_at: new Date().toISOString(),
      });

      // Image ref diff
      const oldIds = extractImageIds(doc);
      const newIds = extractImageIds(newDoc);
      const diff = diffImageReferences(oldIds, newIds);

      const newContent = JSON.stringify(newDoc);
      const newWordCount = countWords(newDoc);
      const now = new Date().toISOString();

      await txStore.updateChapter(ch.id, {
        content: newContent,
        word_count: newWordCount,
        updated_at: now,
      });

      for (const id of diff.added) await txStore.incrementImageReferenceCount(id, 1);
      for (const id of diff.removed) await txStore.incrementImageReferenceCount(id, -1);

      totalReplaced += count;
      affectedIds.push(ch.id);
    }

    return { replaced_count: totalReplaced, affected_chapter_ids: affectedIds };
  });
}
```

**Step 3: Run tests, commit**

```
feat: add project-wide replace service with auto-snapshots
```

---

### Task 15: Search & Replace Routes

HTTP endpoints for search and replace.

**Files:**
- Create: `packages/server/src/search/search.routes.ts`
- Modify: `packages/server/src/app.ts` (mount routes)
- Create: `packages/server/src/__tests__/search.routes.test.ts`

**Step 1: Write failing route tests**

Test cases:
- `POST /api/projects/:id/search` — 200 with results
- `POST /api/projects/:id/search` — 404 for non-existent project
- `POST /api/projects/:id/search` — 400 for invalid regex
- `POST /api/projects/:id/search` — 400 for empty query
- `POST /api/projects/:id/replace` — 200 with count and affected IDs
- `POST /api/projects/:id/replace` — auto-snapshots created
- `POST /api/projects/:id/replace` — 404 for non-existent project
- `POST /api/projects/:id/replace` — 400 for invalid regex
- `POST /api/projects/:id/replace` — 400 for empty search

**Step 2: Implement routes**

```ts
// packages/server/src/search/search.routes.ts
import { Router } from "express";
import { asyncHandler } from "../app";
import { z } from "zod";
import * as SearchService from "./search.service";

const SearchSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  options: z.object({
    case_sensitive: z.boolean().optional(),
    whole_word: z.boolean().optional(),
    regex: z.boolean().optional(),
  }).optional(),
});

const ReplaceSchema = z.object({
  search: z.string().min(1, "Search term is required"),
  replace: z.string(),
  options: z.object({
    case_sensitive: z.boolean().optional(),
    whole_word: z.boolean().optional(),
    regex: z.boolean().optional(),
  }).optional(),
  scope: z.union([
    z.object({ type: z.literal("project") }),
    z.object({ type: z.literal("chapter"), chapter_id: z.string().uuid() }),
  ]).optional().default({ type: "project" }),
});

export function searchRouter(): Router {
  const router = Router();

  router.post("/:id/search", asyncHandler(async (req, res) => {
    const parsed = SearchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }
    const result = await SearchService.searchProject(req.params.id, parsed.data.query, parsed.data.options);
    if (result === null) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
      return;
    }
    res.json(result);
  }));

  router.post("/:id/replace", asyncHandler(async (req, res) => {
    const parsed = ReplaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }
    const result = await SearchService.replaceInProject(
      req.params.id, parsed.data.search, parsed.data.replace, parsed.data.options, parsed.data.scope,
    );
    if (result === null) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
      return;
    }
    if ("validationError" in result) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: result.validationError } });
      return;
    }
    res.json(result);
  }));

  return router;
}
```

Mount in `app.ts`: `app.use("/api/projects", searchRouter());`

**Step 3: Run tests, commit**

```
feat: add search and replace API routes
```

---

### Task 16: Search & Replace API Client

Add search/replace endpoints to the client API layer.

**Files:**
- Modify: `packages/client/src/api/client.ts`

**Step 1: Add search methods**

```ts
search: {
  find: (projectId: string, query: string, options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean }) =>
    apiFetch<SearchResult>(`/projects/${projectId}/search`, {
      method: "POST",
      body: JSON.stringify({ query, options }),
    }),

  replace: (projectId: string, search: string, replace: string, options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean }, scope?: { type: "project" } | { type: "chapter"; chapter_id: string }) =>
    apiFetch<{ replaced_count: number; affected_chapter_ids: string[] }>(`/projects/${projectId}/replace`, {
      method: "POST",
      body: JSON.stringify({ search, replace, options, scope }),
    }),
},
```

**Step 2: Commit**

```
feat: add search/replace endpoints to API client
```

---

### Task 17: Find-and-Replace Panel UI

The slide-out panel with search input, replace input, option toggles, and results.

**Files:**
- Create: `packages/client/src/components/FindReplacePanel.tsx`
- Create: `packages/client/src/__tests__/FindReplacePanel.test.tsx`
- Create: `packages/client/src/hooks/useFindReplaceState.ts`
- Modify: `packages/client/src/strings.ts` (add find-replace strings)

**Step 1: Add strings**

```ts
findReplace: {
  panelTitle: "Find and Replace",
  searchPlaceholder: "Search...",
  replacePlaceholder: "Replace with...",
  matchCase: "Match case",
  wholeWord: "Whole word",
  regex: "Regular expression",
  noMatches: "No matches found",
  matchCount: (count: number, chapters: number) =>
    `Found ${count} occurrence${count === 1 ? "" : "s"} in ${chapters} chapter${chapters === 1 ? "" : "s"}`,
  replaceOne: "Replace",
  replaceAllInChapter: "Replace All in Chapter",
  replaceAllInManuscript: "Replace All in Manuscript",
  replaceConfirm: (count: number, search: string, replace: string, chapters: number) =>
    `Replace ${count} occurrence${count === 1 ? "" : "s"} of '${search}' with '${replace}' across ${chapters} chapter${chapters === 1 ? "" : "s"}? Snapshots of all affected chapters will be created automatically.`,
  matchNotFound: "Match no longer found — try searching again.",
  invalidRegex: "Invalid regular expression",
  chapterMatches: (title: string, count: number) => `${title} (${count} match${count === 1 ? "" : "es"})`,
},
```

**Step 2: Create useFindReplaceState hook**

Manages: panel visibility, search query, replace string, options (case_sensitive, whole_word, regex), search results, loading state.

**Step 3: Write failing tests**

Test cases:
- Renders search and replace inputs
- Option toggles show aria-pressed state
- Typing in search triggers debounced search
- Results grouped by chapter with match counts
- "Replace All in Manuscript" shows confirmation dialog
- "Replace" on single match calls onReplaceOne callback
- Invalid regex shows error message
- Empty results show "No matches found"

**Step 4: Implement FindReplacePanel**

Component structure:
- Search input (autofocus)
- Replace input
- Option toggle buttons (Aa, ab|, .*)
- Results summary (aria-live="polite")
- Results list grouped by chapter, with per-chapter "Replace All in Chapter" button
- Footer with "Replace All in Manuscript" button
- **Escape key closes the panel** — add a `keydown` listener for Escape that calls `onClose`
- **Focus management:** when panel opens, move focus to the search input. When panel closes, return focus to the magnifying glass toolbar button (or Ctrl+H trigger). Pass a `triggerRef` prop for focus return.

**Step 5: Run tests, commit**

```
feat: add FindReplacePanel component
```

---

### Task 18: Wire Find-and-Replace into EditorPage

Connect the panel to the editor with keyboard shortcuts and replace-one logic.

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/hooks/useKeyboardShortcuts.ts` (add Ctrl+H)

**Step 1: Add Ctrl/Cmd+H shortcut**

In `useKeyboardShortcuts`, add handler for `ctrl && e.code === "KeyH"` that calls `toggleFindReplace()`. Add `toggleFindReplace` to the deps interface.

**Step 2: Add magnifying glass icon to EditorToolbar**

Add a magnifying glass icon button to `EditorToolbar.tsx` (same pattern as the clock icon for snapshots). onClick calls `toggleFindReplace`. Provides an alternative entry point to Ctrl/Cmd+H.

**Step 3: Wire into EditorPage**

- Add `useFindReplaceState` hook
- Render `FindReplacePanel` in the right-side panel area (same position as snapshot panel / reference panel — these should be mutually exclusive or tabbed)
- **Replace All in Manuscript flow:**
  1. Call `await editorRef.current.flushSave()` to ensure pending edits are saved to the server
  2. Call `api.search.replace(projectId, search, replace, options, { type: "project" })`
  3. If the currently open chapter is in `affected_chapter_ids`, reload its content from the server into the editor
  4. Re-run search to refresh results (should show zero matches)
- **Replace All in Chapter flow:** Same as manuscript but with `scope: { type: "chapter", chapter_id }`. Also requires force-save first, confirmation dialog, and editor reload if current chapter affected.
- **Replace One flow:** Locate the match in the live editor content using the search term and surrounding context (not stored offsets). Apply replacement via TipTap's API. If the match can't be found (content drifted), show "Match no longer found — try searching again." Trigger auto-save after replacement. Re-run search to refresh results.
- After any replace operation, re-run search to refresh results

**Step 4: Handle panel exclusivity**

When find-replace panel opens, close snapshot panel and reference panel (or use a panel state machine). Ctrl+H toggles find-replace; clock icon toggles snapshots; Ctrl+. toggles reference panel.

**Step 5: Write integration tests, run, commit**

```
feat: wire find-and-replace panel into editor with Ctrl+H shortcut
```

---

### Task 19: Find-and-Replace E2e Tests

**Files:**
- Create: `e2e/find-replace.spec.ts`

**Step 1: Write e2e tests**

Test scenarios:
1. Ctrl+H opens find-and-replace panel
2. Search finds matches across chapters, displays results grouped by chapter
3. "Replace All in Manuscript" replaces all, auto-snapshots created
4. After replace-all, editor content reflects changes
5. Replace-one replaces a single match
6. Match case, whole word toggles work
7. Regex search/replace works
8. Invalid regex shows error
9. No matches shows empty state
10. aXe accessibility audit on panel

**Step 2: Run e2e**

Run: `make e2e`
Expected: All PASS

**Step 3: Commit**

```
test: add e2e tests for find-and-replace workflow
```

---

### Task 20: Coverage & Cleanup

Final pass to ensure coverage thresholds are met and everything is clean.

**Files:** Various

**Step 1: Run full CI pass**

Run: `make all`

This runs lint, format, typecheck, coverage, and e2e. Fix any issues.

**Step 2: Check coverage**

Run: `make cover`

Ensure 95% statements, 85% branches, 90% functions, 95% lines are met. Add tests for any uncovered paths.

**Step 3: Verify zero test warnings**

Check test output for any noisy console.warn/console.error. Add spies to suppress expected warnings and assert on them.

**Step 4: Commit any final fixes**

```
chore: coverage and cleanup for Phase 4b
```

---

## Task Summary

| # | Task | Sub-phase | Key Files |
|---|------|-----------|-----------|
| 1 | Database migration | 4b-i | `migrations/014_create_chapter_snapshots.js` |
| 2 | Snapshot types & schema | 4b-i | `snapshots/snapshots.types.ts`, `shared/schemas.ts` |
| 3 | Store interface & implementation | 4b-i | `project-store.types.ts`, `snapshots.repository.ts` |
| 4 | Snapshot service | 4b-i | `snapshots/snapshots.service.ts` |
| 5 | Snapshot routes | 4b-i | `snapshots/snapshots.routes.ts`, `app.ts` |
| 6 | Cascade on chapter purge | 4b-i | Purge logic |
| 7 | Ctrl/Cmd+S interception | 4b-i | `useKeyboardShortcuts.ts` |
| 8 | Snapshot API client | 4b-i | `api/client.ts` |
| 9 | Snapshot panel UI | 4b-i | `SnapshotPanel.tsx` |
| 10 | Snapshot view mode & restore | 4b-i | `EditorPage.tsx`, `SnapshotBanner.tsx` |
| 11 | Snapshot e2e tests | 4b-i | `e2e/snapshots.spec.ts` |
| 12 | TipTap text walker utility | 4b-ii | `shared/tiptap-text.ts` |
| 13 | Search service | 4b-ii | `search/search.service.ts` |
| 14 | Replace service | 4b-ii | `search/search.replace.ts` |
| 15 | Search & replace routes | 4b-ii | `search/search.routes.ts`, `app.ts` |
| 16 | Search & replace API client | 4b-ii | `api/client.ts` |
| 17 | Find-replace panel UI | 4b-ii | `FindReplacePanel.tsx` |
| 18 | Wire into EditorPage | 4b-ii | `EditorPage.tsx`, `useKeyboardShortcuts.ts` |
| 19 | Find-replace e2e tests | 4b-ii | `e2e/find-replace.spec.ts` |
| 20 | Coverage & cleanup | Both | Various |
