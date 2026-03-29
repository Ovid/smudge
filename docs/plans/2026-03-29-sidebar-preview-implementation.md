# Sidebar + Chapter Management & Preview Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collapsible sidebar with chapter management (reorder, delete, trash/restore), and a full-manuscript preview mode with TOC panel.

**Architecture:** Two workstreams built on top of existing EditorPage. Sidebar comes first (establishes chapter list data flow), then preview mode (renders all chapters as HTML). EditorPage's state is extracted into `useProjectEditor` hook first to keep complexity manageable. Four new server routes are added for soft-delete, reorder, trash listing, and restore.

**Tech Stack:** @dnd-kit/sortable v10 (drag-and-drop), @tiptap/html (generateHTML for preview), React 19, TipTap v2, Tailwind CSS, Express 4, better-sqlite3, Vitest + Supertest

---

## Phase 1: Server Routes + Prerequisites

### Task 1: Install new dependencies

**Files:**
- Modify: `packages/client/package.json`

**Step 1: Install @dnd-kit/sortable and @tiptap/html**

```bash
npm install @dnd-kit/sortable@^10 --workspace=packages/client
npm install @tiptap/html --workspace=packages/client
```

Note: `@dnd-kit/sortable` v10 is the legacy stable version. `@tiptap/html` is needed for `generateHTML()` in preview mode.

**Step 2: Verify install**

```bash
npm ls @dnd-kit/sortable @tiptap/html
```

Expected: Both packages listed under packages/client.

**Step 3: Commit**

```bash
git add packages/client/package.json package-lock.json
git commit -m "chore: install @dnd-kit/sortable v10 and @tiptap/html"
```

---

### Task 1a: Fix DELETE /api/projects/:id to cascade soft-delete to chapters

**Files:**
- Modify: `packages/server/src/routes/projects.ts`
- Test: `packages/server/src/__tests__/projects.test.ts`

The MVP requires project deletion to soft-delete all its chapters too. The existing route only sets `deleted_at` on the project, leaving chapters orphaned.

**Step 1: Write failing test**

Add to `packages/server/src/__tests__/projects.test.ts` in the existing `DELETE /api/projects/:id` describe block:

```typescript
it("soft-deletes all chapters when project is deleted", async () => {
  const projectRes = await request(t.app)
    .post("/api/projects")
    .send({ title: "Test", mode: "fiction" });
  const projectId = projectRes.body.id;

  // Create an extra chapter
  await request(t.app).post(`/api/projects/${projectId}/chapters`);

  await request(t.app).delete(`/api/projects/${projectId}`);

  // Directly query — chapters should all have deleted_at set
  const chapters = await t.db("chapters").where({ project_id: projectId });
  expect(chapters.every((c: { deleted_at: string | null }) => c.deleted_at !== null)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -w packages/server -- --run
```

**Step 3: Fix the route**

In `packages/server/src/routes/projects.ts`, in the `router.delete("/:id", ...)` handler, add chapter soft-delete before the project soft-delete:

```typescript
const now = new Date().toISOString();

// Soft-delete all chapters belonging to this project
await db("chapters")
  .where({ project_id: req.params.id })
  .whereNull("deleted_at")
  .update({ deleted_at: now });

await db("projects").where({ id: req.params.id }).update({ deleted_at: now });
```

**Step 4: Run tests**

```bash
npm test -w packages/server -- --run
```

**Step 5: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/projects.test.ts
git commit -m "fix: cascade soft-delete to chapters when deleting a project"
```

---

### Task 2: DELETE /api/chapters/:id (soft delete)

**Files:**
- Modify: `packages/server/src/routes/chapters.ts`
- Test: `packages/server/src/__tests__/chapters.test.ts`

**Step 1: Write failing tests**

Add to `packages/server/src/__tests__/chapters.test.ts`:

```typescript
describe("DELETE /api/chapters/:id", () => {
  it("soft-deletes a chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).delete(`/api/chapters/${chapterId}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Chapter moved to trash.");
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).delete("/api/chapters/nonexistent-id");

    expect(res.status).toBe(404);
  });

  it("returns 404 for already-deleted chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).delete(`/api/chapters/${chapterId}`);

    expect(res.status).toBe(404);
  });

  it("chapter no longer appears in project chapters after delete", async () => {
    const { projectId, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const projectRes = await request(t.app).get(`/api/projects/${projectId}`);

    expect(projectRes.body.chapters).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run
```

Expected: 4 FAIL — route not implemented.

**Step 3: Implement the route**

In `packages/server/src/routes/chapters.ts`, add after the existing `patch` handler:

```typescript
router.delete("/:id", async (req, res) => {
  const chapter = await db("chapters")
    .where({ id: req.params.id })
    .whereNull("deleted_at")
    .first();

  if (!chapter) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Chapter not found." },
    });
    return;
  }

  const now = new Date().toISOString();
  await db("chapters").where({ id: req.params.id }).update({ deleted_at: now });

  res.json({ message: "Chapter moved to trash." });
});
```

**Step 4: Run tests to verify they pass**

```bash
npm test -w packages/server -- --run
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/chapters.ts packages/server/src/__tests__/chapters.test.ts
git commit -m "feat: add DELETE /api/chapters/:id for soft delete"
```

---

### Task 3: PUT /api/projects/:id/chapters/order (reorder)

**Files:**
- Modify: `packages/server/src/routes/projects.ts`
- Test: `packages/server/src/__tests__/projects.test.ts`

**Step 1: Write failing tests**

Add to `packages/server/src/__tests__/projects.test.ts` (use the existing `createProject` helper pattern):

```typescript
describe("PUT /api/projects/:id/chapters/order", () => {
  it("reorders chapters by provided ID array", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectId = projectRes.body.id;

    // Create 2 more chapters (auto-created one is at sort_order 0)
    const ch2 = await request(t.app).post(`/api/projects/${projectId}/chapters`);
    const ch3 = await request(t.app).post(`/api/projects/${projectId}/chapters`);

    const getRes = await request(t.app).get(`/api/projects/${projectId}`);
    const [ch1Id, ch2Id, ch3Id] = getRes.body.chapters.map(
      (c: { id: string }) => c.id,
    );

    // Reverse the order
    const res = await request(t.app)
      .put(`/api/projects/${projectId}/chapters/order`)
      .send({ chapter_ids: [ch3Id, ch2Id, ch1Id] });

    expect(res.status).toBe(200);

    const updated = await request(t.app).get(`/api/projects/${projectId}`);
    expect(updated.body.chapters.map((c: { id: string }) => c.id)).toEqual([
      ch3Id,
      ch2Id,
      ch1Id,
    ]);
  });

  it("returns 400 if chapter IDs don't match", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectId = projectRes.body.id;

    const res = await request(t.app)
      .put(`/api/projects/${projectId}/chapters/order`)
      .send({ chapter_ids: ["wrong-id"] });

    expect(res.status).toBe(400);
  });

  it("returns 400 if chapter_ids is missing or not an array", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectId = projectRes.body.id;

    const res = await request(t.app)
      .put(`/api/projects/${projectId}/chapters/order`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app)
      .put("/api/projects/nonexistent-id/chapters/order")
      .send({ chapter_ids: [] });

    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run
```

**Step 3: Implement the route**

In `packages/server/src/routes/projects.ts`, add before the `delete` handler (route order matters — `/:id/chapters/order` must come before `/:id`):

```typescript
router.put("/:id/chapters/order", async (req, res) => {
  const project = await db("projects")
    .where({ id: req.params.id })
    .whereNull("deleted_at")
    .first();

  if (!project) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Project not found." },
    });
    return;
  }

  const { chapter_ids } = req.body as { chapter_ids?: string[] };
  if (!Array.isArray(chapter_ids)) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "chapter_ids must be an array." },
    });
    return;
  }

  const existing = await db("chapters")
    .where({ project_id: req.params.id })
    .whereNull("deleted_at")
    .select("id");
  const existingIds = existing.map((c: { id: string }) => c.id).sort();
  const providedIds = [...chapter_ids].sort();

  if (
    existingIds.length !== providedIds.length ||
    !existingIds.every((id: string, i: number) => id === providedIds[i])
  ) {
    res.status(400).json({
      error: {
        code: "REORDER_MISMATCH",
        message: "Provided chapter IDs do not match existing chapters.",
      },
    });
    return;
  }

  for (let i = 0; i < chapter_ids.length; i++) {
    await db("chapters").where({ id: chapter_ids[i] }).update({ sort_order: i });
  }

  res.json({ message: "Chapter order updated." });
});
```

**Step 4: Run tests**

```bash
npm test -w packages/server -- --run
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/projects.test.ts
git commit -m "feat: add PUT /api/projects/:id/chapters/order for reordering"
```

---

### Task 4: GET /api/projects/:id/trash (list trashed chapters)

**Files:**
- Modify: `packages/server/src/routes/projects.ts`
- Test: `packages/server/src/__tests__/projects.test.ts`

**Step 1: Write failing tests**

```typescript
describe("GET /api/projects/:id/trash", () => {
  it("returns soft-deleted chapters for a project", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectId = projectRes.body.id;

    const getRes = await request(t.app).get(`/api/projects/${projectId}`);
    const chapterId = getRes.body.chapters[0].id;

    // Delete the chapter
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).get(`/api/projects/${projectId}/trash`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(chapterId);
    expect(res.body[0].deleted_at).toBeTruthy();
  });

  it("returns empty array when no trashed chapters", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectId = projectRes.body.id;

    const res = await request(t.app).get(`/api/projects/${projectId}/trash`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent-id/trash");

    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run
```

**Step 3: Implement the route**

In `packages/server/src/routes/projects.ts`, add after the chapters/order route (before `delete`):

```typescript
router.get("/:id/trash", async (req, res) => {
  const project = await db("projects")
    .where({ id: req.params.id })
    .first();

  if (!project) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Project not found." },
    });
    return;
  }

  const trashed = await db("chapters")
    .where({ project_id: req.params.id })
    .whereNotNull("deleted_at")
    .orderBy("deleted_at", "desc")
    .select("*");

  res.json(trashed);
});
```

Note: The project lookup does NOT filter by `deleted_at IS NULL` — you should be able to view trash even for a deleted project (needed for restore flow).

**Step 4: Run tests**

```bash
npm test -w packages/server -- --run
```

**Step 5: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/projects.test.ts
git commit -m "feat: add GET /api/projects/:id/trash for listing trashed chapters"
```

---

### Task 5: POST /api/chapters/:id/restore (restore from trash)

**Files:**
- Modify: `packages/server/src/routes/chapters.ts`
- Test: `packages/server/src/__tests__/chapters.test.ts`

**Step 1: Write failing tests**

```typescript
describe("POST /api/chapters/:id/restore", () => {
  it("restores a soft-deleted chapter", async () => {
    const { projectId, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.deleted_at).toBeNull();

    // Chapter should appear in project again
    const projectRes = await request(t.app).get(`/api/projects/${projectId}`);
    expect(projectRes.body.chapters).toHaveLength(1);
  });

  it("also restores parent project if it was deleted", async () => {
    const { projectId, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);
    await request(t.app).delete(`/api/projects/${projectId}`);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(200);

    // Project should be accessible again
    const projectRes = await request(t.app).get(`/api/projects/${projectId}`);
    expect(projectRes.status).toBe(200);
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).post("/api/chapters/nonexistent-id/restore");

    expect(res.status).toBe(404);
  });

  it("returns 404 for a chapter that is not deleted", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run
```

**Step 3: Implement the route**

In `packages/server/src/routes/chapters.ts`, add before the `return router;`:

```typescript
router.post("/:id/restore", async (req, res) => {
  const chapter = await db("chapters")
    .where({ id: req.params.id })
    .whereNotNull("deleted_at")
    .first();

  if (!chapter) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Deleted chapter not found." },
    });
    return;
  }

  // Restore the chapter
  await db("chapters")
    .where({ id: req.params.id })
    .update({ deleted_at: null });

  // Also restore parent project if it was deleted
  await db("projects")
    .where({ id: chapter.project_id })
    .whereNotNull("deleted_at")
    .update({ deleted_at: null });

  const restored = await db("chapters").where({ id: req.params.id }).first();
  res.json(parseChapterContent(restored));
});
```

**Step 4: Run tests**

```bash
npm test -w packages/server -- --run
```

**Step 5: Commit**

```bash
git add packages/server/src/routes/chapters.ts packages/server/src/__tests__/chapters.test.ts
git commit -m "feat: add POST /api/chapters/:id/restore for trash recovery"
```

---

### Task 6: Auto-purge on server startup

**Files:**
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/db/purge.ts`
- Test: `packages/server/src/__tests__/purge.test.ts`

**Step 1: Write failing tests**

Create `packages/server/src/__tests__/purge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import knex from "knex";
import { createTestKnexConfig } from "../db/knexfile";
import { purgeOldTrash } from "../db/purge";

describe("purgeOldTrash", () => {
  it("deletes chapters trashed more than 30 days ago", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p1",
      title: "Test",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    await db("chapters").insert({
      id: "ch-old",
      project_id: "p1",
      title: "Old",
      sort_order: 0,
      word_count: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });
    await db("chapters").insert({
      id: "ch-recent",
      project_id: "p1",
      title: "Recent",
      sort_order: 1,
      word_count: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: recent,
    });

    const count = await purgeOldTrash(db);

    expect(count.chapters).toBe(1);
    const remaining = await db("chapters").select("id");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("ch-recent");

    await db.destroy();
  });

  it("deletes projects trashed more than 30 days ago", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p-old",
      title: "Old Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });

    const count = await purgeOldTrash(db);

    expect(count.projects).toBe(1);
    const remaining = await db("projects").select("id");
    expect(remaining).toHaveLength(0);

    await db.destroy();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run
```

**Step 3: Implement purge module**

Create `packages/server/src/db/purge.ts`:

```typescript
import type { Knex } from "knex";

export async function purgeOldTrash(db: Knex): Promise<{ chapters: number; projects: number }> {
  const chapters = await db("chapters")
    .where("deleted_at", "<", db.raw("datetime('now', '-30 days')"))
    .delete();

  const projects = await db("projects")
    .where("deleted_at", "<", db.raw("datetime('now', '-30 days')"))
    .delete();

  return { chapters, projects };
}
```

**Step 4: Run tests**

```bash
npm test -w packages/server -- --run
```

**Step 5: Wire into server startup**

In `packages/server/src/index.ts`, after `const db = await initDb(...)`:

```typescript
import { purgeOldTrash } from "./db/purge";

// ... inside main(), after initDb:
const purged = await purgeOldTrash(db);
if (purged.chapters > 0 || purged.projects > 0) {
  console.log(`Purged ${purged.chapters} chapter(s) and ${purged.projects} project(s) from trash.`);
}
```

**Step 6: Run all server tests**

```bash
npm test -w packages/server -- --run
```

**Step 7: Commit**

```bash
git add packages/server/src/db/purge.ts packages/server/src/__tests__/purge.test.ts packages/server/src/index.ts
git commit -m "feat: auto-purge trash items older than 30 days on server startup"
```

---

### Task 7: API client methods for new routes

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Test: `packages/client/src/__tests__/api-client.test.ts`

**Step 1: Write failing tests**

Add to `packages/client/src/__tests__/api-client.test.ts`:

```typescript
describe("api.chapters", () => {
  // ... existing tests ...

  it("delete(id) sends DELETE /api/chapters/:id", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "Chapter moved to trash." }));

    await api.chapters.delete("ch1");
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch1", {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
  });

  it("restore(id) sends POST /api/chapters/:id/restore", async () => {
    const chapter = { id: "ch1", title: "Restored" };
    mockFetch.mockResolvedValue(jsonResponse(chapter));

    const result = await api.chapters.restore("ch1");
    expect(result).toEqual(chapter);
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch1/restore", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });
});

describe("api.projects", () => {
  // ... existing tests ...

  it("reorderChapters sends PUT /api/projects/:id/chapters/order", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "ok" }));

    await api.projects.reorderChapters("p1", ["ch3", "ch1", "ch2"]);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/chapters/order", {
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      body: JSON.stringify({ chapter_ids: ["ch3", "ch1", "ch2"] }),
    });
  });

  it("trash(id) fetches GET /api/projects/:id/trash", async () => {
    const trashed = [{ id: "ch1", title: "Deleted", deleted_at: "2026-01-01" }];
    mockFetch.mockResolvedValue(jsonResponse(trashed));

    const result = await api.projects.trash("p1");
    expect(result).toEqual(trashed);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/trash", {
      headers: { "Content-Type": "application/json" },
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/client -- --run
```

**Step 3: Implement API client methods**

In `packages/client/src/api/client.ts`:

Add to the `projects` object:

```typescript
reorderChapters: (projectId: string, chapterIds: string[]) =>
  apiFetch<{ message: string }>(`/projects/${projectId}/chapters/order`, {
    method: "PUT",
    body: JSON.stringify({ chapter_ids: chapterIds }),
  }),

trash: (projectId: string) =>
  apiFetch<Chapter[]>(`/projects/${projectId}/trash`),
```

Add to the `chapters` object:

```typescript
delete: (id: string) =>
  apiFetch<{ message: string }>(`/chapters/${id}`, { method: "DELETE" }),

restore: (id: string) =>
  apiFetch<Chapter>(`/chapters/${id}/restore`, { method: "POST" }),
```

**Step 4: Run tests**

```bash
npm test -w packages/client -- --run
```

**Step 5: Commit**

```bash
git add packages/client/src/api/client.ts packages/client/src/__tests__/api-client.test.ts
git commit -m "feat: add API client methods for chapter delete, restore, reorder, and trash"
```

---

## Phase 2: Sidebar + Chapter Management

### Task 8: Extract useProjectEditor hook from EditorPage

This is the most critical refactoring step. It moves all state management out of EditorPage into a testable hook, making subsequent sidebar/preview work cleaner.

**Files:**
- Create: `packages/client/src/hooks/useProjectEditor.ts`
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Create: `packages/client/src/__tests__/useProjectEditor.test.ts`

**Step 1: Write failing tests for the hook**

Create `packages/client/src/__tests__/useProjectEditor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../api/client", () => ({
  api: {
    projects: {
      get: vi.fn(),
      update: vi.fn(),
      reorderChapters: vi.fn(),
      trash: vi.fn(),
    },
    chapters: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      restore: vi.fn(),
    },
  },
}));

import { api } from "../api/client";
import { useProjectEditor } from "../hooks/useProjectEditor";

const mockProject = {
  id: "p1",
  title: "Test Project",
  mode: "fiction" as const,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
  chapters: [
    {
      id: "ch1",
      project_id: "p1",
      title: "Chapter 1",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 0,
      word_count: 0,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.projects.get).mockResolvedValue(mockProject);
  vi.mocked(api.chapters.get).mockResolvedValue(mockProject.chapters[0]);
});

describe("useProjectEditor", () => {
  it("loads project and first chapter on mount", async () => {
    const { result } = renderHook(() => useProjectEditor("p1"));

    await waitFor(() => {
      expect(result.current.project).toEqual(mockProject);
      expect(result.current.activeChapter).toEqual(mockProject.chapters[0]);
    });
  });

  it("creates a new chapter", async () => {
    const newChapter = {
      id: "ch2",
      project_id: "p1",
      title: "Untitled Chapter",
      content: null,
      sort_order: 1,
      word_count: 0,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    vi.mocked(api.chapters.create).mockResolvedValue(newChapter);

    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(result.current.activeChapter).toEqual(newChapter);
    expect(result.current.project!.chapters).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/client -- --run
```

**Step 3: Create the hook**

Create `packages/client/src/hooks/useProjectEditor.ts`:

```typescript
import { useEffect, useState, useCallback, useRef } from "react";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { countWords } from "@smudge/shared";
import { api } from "../api/client";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useProjectEditor(projectId: string | undefined) {
  const [project, setProject] = useState<ProjectWithChapters | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [chapterWordCount, setChapterWordCount] = useState(0);
  const activeChapterRef = useRef<Chapter | null>(null);

  // Keep ref in sync for use in loadProject's closure
  useEffect(() => {
    activeChapterRef.current = activeChapter;
  }, [activeChapter]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      if (!projectId) return;
      const data = await api.projects.get(projectId);
      if (cancelled) return;
      setProject(data);
      const firstChapter = data.chapters[0];
      if (firstChapter && !activeChapterRef.current) {
        const chapter = await api.chapters.get(firstChapter.id);
        if (cancelled) return;
        setActiveChapter(chapter);
        setChapterWordCount(countWords(chapter.content));
      }
    }

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleSave = useCallback(
    async (content: Record<string, unknown>) => {
      if (!activeChapter) return;

      setSaveStatus("saving");
      try {
        const updated = await api.chapters.update(activeChapter.id, { content });
        setActiveChapter(updated);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [activeChapter],
  );

  const handleContentChange = useCallback((content: Record<string, unknown>) => {
    setChapterWordCount(countWords(content));
  }, []);

  const handleCreateChapter = useCallback(async () => {
    if (!projectId) return;
    const newChapter = await api.chapters.create(projectId);
    setActiveChapter(newChapter);
    setChapterWordCount(0);
    setProject((prev) => (prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev));
  }, [projectId]);

  const handleSelectChapter = useCallback(
    async (chapterId: string) => {
      if (!activeChapter || chapterId === activeChapter.id) return;
      const chapter = await api.chapters.get(chapterId);
      setActiveChapter(chapter);
      setChapterWordCount(countWords(chapter.content));
    },
    [activeChapter],
  );

  const handleDeleteChapter = useCallback(
    async (chapter: Chapter) => {
      await api.chapters.delete(chapter.id);
      setProject((prev) => {
        if (!prev) return prev;
        const remaining = prev.chapters.filter((c) => c.id !== chapter.id);
        return { ...prev, chapters: remaining };
      });

      // If deleting the active chapter, switch to the first remaining
      if (activeChapter?.id === chapter.id) {
        setProject((prev) => {
          if (!prev) return prev;
          const first = prev.chapters[0];
          if (first) {
            api.chapters.get(first.id).then((ch) => {
              setActiveChapter(ch);
              setChapterWordCount(countWords(ch.content));
            });
          } else {
            setActiveChapter(null);
            setChapterWordCount(0);
          }
          return prev;
        });
      }
    },
    [activeChapter],
  );

  const handleReorderChapters = useCallback(
    async (orderedIds: string[]) => {
      if (!projectId) return;
      await api.projects.reorderChapters(projectId, orderedIds);
      setProject((prev) => {
        if (!prev) return prev;
        const reordered = orderedIds
          .map((id) => prev.chapters.find((c) => c.id === id))
          .filter(Boolean) as Chapter[];
        return { ...prev, chapters: reordered };
      });
    },
    [projectId],
  );

  const handleUpdateProjectTitle = useCallback(
    async (title: string) => {
      if (!project) return;
      await api.projects.update(project.id, { title });
      setProject((prev) => (prev ? { ...prev, title } : prev));
    },
    [project],
  );

  const handleUpdateChapterTitle = useCallback(
    async (title: string) => {
      if (!activeChapter) return;
      const updated = await api.chapters.update(activeChapter.id, { title });
      setActiveChapter(updated);
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chapters: prev.chapters.map((c) => (c.id === updated.id ? { ...c, title } : c)),
        };
      });
    },
    [activeChapter],
  );

  const handleRenameChapter = useCallback(
    async (chapterId: string, title: string) => {
      const updated = await api.chapters.update(chapterId, { title });
      if (activeChapter?.id === chapterId) {
        setActiveChapter(updated);
      }
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, title } : c)),
        };
      });
    },
    [activeChapter],
  );

  return {
    project,
    activeChapter,
    saveStatus,
    chapterWordCount,
    handleSave,
    handleContentChange,
    handleCreateChapter,
    handleSelectChapter,
    handleDeleteChapter,
    handleReorderChapters,
    handleUpdateProjectTitle,
    handleUpdateChapterTitle,
    handleRenameChapter,
  };
}
```

**Step 4: Run tests**

```bash
npm test -w packages/client -- --run
```

**Step 5: Rewrite EditorPage to use the hook**

Replace the state management in `packages/client/src/pages/EditorPage.tsx` — remove all the `useState`/`useCallback` for project/chapter state, replace with `useProjectEditor`. Keep the keyboard shortcut logic and title editing UI logic in the component. The EditorPage should become a thin layout shell.

The full rewrite of EditorPage.tsx:

```typescript
import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Editor } from "../components/Editor";
import { STRINGS } from "../strings";
import { useProjectEditor } from "../hooks/useProjectEditor";

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const {
    project,
    activeChapter,
    saveStatus,
    chapterWordCount,
    handleSave,
    handleContentChange,
    handleCreateChapter,
    handleSelectChapter,
    handleDeleteChapter,
    handleReorderChapters,
    handleUpdateProjectTitle,
    handleUpdateChapterTitle,
    handleRenameChapter,
  } = useProjectEditor(projectId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const projectEscapePressedRef = useRef(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "/") {
        e.preventDefault();
        setShortcutHelpOpen((prev) => !prev);
        return;
      }

      if (ctrl && e.shiftKey && e.key === "N") {
        e.preventDefault();
        handleCreateChapter();
        return;
      }

      if (shortcutHelpOpen && e.key === "Escape") {
        e.preventDefault();
        setShortcutHelpOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateChapter, shortcutHelpOpen]);

  function startEditingTitle() {
    if (!activeChapter) return;
    escapePressedRef.current = false;
    setTitleDraft(activeChapter.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }

  async function saveTitle() {
    if (escapePressedRef.current) {
      setEditingTitle(false);
      return;
    }
    if (!activeChapter || !titleDraft.trim()) {
      setEditingTitle(false);
      return;
    }
    const trimmed = titleDraft.trim();
    if (trimmed !== activeChapter.title) {
      await handleUpdateChapterTitle(trimmed);
    }
    setEditingTitle(false);
  }

  function startEditingProjectTitle() {
    if (!project) return;
    projectEscapePressedRef.current = false;
    setProjectTitleDraft(project.title);
    setEditingProjectTitle(true);
    setTimeout(() => projectTitleInputRef.current?.select(), 0);
  }

  async function saveProjectTitle() {
    if (projectEscapePressedRef.current) {
      setEditingProjectTitle(false);
      return;
    }
    if (!project || !projectTitleDraft.trim()) {
      setEditingProjectTitle(false);
      return;
    }
    const trimmed = projectTitleDraft.trim();
    if (trimmed !== project.title) {
      await handleUpdateProjectTitle(trimmed);
    }
    setEditingProjectTitle(false);
  }

  if (!project || !activeChapter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
          >
            &larr; Projects
          </button>
          {editingProjectTitle ? (
            <input
              ref={projectTitleInputRef}
              value={projectTitleDraft}
              onChange={(e) => setProjectTitleDraft(e.target.value)}
              onBlur={saveProjectTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveProjectTitle();
                if (e.key === "Escape") {
                  projectEscapePressedRef.current = true;
                  setEditingProjectTitle(false);
                }
              }}
              className="text-lg font-semibold text-text-primary bg-transparent border-b-2 border-accent focus:outline-none"
              aria-label="Project title"
            />
          ) : (
            <h1
              className="text-lg font-semibold text-text-primary cursor-pointer hover:text-text-secondary"
              onDoubleClick={startEditingProjectTitle}
              aria-label={project.title}
            >
              {project.title}
            </h1>
          )}
        </div>
      </header>

      <main className="px-6 py-8" aria-label={STRINGS.a11y.mainContent}>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") {
                escapePressedRef.current = true;
                setEditingTitle(false);
              }
            }}
            className="mx-auto block max-w-[720px] mb-4 text-2xl font-serif text-text-primary bg-transparent border-b-2 border-accent focus:outline-none w-full"
            aria-label="Chapter title"
          />
        ) : (
          <h2
            className="mx-auto max-w-[720px] mb-4 text-2xl font-serif text-text-primary cursor-pointer hover:text-text-secondary"
            onDoubleClick={startEditingTitle}
            aria-label={activeChapter.title}
          >
            {activeChapter.title}
          </h2>
        )}
        <Editor
          content={activeChapter.content}
          onSave={handleSave}
          onContentChange={handleContentChange}
        />
      </main>

      <footer
        role="status"
        aria-live="polite"
        className="fixed bottom-0 left-0 right-0 border-t border-border bg-bg-primary px-6 py-2 flex items-center justify-between text-sm text-text-secondary"
      >
        <div>
          {STRINGS.project.wordCount(chapterWordCount)}
          {project && (
            <span className="ml-3 text-text-muted">
              {STRINGS.project.wordCount(
                project.chapters.reduce((sum, c) => sum + c.word_count, 0),
              )}{" "}total
            </span>
          )}
        </div>
        <div>
          {saveStatus === "saving" && STRINGS.editor.saving}
          {saveStatus === "saved" && STRINGS.editor.saved}
          {saveStatus === "error" && (
            <span className="text-status-error">{STRINGS.editor.saveFailed}</span>
          )}
          {saveStatus === "idle" && ""}
        </div>
      </footer>

      {shortcutHelpOpen && (
        <dialog
          open
          aria-label={STRINGS.shortcuts.dialogTitle}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 m-0 p-0 w-full h-full border-none bg-transparent"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShortcutHelpOpen(false);
          }}
        >
          <div className="rounded bg-bg-primary p-6 shadow-lg max-w-sm w-full mx-auto mt-[20vh]">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              {STRINGS.shortcuts.dialogTitle}
            </h3>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.togglePreview}</dt>
                <dd className="font-mono text-text-muted">Ctrl+Shift+P</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.newChapter}</dt>
                <dd className="font-mono text-text-muted">Ctrl+Shift+N</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.toggleSidebar}</dt>
                <dd className="font-mono text-text-muted">Ctrl+Shift+\</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.showShortcuts}</dt>
                <dd className="font-mono text-text-muted">Ctrl+/</dd>
              </div>
            </dl>
          </div>
        </dialog>
      )}
    </div>
  );
}
```

**Step 6: Run all tests**

```bash
make test
```

Existing EditorPage tests may need updating to mock `useProjectEditor` instead of direct API calls. Adjust as needed — the behavior should be identical.

**Step 7: Commit**

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts packages/client/src/pages/EditorPage.tsx
git commit -m "refactor: extract useProjectEditor hook from EditorPage"
```

---

### Task 9: Add dirty flag to Editor component

**Files:**
- Modify: `packages/client/src/components/Editor.tsx`
- Test: `packages/client/src/__tests__/Editor.test.tsx`

The Editor currently fires `onSave` on every blur, even if content hasn't changed. Add a dirty flag that tracks whether content has changed since last save.

**Step 1: Write failing test**

Add to `packages/client/src/__tests__/Editor.test.tsx`:

```typescript
it("does not fire onSave on blur when content is unchanged", async () => {
  const onSave = vi.fn();
  const content = { type: "doc", content: [{ type: "paragraph" }] };
  render(<Editor content={content} onSave={onSave} />);

  // Focus then blur without typing
  const editorEl = screen.getByRole("textbox");
  await userEvent.click(editorEl);
  editorEl.blur();

  // Should not have called onSave since content didn't change
  expect(onSave).not.toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -w packages/client -- --run
```

**Step 3: Implement dirty flag**

In `packages/client/src/components/Editor.tsx`, add a `dirtyRef`:

```typescript
const dirtyRef = useRef(false);
```

In the `onUpdate` callback, set it to `true`:

```typescript
onUpdate: ({ editor: ed }) => {
  dirtyRef.current = true;
  onContentChangeRef.current?.(ed.getJSON() as Record<string, unknown>);
  debouncedSave(ed);
},
```

In the `onBlur` callback, only save if dirty:

```typescript
onBlur: ({ editor: ed }) => {
  if (!dirtyRef.current) return;
  if (debounceTimerRef.current) {
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
  }
  onSaveRef.current(ed.getJSON() as Record<string, unknown>);
  dirtyRef.current = false;
},
```

Also reset dirty after debounced save fires — wrap the `debouncedSave` timeout callback:

```typescript
debounceTimerRef.current = setTimeout(() => {
  onSaveRef.current(editorInstance.getJSON() as Record<string, unknown>);
  dirtyRef.current = false;
  debounceTimerRef.current = null;
}, AUTO_SAVE_DEBOUNCE_MS);
```

Also reset dirty when content prop changes (external update):

In the existing `useEffect` that calls `setContent`, add after `editor.commands.setContent(content)`:

```typescript
dirtyRef.current = false;
```

Also expose a `flushSave` method via a new prop for chapter switching. Add to props:

```typescript
interface EditorProps {
  content: Record<string, unknown> | null;
  onSave: (content: Record<string, unknown>) => void;
  onContentChange?: (content: Record<string, unknown>) => void;
  editorRef?: React.MutableRefObject<{ flushSave: () => void } | null>;
}
```

And in the component body, after `editor` is created:

```typescript
useEffect(() => {
  if (editorRef && editor) {
    editorRef.current = {
      flushSave: () => {
        if (!dirtyRef.current) return;
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        onSaveRef.current(editor.getJSON() as Record<string, unknown>);
        dirtyRef.current = false;
      },
    };
  }
}, [editor, editorRef]);
```

**Step 4: Run tests**

```bash
npm test -w packages/client -- --run
```

**Step 5: Commit**

```bash
git add packages/client/src/components/Editor.tsx packages/client/src/__tests__/Editor.test.tsx
git commit -m "feat: add dirty flag to Editor to skip redundant saves"
```

---

### Task 10: Extract shared TipTap extension config

**Files:**
- Create: `packages/client/src/editorExtensions.ts`
- Modify: `packages/client/src/components/Editor.tsx`

This ensures the same TipTap extensions are used for both editor rendering and preview HTML generation.

**Step 1: Create the shared config**

Create `packages/client/src/editorExtensions.ts`:

```typescript
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";

/**
 * Shared TipTap extension configuration used by both the Editor component
 * and preview mode's generateHTML(). Keeping these in sync prevents
 * silent rendering divergence.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: false,
  }),
  Heading.configure({
    levels: [3, 4, 5],
  }),
];
```

**Step 2: Update Editor.tsx to import from shared config**

In `packages/client/src/components/Editor.tsx`, replace the inline extensions with:

```typescript
import { editorExtensions } from "../editorExtensions";
import Placeholder from "@tiptap/extension-placeholder";

// In useEditor:
extensions: [
  ...editorExtensions,
  Placeholder.configure({
    placeholder: STRINGS.editor.placeholder,
  }),
],
```

Remove the direct imports of `StarterKit` and `Heading` from Editor.tsx.

**Step 3: Run tests**

```bash
make test
```

**Step 4: Commit**

```bash
git add packages/client/src/editorExtensions.ts packages/client/src/components/Editor.tsx
git commit -m "refactor: extract shared TipTap extension config for editor and preview"
```

---

### Task 11: Sidebar component

**Files:**
- Create: `packages/client/src/components/Sidebar.tsx`
- Create: `packages/client/src/__tests__/Sidebar.test.tsx`
- Modify: `packages/client/src/strings.ts`

**Step 1: Add sidebar strings**

In `packages/client/src/strings.ts`, add to the object:

```typescript
sidebar: {
  addChapter: "Add Chapter",
  trash: "Trash",
  dragHandle: "Drag to reorder",
  chapterPosition: (title: string, position: number, total: number) =>
    `Chapter \u201c${title}\u201d moved to position ${position} of ${total}`,
},
```

**Step 2: Write failing tests**

Create `packages/client/src/__tests__/Sidebar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../components/Sidebar";
import type { ProjectWithChapters } from "@smudge/shared";

const mockProject: ProjectWithChapters = {
  id: "p1",
  title: "Test Project",
  mode: "fiction",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
  chapters: [
    {
      id: "ch1",
      project_id: "p1",
      title: "Chapter One",
      content: null,
      sort_order: 0,
      word_count: 100,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    },
    {
      id: "ch2",
      project_id: "p1",
      title: "Chapter Two",
      content: null,
      sort_order: 1,
      word_count: 200,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    },
  ],
};

describe("Sidebar", () => {
  it("renders chapter list", () => {
    render(
      <Sidebar
        project={mockProject}
        activeChapterId="ch1"
        onSelectChapter={vi.fn()}
        onAddChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReorderChapters={vi.fn()}
        onRenameChapter={vi.fn()}
        onOpenTrash={vi.fn()}
      />,
    );

    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
  });

  it("highlights active chapter", () => {
    render(
      <Sidebar
        project={mockProject}
        activeChapterId="ch1"
        onSelectChapter={vi.fn()}
        onAddChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReorderChapters={vi.fn()}
        onRenameChapter={vi.fn()}
        onOpenTrash={vi.fn()}
      />,
    );

    const activeItem = screen.getByText("Chapter One").closest("li");
    expect(activeItem?.className).toContain("bg-accent-light");
  });

  it("calls onSelectChapter when clicking a chapter", async () => {
    const onSelect = vi.fn();
    render(
      <Sidebar
        project={mockProject}
        activeChapterId="ch1"
        onSelectChapter={onSelect}
        onAddChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReorderChapters={vi.fn()}
        onRenameChapter={vi.fn()}
        onOpenTrash={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("Chapter Two"));
    expect(onSelect).toHaveBeenCalledWith("ch2");
  });

  it("calls onAddChapter when clicking Add Chapter button", async () => {
    const onAdd = vi.fn();
    render(
      <Sidebar
        project={mockProject}
        activeChapterId="ch1"
        onSelectChapter={vi.fn()}
        onAddChapter={onAdd}
        onDeleteChapter={vi.fn()}
        onReorderChapters={vi.fn()}
        onRenameChapter={vi.fn()}
        onOpenTrash={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("Add Chapter"));
    expect(onAdd).toHaveBeenCalled();
  });

  it("has correct ARIA landmark", () => {
    render(
      <Sidebar
        project={mockProject}
        activeChapterId="ch1"
        onSelectChapter={vi.fn()}
        onAddChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReorderChapters={vi.fn()}
        onRenameChapter={vi.fn()}
        onOpenTrash={vi.fn()}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Chapters" })).toBeInTheDocument();
  });

  it("sets aria-current on active chapter", () => {
    render(
      <Sidebar
        project={mockProject}
        activeChapterId="ch1"
        onSelectChapter={vi.fn()}
        onAddChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReorderChapters={vi.fn()}
        onRenameChapter={vi.fn()}
        onOpenTrash={vi.fn()}
      />,
    );

    const activeItem = screen.getByText("Chapter One").closest("li");
    expect(activeItem).toHaveAttribute("aria-current", "true");

    const inactiveItem = screen.getByText("Chapter Two").closest("li");
    expect(inactiveItem).not.toHaveAttribute("aria-current");
  });

  it("allows inline rename on double-click", async () => {
    const onRename = vi.fn();
    render(
      <Sidebar
        project={mockProject}
        activeChapterId="ch1"
        onSelectChapter={vi.fn()}
        onAddChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReorderChapters={vi.fn()}
        onRenameChapter={onRename}
        onOpenTrash={vi.fn()}
      />,
    );

    await userEvent.dblClick(screen.getByText("Chapter One"));
    const input = screen.getByRole("textbox", { name: "Chapter title" });
    expect(input).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    expect(onRename).toHaveBeenCalledWith("ch1", "Renamed");
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npm test -w packages/client -- --run
```

**Step 4: Implement Sidebar component**

Create `packages/client/src/components/Sidebar.tsx`:

```typescript
import { useState, useRef } from "react";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { STRINGS } from "../strings";

interface SidebarProps {
  project: ProjectWithChapters;
  activeChapterId: string;
  onSelectChapter: (id: string) => void;
  onAddChapter: () => void;
  onDeleteChapter: (chapter: Chapter) => void;
  onReorderChapters: (orderedIds: string[]) => void;
  onRenameChapter: (chapterId: string, title: string) => void;
  onOpenTrash: () => void;
}

export function Sidebar({
  project,
  activeChapterId,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  onRenameChapter,
  onOpenTrash,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  function startRename(chapter: Chapter) {
    setEditingId(chapter.id);
    setEditDraft(chapter.title);
    setTimeout(() => editInputRef.current?.select(), 0);
  }

  function commitRename() {
    if (editingId && editDraft.trim()) {
      onRenameChapter(editingId, editDraft.trim());
    }
    setEditingId(null);
  }

  return (
    <aside
      aria-label={STRINGS.a11y.chaptersSidebar}
      className="w-[260px] min-w-[260px] border-r border-border bg-bg-sidebar flex flex-col h-full overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          {project.title}
        </h2>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <ul role="list">
          {project.chapters.map((chapter) => (
            <li
              key={chapter.id}
              aria-current={chapter.id === activeChapterId ? "true" : undefined}
              className={`flex items-center gap-2 px-4 py-2 cursor-pointer group ${
                chapter.id === activeChapterId
                  ? "bg-accent-light"
                  : "hover:bg-bg-hover"
              }`}
            >
              {editingId === chapter.id ? (
                <input
                  ref={editInputRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 text-sm text-text-primary bg-bg-input border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
                  aria-label="Chapter title"
                />
              ) : (
                <button
                  onClick={() => onSelectChapter(chapter.id)}
                  onDoubleClick={() => startRename(chapter)}
                  className="flex-1 text-left text-sm text-text-primary truncate focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
                >
                  {chapter.title}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChapter(chapter);
                }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-status-error text-xs p-1 rounded focus:outline-none focus:ring-2 focus:ring-focus-ring"
                aria-label={`Delete ${chapter.title}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border px-4 py-3 flex flex-col gap-2">
        <button
          onClick={onAddChapter}
          className="w-full rounded bg-accent px-3 py-2 text-sm text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          {STRINGS.sidebar.addChapter}
        </button>
        <button
          onClick={onOpenTrash}
          className="w-full text-sm text-text-muted hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded py-1"
        >
          {STRINGS.sidebar.trash}
        </button>
      </div>
    </aside>
  );
}
```

**Step 5: Run tests**

```bash
npm test -w packages/client -- --run
```

**Step 6: Commit**

```bash
git add packages/client/src/components/Sidebar.tsx packages/client/src/__tests__/Sidebar.test.tsx packages/client/src/strings.ts
git commit -m "feat: add Sidebar component with chapter list, add, and delete"
```

---

### Task 12: EditorPage two-panel layout with sidebar

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`

**Step 1: Update EditorPage to include sidebar**

Import and wire the Sidebar into EditorPage. The layout becomes:

```
<div className="flex h-screen">
  {sidebarOpen && <Sidebar ... />}
  <div className="flex-1 flex flex-col overflow-hidden">
    <header>...</header>
    <main>...</main>
    <footer>...</footer>
  </div>
</div>
```

Key changes:
- Add `sidebarOpen` state (default `true`)
- Add `deleteTarget` state for chapter delete confirmation
- Add `trashOpen` state
- Import `Sidebar` component
- Wire sidebar props to `useProjectEditor` callbacks
- Wrap existing layout in flex container

In `EditorPage.tsx`, add state:

```typescript
const [sidebarOpen, setSidebarOpen] = useState(true);
const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
const [trashOpen, setTrashOpen] = useState(false);
```

Import Chapter type:

```typescript
import type { Chapter } from "@smudge/shared";
```

Add chapter delete with confirmation:

```typescript
async function confirmDeleteChapter() {
  if (!deleteTarget) return;
  await handleDeleteChapter(deleteTarget);
  setDeleteTarget(null);
}
```

Restructure the return JSX to include sidebar (see full component in implementation).

**Step 2: Run all tests**

```bash
make test
```

Fix any test failures caused by the layout change (test selectors may need updating).

**Step 3: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx
git commit -m "feat: add two-panel layout with sidebar in EditorPage"
```

---

### Task 13: Chapter switching with auto-save flush

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/hooks/useProjectEditor.ts`

When selecting a different chapter, the editor should flush any pending save before loading new content.

**Step 1: Wire editorRef for flush**

In EditorPage, create a ref and pass it to Editor:

```typescript
const editorRef = useRef<{ flushSave: () => void } | null>(null);
```

Pass to Editor:

```tsx
<Editor
  content={activeChapter.content}
  onSave={handleSave}
  onContentChange={handleContentChange}
  editorRef={editorRef}
/>
```

Modify `handleSelectChapter` in the hook (or wrap it in EditorPage) to call flush first:

```typescript
const handleSelectChapterWithFlush = useCallback(
  async (chapterId: string) => {
    editorRef.current?.flushSave();
    await handleSelectChapter(chapterId);
  },
  [handleSelectChapter],
);
```

Pass `handleSelectChapterWithFlush` to Sidebar instead of `handleSelectChapter`.

**Step 2: Run tests**

```bash
make test
```

**Step 3: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx packages/client/src/hooks/useProjectEditor.ts
git commit -m "feat: flush pending auto-save on chapter switch"
```

---

### Task 14: Drag-and-drop chapter reorder

**Files:**
- Modify: `packages/client/src/components/Sidebar.tsx`
- Test: `packages/client/src/__tests__/Sidebar.test.tsx`

**Step 1: Add drag-and-drop to Sidebar**

Update `packages/client/src/components/Sidebar.tsx` to use `@dnd-kit/sortable`:

```typescript
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
```

Note: You'll need to also install `@dnd-kit/core`, `@dnd-kit/modifiers`, and `@dnd-kit/utilities` as they're peer/required dependencies:

```bash
npm install @dnd-kit/core @dnd-kit/modifiers @dnd-kit/utilities --workspace=packages/client
```

Create a `SortableChapterItem` sub-component:

```typescript
function SortableChapterItem({
  chapter,
  isActive,
  onSelect,
  onDelete,
}: {
  chapter: Chapter;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: chapter.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1 px-2 py-2 cursor-pointer group ${
        isActive ? "bg-accent-light" : "hover:bg-bg-hover"
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 px-1"
        aria-label={STRINGS.sidebar.dragHandle}
      >
        ⠿
      </span>
      <button
        onClick={onSelect}
        className="flex-1 text-left text-sm text-text-primary truncate focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-1"
      >
        {chapter.title}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-status-error text-xs p-1 rounded focus:outline-none focus:ring-2 focus:ring-focus-ring"
        aria-label={`Delete ${chapter.title}`}
      >
        ✕
      </button>
    </li>
  );
}
```

Update the Sidebar component's chapter list:

```typescript
const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  }),
);

function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over || active.id === over.id) return;

  const oldIndex = project.chapters.findIndex((c) => c.id === active.id);
  const newIndex = project.chapters.findIndex((c) => c.id === over.id);

  const reordered = [...project.chapters];
  const [moved] = reordered.splice(oldIndex, 1);
  reordered.splice(newIndex, 0, moved);

  onReorderChapters(reordered.map((c) => c.id));
}
```

Wrap the list in DndContext + SortableContext:

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCenter}
  onDragEnd={handleDragEnd}
  modifiers={[restrictToVerticalAxis]}
>
  <SortableContext
    items={project.chapters.map((c) => c.id)}
    strategy={verticalListSortingStrategy}
  >
    <ul role="list">
      {project.chapters.map((chapter) => (
        <SortableChapterItem
          key={chapter.id}
          chapter={chapter}
          isActive={chapter.id === activeChapterId}
          onSelect={() => onSelectChapter(chapter.id)}
          onDelete={() => onDeleteChapter(chapter)}
        />
      ))}
    </ul>
  </SortableContext>
</DndContext>
```

**Step 2: Run tests**

```bash
make test
```

**Step 3: Commit**

```bash
git add packages/client/src/components/Sidebar.tsx package-lock.json packages/client/package.json
git commit -m "feat: add drag-and-drop chapter reordering with @dnd-kit/sortable"
```

---

### Task 15: Alt+Up/Down keyboard reorder with live region

**Files:**
- Modify: `packages/client/src/components/Sidebar.tsx`

**Step 1: Add keyboard reorder handler**

In Sidebar, add a live region div and keyboard handler:

```typescript
const [announcement, setAnnouncement] = useState("");

function handleKeyReorder(e: React.KeyboardEvent, chapterIndex: number) {
  if (!e.altKey) return;
  const chapters = project.chapters;

  if (e.key === "ArrowUp" && chapterIndex > 0) {
    e.preventDefault();
    const reordered = [...chapters];
    [reordered[chapterIndex - 1], reordered[chapterIndex]] = [
      reordered[chapterIndex],
      reordered[chapterIndex - 1],
    ];
    const ids = reordered.map((c) => c.id);
    onReorderChapters(ids);
    setAnnouncement(
      STRINGS.sidebar.chapterPosition(chapters[chapterIndex].title, chapterIndex, chapters.length),
    );
  }

  if (e.key === "ArrowDown" && chapterIndex < chapters.length - 1) {
    e.preventDefault();
    const reordered = [...chapters];
    [reordered[chapterIndex], reordered[chapterIndex + 1]] = [
      reordered[chapterIndex + 1],
      reordered[chapterIndex],
    ];
    const ids = reordered.map((c) => c.id);
    onReorderChapters(ids);
    setAnnouncement(
      STRINGS.sidebar.chapterPosition(
        chapters[chapterIndex].title,
        chapterIndex + 2,
        chapters.length,
      ),
    );
  }
}
```

Add live region at the bottom of the sidebar:

```tsx
<div aria-live="assertive" className="sr-only">
  {announcement}
</div>
```

Add `onKeyDown={(e) => handleKeyReorder(e, index)}` to each chapter item's select button.

**Step 2: Run tests**

```bash
make test
```

**Step 3: Commit**

```bash
git add packages/client/src/components/Sidebar.tsx
git commit -m "feat: add Alt+Up/Down keyboard chapter reordering with live announcements"
```

---

### Task 16: Chapter delete with confirmation dialog

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`

The delete confirmation is managed in EditorPage (like project delete in HomePage). When Sidebar calls `onDeleteChapter`, EditorPage sets `deleteTarget`, shows a `<dialog>`, and on confirm calls the hook's `handleDeleteChapter`.

**Step 1: Add delete confirmation dialog to EditorPage**

In the EditorPage JSX, after the shortcuts dialog, add:

```tsx
{deleteTarget && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    role="alertdialog"
    aria-modal="true"
    aria-label="Confirm delete"
    aria-describedby="delete-confirm-body"
  >
    <div className="rounded bg-bg-primary p-6 shadow-lg max-w-sm w-full mx-4">
      <p className="text-text-primary font-medium mb-2">
        {STRINGS.delete.confirmTitle(deleteTarget.title)}
      </p>
      <p id="delete-confirm-body" className="text-text-secondary text-sm mb-4">{STRINGS.delete.confirmBody}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setDeleteTarget(null)}
          className="rounded px-4 py-2 text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          {STRINGS.delete.cancelButton}
        </button>
        <button
          onClick={confirmDeleteChapter}
          className="rounded bg-status-error px-4 py-2 text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          {STRINGS.delete.confirmButton}
        </button>
      </div>
    </div>
  </div>
)}
```

Wire the Sidebar's `onDeleteChapter` to `setDeleteTarget` (not directly to `handleDeleteChapter`).

**Step 2: Run tests**

```bash
make test
```

**Step 3: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx
git commit -m "feat: add chapter delete confirmation dialog"
```

---

### Task 17: Trash view

**Files:**
- Create: `packages/client/src/components/TrashView.tsx`
- Create: `packages/client/src/__tests__/TrashView.test.tsx`
- Modify: `packages/client/src/pages/EditorPage.tsx`

**Step 1: Write failing tests**

Create `packages/client/src/__tests__/TrashView.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrashView } from "../components/TrashView";
import type { Chapter } from "@smudge/shared";

const trashedChapters: Chapter[] = [
  {
    id: "ch1",
    project_id: "p1",
    title: "Deleted Chapter",
    content: null,
    sort_order: 0,
    word_count: 50,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: "2026-03-20T10:00:00.000Z",
  },
];

describe("TrashView", () => {
  it("renders trashed chapters", () => {
    render(
      <TrashView chapters={trashedChapters} onRestore={vi.fn()} onBack={vi.fn()} />,
    );

    expect(screen.getByText("Deleted Chapter")).toBeInTheDocument();
  });

  it("calls onRestore when clicking Restore", async () => {
    const onRestore = vi.fn();
    render(
      <TrashView chapters={trashedChapters} onRestore={onRestore} onBack={vi.fn()} />,
    );

    await userEvent.click(screen.getByText("Restore"));
    expect(onRestore).toHaveBeenCalledWith("ch1");
  });

  it("shows empty state when no trashed chapters", () => {
    render(<TrashView chapters={[]} onRestore={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText(/no chapters in trash/i)).toBeInTheDocument();
  });

  it("calls onBack when clicking Back", async () => {
    const onBack = vi.fn();
    render(
      <TrashView chapters={trashedChapters} onRestore={onBack} onBack={onBack} />,
    );

    await userEvent.click(screen.getByText("Back to editor"));
    expect(onBack).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/client -- --run
```

**Step 3: Implement TrashView**

Create `packages/client/src/components/TrashView.tsx`:

```typescript
import type { Chapter } from "@smudge/shared";
import { STRINGS } from "../strings";

interface TrashViewProps {
  chapters: Chapter[];
  onRestore: (chapterId: string) => void;
  onBack: () => void;
}

export function TrashView({ chapters, onRestore, onBack }: TrashViewProps) {
  return (
    <div className="mx-auto max-w-[720px] py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-text-primary">{STRINGS.sidebar.trash}</h2>
        <button
          onClick={onBack}
          className="text-sm text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
        >
          Back to editor
        </button>
      </div>

      {chapters.length === 0 ? (
        <p className="text-text-muted text-center py-12">No chapters in trash.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {chapters.map((chapter) => (
            <li
              key={chapter.id}
              className="flex items-center justify-between rounded border border-border bg-bg-input p-4"
            >
              <div>
                <span className="text-text-primary">{chapter.title}</span>
                {chapter.deleted_at && (
                  <span className="ml-3 text-sm text-text-muted">
                    {STRINGS.project.lastEdited(chapter.deleted_at).replace("Edited", "Deleted")}
                  </span>
                )}
              </div>
              <button
                onClick={() => onRestore(chapter.id)}
                className="rounded bg-accent px-3 py-1 text-sm text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

**Step 4: Add trash strings**

In `packages/client/src/strings.ts`, add to `sidebar`:

```typescript
trashEmpty: "No chapters in trash.",
restore: "Restore",
backToEditor: "Back to editor",
```

**Step 5: Wire TrashView into EditorPage**

In `EditorPage.tsx`, when `trashOpen` is true, replace the `<main>` editor area with `<TrashView>`. Fetch trashed chapters via `api.projects.trash(projectId)` when trash view opens.

Add to the hook or to EditorPage:

```typescript
const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);

async function openTrash() {
  if (!projectId) return;
  const trashed = await api.projects.trash(projectId);
  setTrashedChapters(trashed);
  setTrashOpen(true);
}

async function handleRestore(chapterId: string) {
  const restored = await api.chapters.restore(chapterId);
  setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
  setProject((prev) =>
    prev ? { ...prev, chapters: [...prev.chapters, restored].sort((a, b) => a.sort_order - b.sort_order) } : prev,
  );
}
```

In the JSX, conditionally render TrashView or Editor:

```tsx
{trashOpen ? (
  <TrashView
    chapters={trashedChapters}
    onRestore={handleRestore}
    onBack={() => setTrashOpen(false)}
  />
) : (
  // existing editor area
)}
```

**Step 6: Run tests**

```bash
make test
```

**Step 7: Commit**

```bash
git add packages/client/src/components/TrashView.tsx packages/client/src/__tests__/TrashView.test.tsx packages/client/src/pages/EditorPage.tsx packages/client/src/strings.ts
git commit -m "feat: add trash view for restoring deleted chapters"
```

---

### Task 18: Ctrl+Shift+\ toggle sidebar

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`

**Step 1: Add keyboard handler**

In the existing `handleKeyDown` in EditorPage, add:

```typescript
if (ctrl && e.shiftKey && e.key === "\\") {
  e.preventDefault();
  setSidebarOpen((prev) => !prev);
  return;
}
```

**Step 2: Run tests**

```bash
make test
```

**Step 3: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx
git commit -m "feat: add Ctrl+Shift+\\ to toggle sidebar"
```

---

## Phase 3: Preview Mode

### Task 19: Preview component with generateHTML

**Files:**
- Create: `packages/client/src/components/PreviewMode.tsx`
- Create: `packages/client/src/__tests__/PreviewMode.test.tsx`
- Modify: `packages/client/src/strings.ts`

**Step 1: Add preview strings**

In `packages/client/src/strings.ts`:

```typescript
preview: {
  backToEditor: "Back to Editor",
  tableOfContents: "Table of Contents",
},
```

**Step 2: Write failing tests**

Create `packages/client/src/__tests__/PreviewMode.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewMode } from "../components/PreviewMode";
import type { Chapter } from "@smudge/shared";

const chapters: Chapter[] = [
  {
    id: "ch1",
    project_id: "p1",
    title: "Chapter One",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    },
    sort_order: 0,
    word_count: 2,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
  },
  {
    id: "ch2",
    project_id: "p1",
    title: "Chapter Two",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Goodbye world" }] }],
    },
    sort_order: 1,
    word_count: 2,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
  },
];

describe("PreviewMode", () => {
  it("renders all chapter titles as h2 headings", () => {
    render(
      <PreviewMode
        chapters={chapters}
        onClose={vi.fn()}
        onNavigateToChapter={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Chapter One" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chapter Two" })).toBeInTheDocument();
  });

  it("renders chapter content as HTML", () => {
    render(
      <PreviewMode
        chapters={chapters}
        onClose={vi.fn()}
        onNavigateToChapter={vi.fn()}
      />,
    );

    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("Goodbye world")).toBeInTheDocument();
  });

  it("calls onClose when Back to Editor is clicked", async () => {
    const onClose = vi.fn();
    render(
      <PreviewMode
        chapters={chapters}
        onClose={onClose}
        onNavigateToChapter={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByText("Back to Editor"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onNavigateToChapter when clicking a chapter heading", async () => {
    const onNav = vi.fn();
    render(
      <PreviewMode
        chapters={chapters}
        onClose={vi.fn()}
        onNavigateToChapter={onNav}
      />,
    );

    await userEvent.click(screen.getByRole("heading", { name: "Chapter Two" }));
    expect(onNav).toHaveBeenCalledWith("ch2");
  });

  it("has Back to Editor as the first focusable element", () => {
    render(
      <PreviewMode
        chapters={chapters}
        onClose={vi.fn()}
        onNavigateToChapter={vi.fn()}
      />,
    );

    const backButton = screen.getByText("Back to Editor");
    // It should be the first button in the document
    const allButtons = screen.getAllByRole("button");
    expect(allButtons[0]).toBe(backButton);
  });

  it("renders TOC with chapter titles as links", () => {
    render(
      <PreviewMode
        chapters={chapters}
        onClose={vi.fn()}
        onNavigateToChapter={vi.fn()}
      />,
    );

    // TOC should have links to chapters
    const tocNav = screen.getByRole("navigation", { name: "Table of Contents" });
    expect(tocNav).toBeInTheDocument();
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npm test -w packages/client -- --run
```

**Step 4: Implement PreviewMode**

Create `packages/client/src/components/PreviewMode.tsx`:

```typescript
import { useEffect, useRef, useState } from "react";
import { generateHTML } from "@tiptap/html";
import type { Chapter } from "@smudge/shared";
import { editorExtensions } from "../editorExtensions";
import { STRINGS } from "../strings";

interface PreviewModeProps {
  chapters: Chapter[];
  onClose: () => void;
  onNavigateToChapter: (chapterId: string) => void;
}

export function PreviewMode({ chapters, onClose, onNavigateToChapter }: PreviewModeProps) {
  const [activeTocId, setActiveTocId] = useState<string>(chapters[0]?.id ?? "");
  const chapterRefs = useRef<Map<string, HTMLElement>>(new Map());
  const backButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the back button on mount
  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  // Escape key closes preview
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // IntersectionObserver for TOC scroll tracking
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );

    chapterRefs.current.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [chapters]);

  function renderChapterHtml(content: Record<string, unknown> | null): string {
    if (!content) return "";
    try {
      return generateHTML(content as Parameters<typeof generateHTML>[0], editorExtensions);
    } catch {
      return "<p><em>Unable to render content</em></p>";
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-bg-primary overflow-y-auto">
      <div className="flex">
        {/* Main content */}
        <div className="flex-1">
          <div className="mx-auto max-w-[680px] px-6 py-8">
            <button
              ref={backButtonRef}
              onClick={onClose}
              className="mb-8 text-sm text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
            >
              {STRINGS.preview.backToEditor}
            </button>

            {chapters.map((chapter) => (
              <section
                key={chapter.id}
                id={chapter.id}
                ref={(el) => {
                  if (el) chapterRefs.current.set(chapter.id, el);
                }}
                className="mb-16"
              >
                <h2
                  className="text-2xl font-serif text-text-primary mb-6 cursor-pointer hover:text-accent"
                  onClick={() => onNavigateToChapter(chapter.id)}
                >
                  {chapter.title}
                </h2>
                <div
                  className="prose prose-lg font-serif text-text-primary leading-[1.9] prose-headings:text-text-primary prose-a:text-accent"
                  dangerouslySetInnerHTML={{ __html: renderChapterHtml(chapter.content) }}
                />
              </section>
            ))}
          </div>
        </div>

        {/* TOC Panel */}
        <nav
          aria-label={STRINGS.preview.tableOfContents}
          className="hidden lg:block w-[200px] min-w-[200px] sticky top-0 h-screen overflow-y-auto py-8 pr-6"
        >
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">
            {STRINGS.preview.tableOfContents}
          </h3>
          <ul className="flex flex-col gap-1">
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                <a
                  href={`#${chapter.id}`}
                  aria-current={activeTocId === chapter.id ? "true" : undefined}
                  className={`block text-sm py-1 rounded px-2 ${
                    activeTocId === chapter.id
                      ? "text-accent font-medium bg-accent-light"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {chapter.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
```

**Step 5: Run tests**

```bash
npm test -w packages/client -- --run
```

**Step 6: Commit**

```bash
git add packages/client/src/components/PreviewMode.tsx packages/client/src/__tests__/PreviewMode.test.tsx packages/client/src/strings.ts
git commit -m "feat: add PreviewMode with generateHTML, TOC, and scroll tracking"
```

---

### Task 20: Wire preview into EditorPage with Ctrl+Shift+P

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`

**Step 1: Add preview state and toggle**

In EditorPage, add:

```typescript
const [previewOpen, setPreviewOpen] = useState(false);
```

Import PreviewMode:

```typescript
import { PreviewMode } from "../components/PreviewMode";
```

Add keyboard handler in the existing `handleKeyDown`:

```typescript
if (ctrl && e.shiftKey && e.key === "P") {
  e.preventDefault();
  setPreviewOpen((prev) => !prev);
  return;
}
```

Add a Preview button in the header (next to project title):

```tsx
<button
  onClick={() => setPreviewOpen(true)}
  className="text-sm text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
>
  Preview
</button>
```

Render PreviewMode when open:

```tsx
{previewOpen && (
  <PreviewMode
    chapters={project.chapters}
    onClose={() => setPreviewOpen(false)}
    onNavigateToChapter={(chapterId) => {
      setPreviewOpen(false);
      handleSelectChapter(chapterId);
    }}
  />
)}
```

**Step 2: Run tests**

```bash
make test
```

**Step 3: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx
git commit -m "feat: add Ctrl+Shift+P to toggle preview mode"
```

---

## Phase 4: Cleanup

### Task 21: Update shortcut help dialog

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`

The shortcut dialog already lists all shortcuts. Verify that all shortcut labels in `STRINGS.shortcuts` match the implemented behavior. Ensure Ctrl+Shift+\, Ctrl+Shift+P, Ctrl+Shift+N, and Ctrl+/ are all listed and functional.

**Step 1: Verify and fix if needed**

Read EditorPage's shortcut dialog section and verify all shortcuts are listed. They should already be there from the original implementation.

**Step 2: Run full test suite**

```bash
make all
```

This runs lint + format + test — the full CI pass.

**Step 3: Commit (if changes needed)**

```bash
git add packages/client/src/pages/EditorPage.tsx
git commit -m "chore: verify all keyboard shortcuts in help dialog"
```

---

### Task 22: Final verification

**Step 1: Run the full test suite**

```bash
make all
```

**Step 2: Start dev servers and manually verify**

```bash
make dev
```

Manual checks:
- [ ] Sidebar shows chapters, active chapter highlighted
- [ ] Clicking chapter switches editor content
- [ ] "Add Chapter" creates new chapter
- [ ] Delete shows confirmation, moves to trash
- [ ] Drag-and-drop reorders chapters
- [ ] Alt+Up/Down reorders with announcement
- [ ] Ctrl+Shift+\ toggles sidebar
- [ ] Trash view shows deleted chapters, restore works
- [ ] Ctrl+Shift+P opens preview
- [ ] Preview shows all chapters with HTML rendering
- [ ] TOC panel tracks scroll position
- [ ] Clicking chapter heading in preview returns to editor
- [ ] Escape closes preview
- [ ] Auto-save flushes on chapter switch

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: sidebar, chapter management, preview mode, and trash — complete"
```
