# Writer's Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add chapter status labels, a project dashboard view, resizable sidebar, and chapter navigation shortcuts (Phase 1 of the roadmap).

**Architecture:** Six sequential tasks: (1) migration + shared types, (2) server API changes, (3) sidebar status badges, (4) resizable sidebar, (5) refactor to peer tabs + dashboard view, (6) chapter navigation shortcuts. Each task follows red-green-refactor with commits after each green.

**Tech Stack:** TypeScript, SQLite/Knex.js, Express, React 18, TipTap, Tailwind CSS, Vitest, Supertest, @testing-library/react

**Design doc:** `docs/plans/2026-03-30-writers-dashboard-design.md`

---

## Task 1: Migration + Shared Types

**Files:**
- Create: `packages/server/src/db/migrations/003_add_chapter_status.js`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/server/src/__tests__/migrations.test.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`

### Step 1: Write the migration

Create `packages/server/src/db/migrations/003_add_chapter_status.js`:

```js
/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable("chapter_statuses", (table) => {
    table.string("status").primary();
    table.integer("sort_order").notNullable();
    table.string("label").notNullable();
  });

  await knex("chapter_statuses").insert([
    { status: "outline", sort_order: 1, label: "Outline" },
    { status: "rough_draft", sort_order: 2, label: "Rough Draft" },
    { status: "revised", sort_order: 3, label: "Revised" },
    { status: "edited", sort_order: 4, label: "Edited" },
    { status: "final", sort_order: 5, label: "Final" },
  ]);

  await knex.schema.alterTable("chapters", (table) => {
    table.string("status").defaultTo("outline");
  });

  // Backfill existing chapters
  await knex("chapters").whereNull("status").update({ status: "outline" });

  // Add foreign key constraint via raw SQL — SQLite doesn't support
  // ALTER TABLE ADD CONSTRAINT, but we can enforce at application level
  // and the FK is enforced on new tables. For existing tables, we recreate.
  // However, since SQLite ALTER TABLE is limited, we enforce via application
  // layer (Zod) and the chapter_statuses table serves as the reference.
  // The FK constraint is enforced by the application, not the DB.
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable("chapters", (table) => {
    table.dropColumn("status");
  });
  await knex.schema.dropTableIfExists("chapter_statuses");
}
```

**Note on FK enforcement:** SQLite cannot add FK constraints to existing columns via ALTER TABLE (would require recreating the table). Validation is enforced at the application layer: Zod schema validation in the shared package, plus a server-side check against the `chapter_statuses` table before accepting a status value. This matches the existing pattern used for title uniqueness.

### Step 2: Add shared types and schemas

Modify `packages/shared/src/schemas.ts` — add after the existing `ProjectMode` definition:

```ts
export const ChapterStatus = z.enum([
  "outline",
  "rough_draft",
  "revised",
  "edited",
  "final",
]);

export const UpdateChapterSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    content: TipTapDocSchema.optional(),
    status: ChapterStatus.optional(),
  })
  .refine((data) => data.title !== undefined || data.content !== undefined || data.status !== undefined, {
    message: "Must provide at least title, content, or status",
  });
```

Note: this replaces the existing `UpdateChapterSchema`. The only change is adding `status` to the object and the refine predicate.

Modify `packages/shared/src/types.ts` — add `status` to the `Chapter` interface:

```ts
export interface Chapter {
  id: string;
  project_id: string;
  title: string;
  content: Record<string, unknown> | null;
  sort_order: number;
  word_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
```

Add a new interface:

```ts
export interface ChapterStatusRow {
  status: string;
  sort_order: number;
  label: string;
}
```

Modify `packages/shared/src/index.ts` — add exports:

```ts
export { ChapterStatus } from "./schemas";
export type { ChapterStatusRow } from "./types";
```

### Step 3: Write migration tests

Add to `packages/server/src/__tests__/migrations.test.ts` — a test that verifies the `chapter_statuses` table is seeded and that the `status` column exists on chapters:

```ts
it("003 creates chapter_statuses table with seed data", async () => {
  const statuses = await t.db("chapter_statuses").orderBy("sort_order");
  expect(statuses).toHaveLength(5);
  expect(statuses[0]).toEqual({ status: "outline", sort_order: 1, label: "Outline" });
  expect(statuses[4]).toEqual({ status: "final", sort_order: 5, label: "Final" });
});

it("003 adds status column to chapters with default outline", async () => {
  const projectId = "test-proj-id";
  const chapterId = "test-chap-id";
  const now = new Date().toISOString();

  await t.db("projects").insert({
    id: projectId,
    title: "Test",
    slug: "test",
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });

  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title: "Ch 1",
    sort_order: 0,
    word_count: 0,
    created_at: now,
    updated_at: now,
  });

  const chapter = await t.db("chapters").where({ id: chapterId }).first();
  expect(chapter.status).toBe("outline");
});
```

### Step 4: Write schema validation tests

Add to `packages/shared/src/__tests__/schemas.test.ts`:

```ts
describe("ChapterStatus", () => {
  it("accepts valid statuses", () => {
    for (const s of ["outline", "rough_draft", "revised", "edited", "final"]) {
      expect(ChapterStatus.safeParse(s).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(ChapterStatus.safeParse("invalid").success).toBe(false);
  });
});

describe("UpdateChapterSchema with status", () => {
  it("accepts status alone", () => {
    const result = UpdateChapterSchema.safeParse({ status: "revised" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = UpdateChapterSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });
});
```

### Step 5: Run all tests

Run: `npm test -w packages/shared && npm test -w packages/server`

Expected: ALL PASS

### Step 6: Update test-helpers.ts

The `beforeEach` cleanup in `packages/server/src/__tests__/test-helpers.ts` must also clear the `chapter_statuses` table... actually no — it's a reference table that should persist. But deleting chapters referencing it is fine. No change needed to test-helpers.

### Step 7: Commit

```bash
git add packages/server/src/db/migrations/003_add_chapter_status.js \
      packages/shared/src/schemas.ts \
      packages/shared/src/types.ts \
      packages/shared/src/index.ts \
      packages/server/src/__tests__/migrations.test.ts \
      packages/shared/src/__tests__/schemas.test.ts
git commit -m "feat: add chapter_statuses table and status column on chapters"
```

---

## Task 2: Server API Changes

**Files:**
- Modify: `packages/server/src/routes/chapters.ts`
- Modify: `packages/server/src/routes/projects.ts`
- Modify: `packages/server/src/app.ts`
- Create: `packages/server/src/routes/chapter-statuses.ts`
- Test: `packages/server/src/__tests__/chapters.test.ts`
- Test: `packages/server/src/__tests__/chapter-statuses.test.ts`
- Test: `packages/server/src/__tests__/dashboard.test.ts`

### Step 1: Write failing test — PATCH chapter with status

Add to `packages/server/src/__tests__/chapters.test.ts`, inside the `PATCH /api/chapters/:id` describe block:

```ts
it("updates chapter status", async () => {
  const { chapterId } = await createProjectWithChapter(t.app);

  const res = await request(t.app)
    .patch(`/api/chapters/${chapterId}`)
    .send({ status: "rough_draft" });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe("rough_draft");
});

it("returns 400 for invalid status", async () => {
  const { chapterId } = await createProjectWithChapter(t.app);

  const res = await request(t.app)
    .patch(`/api/chapters/${chapterId}`)
    .send({ status: "invalid_status" });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("VALIDATION_ERROR");
});

it("returns chapter with status in response", async () => {
  const { chapterId } = await createProjectWithChapter(t.app);

  const res = await request(t.app).get(`/api/chapters/${chapterId}`);

  expect(res.status).toBe(200);
  expect(res.body.status).toBe("outline");
});
```

### Step 2: Run test to verify it fails

Run: `npm test -w packages/server -- --grep "updates chapter status"`

Expected: FAIL (status not being handled in PATCH)

### Step 3: Implement status in PATCH /api/chapters/:id

Modify `packages/server/src/routes/chapters.ts` — in the PATCH handler, after the `if (parsed.data.content !== undefined)` block (around line 66), add:

```ts
if (parsed.data.status !== undefined) {
  // Validate against chapter_statuses table
  const validStatus = await db("chapter_statuses")
    .where({ status: parsed.data.status })
    .first();
  if (!validStatus) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: `Invalid status: ${parsed.data.status}`,
      },
    });
    return;
  }
  updates.status = parsed.data.status;
}
```

### Step 4: Run test to verify it passes

Run: `npm test -w packages/server -- --grep "updates chapter status"`

Expected: PASS

### Step 5: Write failing test — GET /api/projects/:slug includes status and status_label

Add to `packages/server/src/__tests__/chapters.test.ts` or a relevant location:

```ts
it("GET /api/projects/:slug includes chapter status and status_label", async () => {
  const { projectSlug, chapterId } = await createProjectWithChapter(t.app);
  await request(t.app).patch(`/api/chapters/${chapterId}`).send({ status: "edited" });

  const res = await request(t.app).get(`/api/projects/${projectSlug}`);

  expect(res.status).toBe(200);
  expect(res.body.chapters[0].status).toBe("edited");
  expect(res.body.chapters[0].status_label).toBe("Edited");
});
```

### Step 6: Run test to verify it fails

The `status` field will pass (SELECT * includes the new column), but `status_label` will fail — the endpoint doesn't join with `chapter_statuses` yet.

Run: `npm test -w packages/server -- --grep "status_label"`

Expected: FAIL

### Step 6b: Add status_label to GET /api/projects/:slug

Modify `packages/server/src/routes/projects.ts` — in the `GET /:slug` handler, after fetching chapters, join with `chapter_statuses` to add labels:

```ts
const parsedChapters = await Promise.all(
  chapters.map(async (ch: Record<string, unknown>) => {
    const statusRow = await db("chapter_statuses")
      .where({ status: ch.status })
      .first();
    return {
      ...parseChapterContent(ch),
      status_label: statusRow?.label ?? ch.status,
    };
  }),
);
```

### Step 6c: Run test to verify it passes

Run: `npm test -w packages/server`

Expected: ALL PASS

### Step 7: Write failing test — GET /api/chapter-statuses

Create `packages/server/src/__tests__/chapter-statuses.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("GET /api/chapter-statuses", () => {
  it("returns all statuses in sort_order", async () => {
    const res = await request(t.app).get("/api/chapter-statuses");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body[0]).toEqual({ status: "outline", sort_order: 1, label: "Outline" });
    expect(res.body[4]).toEqual({ status: "final", sort_order: 5, label: "Final" });
  });
});
```

### Step 8: Run test to verify it fails

Run: `npm test -w packages/server -- --grep "chapter-statuses"`

Expected: FAIL (404 — route doesn't exist)

### Step 9: Implement GET /api/chapter-statuses

Create `packages/server/src/routes/chapter-statuses.ts`:

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { asyncHandler } from "../app";

export function chapterStatusesRouter(db: Knex): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const statuses = await db("chapter_statuses").orderBy("sort_order", "asc");
      res.json(statuses);
    }),
  );

  return router;
}
```

Register in `packages/server/src/app.ts` — add import and mount:

```ts
import { chapterStatusesRouter } from "./routes/chapter-statuses";

// In createApp, after the chapters router:
app.use("/api/chapter-statuses", chapterStatusesRouter(db));
```

### Step 10: Run test to verify it passes

Run: `npm test -w packages/server -- --grep "chapter-statuses"`

Expected: PASS

### Step 11: Write failing test — GET /api/projects/:slug/dashboard

Create `packages/server/src/__tests__/dashboard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

async function createProjectWithChapters(app: ReturnType<typeof setupTestDb>["app"]) {
  const projectRes = await request(app)
    .post("/api/projects")
    .send({ title: "Dashboard Test", mode: "fiction" });
  const slug = projectRes.body.slug;

  const getRes = await request(app).get(`/api/projects/${slug}`);
  const firstChapterId = getRes.body.chapters[0].id;

  // Add content to first chapter
  await request(app)
    .patch(`/api/chapters/${firstChapterId}`)
    .send({
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
      },
    });

  // Change status of first chapter
  await request(app)
    .patch(`/api/chapters/${firstChapterId}`)
    .send({ status: "rough_draft" });

  // Add a second chapter
  const ch2Res = await request(app).post(`/api/projects/${slug}/chapters`);

  return { slug, firstChapterId, secondChapterId: ch2Res.body.id };
}

describe("GET /api/projects/:slug/dashboard", () => {
  it("returns chapter list with status and metadata", async () => {
    const { slug } = await createProjectWithChapters(t.app);

    const res = await request(t.app).get(`/api/projects/${slug}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.chapters).toHaveLength(2);
    expect(res.body.chapters[0]).toHaveProperty("status");
    expect(res.body.chapters[0]).toHaveProperty("word_count");
    expect(res.body.chapters[0]).toHaveProperty("updated_at");
    expect(res.body.chapters[0]).toHaveProperty("sort_order");
    expect(res.body.chapters[0]).toHaveProperty("title");
  });

  it("returns correct status_summary counts", async () => {
    const { slug } = await createProjectWithChapters(t.app);

    const res = await request(t.app).get(`/api/projects/${slug}/dashboard`);

    expect(res.body.status_summary.rough_draft).toBe(1);
    expect(res.body.status_summary.outline).toBe(1);
    expect(res.body.status_summary.revised).toBe(0);
    expect(res.body.status_summary.edited).toBe(0);
    expect(res.body.status_summary.final).toBe(0);
  });

  it("returns correct totals", async () => {
    const { slug } = await createProjectWithChapters(t.app);

    const res = await request(t.app).get(`/api/projects/${slug}/dashboard`);

    expect(res.body.totals.chapter_count).toBe(2);
    expect(res.body.totals.word_count).toBe(2); // "Hello world"
    expect(res.body.totals).toHaveProperty("most_recent_edit");
    expect(res.body.totals).toHaveProperty("least_recent_edit");
  });

  it("excludes soft-deleted chapters", async () => {
    const { slug, secondChapterId } = await createProjectWithChapters(t.app);
    await request(t.app).delete(`/api/chapters/${secondChapterId}`);

    const res = await request(t.app).get(`/api/projects/${slug}/dashboard`);

    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.totals.chapter_count).toBe(1);
  });

  it("returns empty dashboard for project with no chapters", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Empty Project", mode: "fiction" });
    const slug = projectRes.body.slug;

    // Delete the auto-created chapter
    const getRes = await request(t.app).get(`/api/projects/${slug}`);
    await request(t.app).delete(`/api/chapters/${getRes.body.chapters[0].id}`);

    const res = await request(t.app).get(`/api/projects/${slug}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.chapters).toHaveLength(0);
    expect(res.body.totals.chapter_count).toBe(0);
    expect(res.body.totals.word_count).toBe(0);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent/dashboard");

    expect(res.status).toBe(404);
  });
});
```

### Step 12: Run test to verify it fails

Run: `npm test -w packages/server -- --grep "dashboard"`

Expected: FAIL (404 — route doesn't exist)

### Step 13: Implement GET /api/projects/:slug/dashboard

Add to `packages/server/src/routes/projects.ts` — new route handler before the `/:slug/trash` handler. Add after the `PUT /:slug/chapters/order` handler:

```ts
router.get(
  "/:slug/dashboard",
  asyncHandler(async (req, res) => {
    const project = await db("projects")
      .where({ slug: req.params.slug })
      .whereNull("deleted_at")
      .first();

    if (!project) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Project not found." },
      });
      return;
    }

    const chapters = await db("chapters")
      .where({ project_id: project.id })
      .whereNull("deleted_at")
      .orderBy("sort_order", "asc")
      .select("id", "title", "status", "word_count", "updated_at", "sort_order");

    // Join with chapter_statuses to get labels
    const chaptersWithLabels = await Promise.all(
      chapters.map(async (ch: Record<string, unknown>) => {
        const statusRow = await db("chapter_statuses")
          .where({ status: ch.status })
          .first();
        return { ...ch, status_label: statusRow?.label ?? ch.status };
      }),
    );

    // Status summary
    const allStatuses = await db("chapter_statuses").orderBy("sort_order");
    const statusSummary: Record<string, number> = {};
    for (const s of allStatuses) {
      statusSummary[s.status] = 0;
    }
    for (const ch of chapters) {
      statusSummary[ch.status as string] = (statusSummary[ch.status as string] ?? 0) + 1;
    }

    // Totals
    const wordCount = chapters.reduce(
      (sum: number, ch: Record<string, unknown>) => sum + Number(ch.word_count),
      0,
    );
    const dates = chapters.map((ch: Record<string, unknown>) => ch.updated_at as string);
    const mostRecentEdit = dates.length > 0
      ? dates.reduce((a: string, b: string) => (a > b ? a : b))
      : null;
    const leastRecentEdit = dates.length > 0
      ? dates.reduce((a: string, b: string) => (a < b ? a : b))
      : null;

    res.json({
      chapters: chaptersWithLabels,
      status_summary: statusSummary,
      totals: {
        word_count: wordCount,
        chapter_count: chapters.length,
        most_recent_edit: mostRecentEdit,
        least_recent_edit: leastRecentEdit,
      },
    });
  }),
);
```

**Important:** This route MUST be registered before `/:slug/trash` to avoid the `dashboard` segment being captured as a slug. Actually, looking at the router, `/:slug/dashboard` and `/:slug/trash` both use `/:slug` as prefix — Express matches the first registered route, so order matters. Place `/:slug/dashboard` before `/:slug/trash`.

### Step 14: Run test to verify it passes

Run: `npm test -w packages/server -- --grep "dashboard"`

Expected: ALL PASS

### Step 15: Run full server test suite

Run: `npm test -w packages/server`

Expected: ALL PASS

### Step 16: Commit

```bash
git add packages/server/src/routes/chapters.ts \
      packages/server/src/routes/projects.ts \
      packages/server/src/routes/chapter-statuses.ts \
      packages/server/src/app.ts \
      packages/server/src/__tests__/chapters.test.ts \
      packages/server/src/__tests__/chapter-statuses.test.ts \
      packages/server/src/__tests__/dashboard.test.ts
git commit -m "feat: add chapter status API, chapter-statuses endpoint, and dashboard endpoint"
```

---

## Task 3: Sidebar Status Badges

**Files:**
- Modify: `packages/client/src/components/Sidebar.tsx`
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/hooks/useProjectEditor.ts`
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/strings.ts`
- Test: `packages/client/src/__tests__/Sidebar.test.tsx`

### Step 1: Add strings for status badges

Add to `packages/client/src/strings.ts` in the `sidebar` section:

```ts
statusLabel: (label: string) => `Chapter status: ${label}`,
statusChanged: (label: string) => `Chapter status changed to ${label}`,
```

Add a new `status` section:

```ts
status: {
  outline: "Outline",
  rough_draft: "Rough Draft",
  revised: "Revised",
  edited: "Edited",
  final: "Final",
},
```

### Step 2: Add API client method for chapter-statuses

Add to `packages/client/src/api/client.ts`:

```ts
import type { ChapterStatusRow } from "@smudge/shared";
```

Add to the `api` object at the top level (not inside `projects` or `chapters`):

```ts
chapterStatuses: {
  list: () => apiFetch<ChapterStatusRow[]>("/chapter-statuses"),
},
```

### Step 3: Add status update to the chapters API client

Modify the `chapters.update` method — it already accepts `{ title?, content? }`. The shared `UpdateChapterSchema` now includes `status`, so update the type:

```ts
update: (id: string, data: { title?: string; content?: Record<string, unknown>; status?: string }) =>
  apiFetch<Chapter>(`/chapters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }),
```

### Step 4: Add handleStatusChange to useProjectEditor

Add to `packages/client/src/hooks/useProjectEditor.ts`:

```ts
const handleStatusChange = useCallback(
  async (chapterId: string, status: string) => {
    // Optimistic update
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        chapters: prev.chapters.map((c) =>
          c.id === chapterId ? { ...c, status } : c,
        ),
      };
    });
    if (activeChapter?.id === chapterId) {
      setActiveChapter((prev) => (prev ? { ...prev, status } : prev));
    }

    try {
      await api.chapters.update(chapterId, { status });
    } catch (err) {
      // Revert on failure — reload from server
      if (slug) {
        try {
          const data = await api.projects.get(slug);
          setProject(data);
        } catch {
          // Silent fail on revert
        }
      }
    }
  },
  [activeChapter, slug],
);
```

Add `handleStatusChange` to the return object.

### Step 5: Add onStatusChange prop to Sidebar

Modify `packages/client/src/components/Sidebar.tsx`:

Add `onStatusChange` to the `SidebarProps` interface:

```ts
onStatusChange: (chapterId: string, status: string) => void;
```

### Step 6: Build the StatusBadge component

Add inside `Sidebar.tsx`, before the `SortableChapterItem` component:

```tsx
const STATUS_COLORS: Record<string, string> = {
  outline: "#8B9E7C",
  rough_draft: "#C07850",
  revised: "#B8973E",
  edited: "#6B7F94",
  final: "#6B4E3D",
};

interface StatusBadgeProps {
  chapter: Chapter;
  statuses: ChapterStatusRow[];
  onStatusChange: (chapterId: string, status: string) => void;
}

function StatusBadge({ chapter, statuses, onStatusChange }: StatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentStatus = statuses.find((s) => s.status === chapter.status);
  const label = currentStatus?.label ?? chapter.status;
  const color = STATUS_COLORS[chapter.status] ?? "#6B7F94";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={STRINGS.sidebar.statusLabel(label)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-text-muted hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring shrink-0"
      >
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="hidden sm:inline truncate max-w-[60px]">{label}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={STRINGS.sidebar.statusLabel(label)}
          className="absolute right-0 top-full mt-1 z-50 bg-bg-primary border border-border rounded shadow-lg py-1 min-w-[140px]"
        >
          {statuses.map((s) => (
            <li
              key={s.status}
              role="option"
              aria-selected={s.status === chapter.status}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange(chapter.id, s.status);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onStatusChange(chapter.id, s.status);
                  setOpen(false);
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-hover ${
                s.status === chapter.status ? "font-medium" : ""
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#6B7F94" }}
                aria-hidden="true"
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Add import at the top of Sidebar.tsx:

```ts
import type { ChapterStatusRow } from "@smudge/shared";
```

### Step 6b: Wire up aria-live announcement for status changes

The Sidebar already has an `aria-live="assertive"` region and an `announcement` state for reorder announcements. Reuse this for status changes.

Add an `onAnnounce` prop to `StatusBadge` (or pass `setAnnouncement` down). When `onStatusChange` is called in the badge, also call:

```ts
setAnnouncement(STRINGS.sidebar.statusChanged(newLabel));
```

This uses the existing `statusChanged` string added in Step 1. The `aria-live` region at the bottom of the Sidebar picks it up automatically.

### Step 7: Add statuses prop and StatusBadge to SortableChapterItem

Add `statuses` and `onStatusChange` to `SortableChapterItemProps`:

```ts
statuses: ChapterStatusRow[];
onStatusChange: (chapterId: string, status: string) => void;
```

In the JSX of `SortableChapterItem`, add the `StatusBadge` between the chapter title button and the delete button:

```tsx
<StatusBadge
  chapter={chapter}
  statuses={statuses}
  onStatusChange={onStatusChange}
/>
```

### Step 8: Thread statuses through Sidebar

Add `statuses` to `SidebarProps`:

```ts
statuses: ChapterStatusRow[];
```

Pass `statuses` and `onStatusChange` to each `SortableChapterItem`.

### Step 9: Load statuses in EditorPage

In `packages/client/src/pages/EditorPage.tsx`, add state and loading:

```tsx
import type { ChapterStatusRow } from "@smudge/shared";

const [statuses, setStatuses] = useState<ChapterStatusRow[]>([]);

useEffect(() => {
  api.chapterStatuses.list().then(setStatuses).catch(console.error);
}, []);
```

Pass `statuses` and `handleStatusChange` to Sidebar:

```tsx
<Sidebar
  project={project}
  activeChapterId={...}
  statuses={statuses}
  onStatusChange={handleStatusChange}
  // ... existing props
/>
```

### Step 10: Write sidebar status badge tests

Add to `packages/client/src/__tests__/Sidebar.test.tsx`:

```tsx
import type { ChapterStatusRow } from "@smudge/shared";

const mockStatuses: ChapterStatusRow[] = [
  { status: "outline", sort_order: 1, label: "Outline" },
  { status: "rough_draft", sort_order: 2, label: "Rough Draft" },
  { status: "revised", sort_order: 3, label: "Revised" },
  { status: "edited", sort_order: 4, label: "Edited" },
  { status: "final", sort_order: 5, label: "Final" },
];
```

Update existing Sidebar test renders to pass `statuses={mockStatuses}` and `onStatusChange={vi.fn()}`.

Add new tests:

```tsx
it("renders status badge for each chapter", () => {
  render(<Sidebar {...defaultProps} statuses={mockStatuses} onStatusChange={vi.fn()} />);
  expect(screen.getByLabelText("Chapter status: Outline")).toBeInTheDocument();
});

it("opens status dropdown on click", async () => {
  render(<Sidebar {...defaultProps} statuses={mockStatuses} onStatusChange={vi.fn()} />);
  await userEvent.click(screen.getByLabelText("Chapter status: Outline"));
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  expect(screen.getAllByRole("option")).toHaveLength(5);
});

it("calls onStatusChange when selecting a status", async () => {
  const onStatusChange = vi.fn();
  render(<Sidebar {...defaultProps} statuses={mockStatuses} onStatusChange={onStatusChange} />);
  await userEvent.click(screen.getByLabelText("Chapter status: Outline"));
  await userEvent.click(screen.getByText("Rough Draft"));
  expect(onStatusChange).toHaveBeenCalledWith(expect.any(String), "rough_draft");
});
```

### Step 11: Run client tests

Run: `npm test -w packages/client`

Expected: ALL PASS

### Step 12: Commit

```bash
git add packages/client/src/components/Sidebar.tsx \
      packages/client/src/api/client.ts \
      packages/client/src/hooks/useProjectEditor.ts \
      packages/client/src/pages/EditorPage.tsx \
      packages/client/src/strings.ts \
      packages/client/src/__tests__/Sidebar.test.tsx
git commit -m "feat: add chapter status badges to sidebar with dropdown picker"
```

---

## Task 4: Resizable Sidebar

**Files:**
- Modify: `packages/client/src/components/Sidebar.tsx`
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Test: `packages/client/src/__tests__/Sidebar.test.tsx`

### Step 1: Write failing tests

Add to `packages/client/src/__tests__/Sidebar.test.tsx`:

```tsx
it("renders resize handle", () => {
  render(<Sidebar {...defaultProps} />);
  expect(screen.getByLabelText("Resize sidebar")).toBeInTheDocument();
});
```

### Step 2: Run test to verify it fails

Run: `npm test -w packages/client -- --grep "resize handle"`

Expected: FAIL

### Step 3: Implement resizable sidebar

The resize logic lives in EditorPage (since it controls the layout), but the drag handle is rendered by Sidebar.

Modify `packages/client/src/components/Sidebar.tsx`:

Add a new prop to `SidebarProps`:

```ts
width: number;
onResize: (width: number) => void;
```

Replace the hardcoded `w-[260px] min-w-[260px]` classes on the `<aside>` with a dynamic style:

```tsx
<aside
  aria-label={STRINGS.a11y.chaptersSidebar}
  style={{ width: `${width}px`, minWidth: `${width}px` }}
  className="border-r border-border bg-bg-sidebar flex flex-col h-full overflow-hidden relative"
>
```

Add a resize handle at the right edge of the sidebar, as the last child inside `<aside>`:

```tsx
<div
  role="separator"
  aria-orientation="vertical"
  aria-label={STRINGS.sidebar.resizeHandle}
  tabIndex={0}
  onMouseDown={(e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    function onMouseMove(e: MouseEvent) {
      const newWidth = Math.min(480, Math.max(180, startWidth + e.clientX - startX));
      onResize(newWidth);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }}
  onKeyDown={(e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onResize(Math.min(480, width + 10));
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onResize(Math.max(180, width - 10));
    }
  }}
  className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-light focus:bg-accent-light focus:outline-none"
/>
```

Add to `strings.ts` in the `sidebar` section:

```ts
resizeHandle: "Resize sidebar",
```

### Step 4: Wire up resize state in EditorPage

In `packages/client/src/pages/EditorPage.tsx`:

```tsx
const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_KEY = "smudge:sidebar-width";

function getSavedSidebarWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (saved) {
      const parsed = Number(saved);
      if (parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH) return parsed;
    }
  } catch {
    // localStorage unavailable
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

// Inside EditorPage component:
const [sidebarWidth, setSidebarWidth] = useState(getSavedSidebarWidth);

const handleSidebarResize = useCallback((width: number) => {
  setSidebarWidth(width);
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // localStorage unavailable
  }
}, []);
```

Pass to Sidebar:

```tsx
<Sidebar
  width={sidebarWidth}
  onResize={handleSidebarResize}
  // ... other props
/>
```

### Step 5: Run tests

Run: `npm test -w packages/client`

Expected: ALL PASS (update any existing Sidebar tests that need the new `width` and `onResize` props)

### Step 6: Commit

```bash
git add packages/client/src/components/Sidebar.tsx \
      packages/client/src/pages/EditorPage.tsx \
      packages/client/src/strings.ts \
      packages/client/src/__tests__/Sidebar.test.tsx
git commit -m "feat: add resizable sidebar with drag handle and localStorage persistence"
```

---

## Task 5: Refactor to Peer Tabs + Dashboard View

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/components/PreviewMode.tsx`
- Create: `packages/client/src/components/DashboardView.tsx`
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/strings.ts`
- Test: `packages/client/src/__tests__/EditorPageFeatures.test.tsx`
- Test: `packages/client/src/__tests__/PreviewMode.test.tsx`
- Test: `packages/client/src/__tests__/DashboardView.test.tsx`

### Step 1: Add strings

Add to `packages/client/src/strings.ts`:

In `nav` section:

```ts
editor: "Editor",
dashboard: "Dashboard",
```

Add a new `dashboard` section:

```ts
dashboard: {
  heading: "Manuscript Dashboard",
  totalWordCount: (count: number) => `${count.toLocaleString()} words`,
  totalChapters: (count: number) => `${count} ${count === 1 ? "chapter" : "chapters"}`,
  mostRecentEdit: (dateStr: string, title: string) => {
    const date = new Date(dateStr);
    const relative = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Most recent: ${relative} — ${title}`;
  },
  leastRecentEdit: (dateStr: string, title: string) => {
    const date = new Date(dateStr);
    const relative = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Least recent: ${relative} — ${title}`;
  },
  emptyState: "No chapters yet. Add one to start writing.",
  columnTitle: "Title",
  columnStatus: "Status",
  columnWordCount: "Words",
  columnLastEdited: "Last Edited",
},
```

### Step 2: Add dashboard API method

Add to `packages/client/src/api/client.ts`, inside the `projects` object:

```ts
dashboard: (slug: string) =>
  apiFetch<{
    chapters: Array<{
      id: string;
      title: string;
      status: string;
      status_label: string;
      word_count: number;
      updated_at: string;
      sort_order: number;
    }>;
    status_summary: Record<string, number>;
    totals: {
      word_count: number;
      chapter_count: number;
      most_recent_edit: string | null;
      least_recent_edit: string | null;
    };
  }>(`/projects/${slug}/dashboard`),
```

### Step 3: Refactor EditorPage to use tabs

Replace the preview overlay pattern in `packages/client/src/pages/EditorPage.tsx` with a tab-based approach.

Replace the `previewOpen` state with:

```tsx
type ViewMode = "editor" | "preview" | "dashboard";
const [viewMode, setViewMode] = useState<ViewMode>("editor");
```

Replace the Preview button in the header with tab buttons:

```tsx
<div className="flex items-center gap-1">
  {(["editor", "preview", "dashboard"] as const).map((mode) => (
    <button
      key={mode}
      onClick={() => {
        if (mode !== "editor") editorRef.current?.flushSave();
        setViewMode(mode);
      }}
      className={`text-sm px-3 py-1 rounded focus:outline-none focus:ring-2 focus:ring-focus-ring ${
        viewMode === mode
          ? "bg-accent-light text-accent font-medium"
          : "text-text-secondary hover:text-text-primary"
      }`}
      aria-current={viewMode === mode ? "page" : undefined}
    >
      {mode === "editor"
        ? STRINGS.nav.editor
        : mode === "preview"
          ? STRINGS.nav.preview
          : STRINGS.nav.dashboard}
    </button>
  ))}
</div>
```

Replace the main content area conditional rendering. Instead of the overlay-based PreviewMode, render based on `viewMode`:

```tsx
{viewMode === "editor" && !trashOpen && (
  <main className="flex-1 overflow-y-auto px-6 py-8" aria-label={STRINGS.a11y.mainContent}>
    {/* chapter title + editor — existing code */}
  </main>
)}

{viewMode === "editor" && trashOpen && (
  <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
    <TrashView ... />
  </main>
)}

{viewMode === "preview" && (
  <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
    <PreviewMode
      chapters={project.chapters}
      onNavigateToChapter={(chapterId) => {
        setViewMode("editor");
        handleSelectChapterWithFlush(chapterId);
      }}
    />
  </main>
)}

{viewMode === "dashboard" && (
  <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
    <DashboardView
      slug={project.slug}
      statuses={statuses}
      onNavigateToChapter={(chapterId) => {
        setViewMode("editor");
        handleSelectChapterWithFlush(chapterId);
      }}
    />
  </main>
)}
```

Remove the `previewOpen` state and the `{previewOpen && <PreviewMode ... />}` overlay at the bottom of the component.

### Step 4: Refactor PreviewMode to non-overlay

Modify `packages/client/src/components/PreviewMode.tsx`:

- Remove `onClose` from props
- Remove the `fixed inset-0 z-40` wrapper div — it's no longer an overlay
- Remove the "Back to Editor" button (tabs handle navigation now)
- Remove the Escape key handler
- Keep the chapter content rendering and TOC panel
- The component just renders inline content now

Updated interface:

```ts
interface PreviewModeProps {
  chapters: Chapter[];
  onNavigateToChapter: (chapterId: string) => void;
}
```

### Step 5: Create DashboardView component

Create `packages/client/src/components/DashboardView.tsx`:

```tsx
import { useEffect, useState, useCallback } from "react";
import type { ChapterStatusRow } from "@smudge/shared";
import { api } from "../api/client";
import { STRINGS } from "../strings";

const STATUS_COLORS: Record<string, string> = {
  outline: "#8B9E7C",
  rough_draft: "#C07850",
  revised: "#B8973E",
  edited: "#6B7F94",
  final: "#6B4E3D",
};

interface DashboardData {
  chapters: Array<{
    id: string;
    title: string;
    status: string;
    status_label: string;
    word_count: number;
    updated_at: string;
    sort_order: number;
  }>;
  status_summary: Record<string, number>;
  totals: {
    word_count: number;
    chapter_count: number;
    most_recent_edit: string | null;
    least_recent_edit: string | null;
  };
}

type SortKey = "sort_order" | "title" | "status" | "word_count" | "updated_at";
type SortDir = "asc" | "desc";

interface DashboardViewProps {
  slug: string;
  statuses: ChapterStatusRow[];
  onNavigateToChapter: (chapterId: string) => void;
}

export function DashboardView({ slug, statuses, onNavigateToChapter }: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sort_order");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    api.projects.dashboard(slug).then(setData).catch(console.error);
  }, [slug]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  if (!data) return null;

  const { chapters, status_summary, totals } = data;

  // Sort chapters
  const sorted = [...chapters].sort((a, b) => {
    const key = sortKey as keyof typeof a;
    const av = a[key];
    const bv = b[key];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : Number(av) - Number(bv);
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Find chapter names for most/least recent
  const mostRecentChapter = chapters.reduce(
    (best, ch) => (!best || ch.updated_at > best.updated_at ? ch : best),
    null as DashboardData["chapters"][0] | null,
  );
  const leastRecentChapter = chapters.reduce(
    (best, ch) => (!best || ch.updated_at < best.updated_at ? ch : best),
    null as DashboardData["chapters"][0] | null,
  );

  if (chapters.length === 0) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-8">
        <h2 className="text-xl font-serif text-text-primary mb-6">
          {STRINGS.dashboard.heading}
        </h2>
        <div className="flex gap-6 text-sm text-text-secondary mb-8">
          <span>{STRINGS.dashboard.totalWordCount(0)}</span>
          <span>{STRINGS.dashboard.totalChapters(0)}</span>
        </div>
        <p className="text-text-muted">{STRINGS.dashboard.emptyState}</p>
      </div>
    );
  }

  // Status bar total for proportions
  const totalChapters = chapters.length;

  return (
    <div className="mx-auto max-w-[720px] px-6 py-8">
      <h2 className="text-xl font-serif text-text-primary mb-6">
        {STRINGS.dashboard.heading}
      </h2>

      {/* Manuscript health bar */}
      <div className="flex flex-wrap gap-6 text-sm text-text-secondary mb-6">
        <span>{STRINGS.dashboard.totalWordCount(totals.word_count)}</span>
        <span>{STRINGS.dashboard.totalChapters(totals.chapter_count)}</span>
        {totals.most_recent_edit && mostRecentChapter && (
          <span>
            {STRINGS.dashboard.mostRecentEdit(totals.most_recent_edit, mostRecentChapter.title)}
          </span>
        )}
        {totals.least_recent_edit && leastRecentChapter && (
          <span>
            {STRINGS.dashboard.leastRecentEdit(totals.least_recent_edit, leastRecentChapter.title)}
          </span>
        )}
      </div>

      {/* Status summary bar */}
      <div className="mb-2 h-3 flex rounded overflow-hidden" role="img" aria-label="Chapter status distribution">
        {statuses.map((s) => {
          const count = status_summary[s.status] ?? 0;
          if (count === 0) return null;
          const pct = (count / totalChapters) * 100;
          return (
            <div
              key={s.status}
              style={{
                width: `${pct}%`,
                backgroundColor: STATUS_COLORS[s.status] ?? "#6B7F94",
              }}
              title={`${s.label}: ${count}`}
              className="flex items-center justify-center text-[10px] text-white font-medium"
            >
              {pct > 8 ? count : ""}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-muted mb-8">
        {statuses
          .map((s) => `${status_summary[s.status] ?? 0} ${s.label}`)
          .join(" / ")}
      </p>

      {/* Chapter table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-secondary">
            {(
              [
                ["title", STRINGS.dashboard.columnTitle],
                ["status", STRINGS.dashboard.columnStatus],
                ["word_count", STRINGS.dashboard.columnWordCount],
                ["updated_at", STRINGS.dashboard.columnLastEdited],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <th
                key={key}
                className="py-2 px-2 font-medium cursor-pointer hover:text-text-primary"
              >
                <button
                  type="button"
                  onClick={() => handleSort(key)}
                  className="focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
                >
                  {label}
                  {sortKey === key && (sortDir === "asc" ? " \u2191" : " \u2193")}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((ch, i) => (
            <tr
              key={ch.id}
              className={`border-b border-border/50 ${i % 2 === 1 ? "bg-bg-hover/30" : ""}`}
            >
              <td className="py-2.5 px-2">
                <button
                  type="button"
                  onClick={() => onNavigateToChapter(ch.id)}
                  className="text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
                >
                  {ch.title}
                </button>
              </td>
              <td className="py-2.5 px-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: STATUS_COLORS[ch.status] ?? "#6B7F94",
                    }}
                    aria-hidden="true"
                  />
                  {ch.status_label}
                </span>
              </td>
              <td className="py-2.5 px-2 text-text-muted">
                {ch.word_count.toLocaleString()}
              </td>
              <td className="py-2.5 px-2 text-text-muted">
                {new Date(ch.updated_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Step 6: Update keyboard shortcut handler

In `EditorPage.tsx`, update the Ctrl+Shift+P handler to toggle between editor and preview (instead of the old overlay toggle):

```ts
if (ctrl && e.shiftKey && e.key === "P") {
  e.preventDefault();
  editorRef.current?.flushSave();
  setViewMode((prev) => (prev === "preview" ? "editor" : "preview"));
  return;
}
```

### Step 7: Write DashboardView tests

Create `packages/client/src/__tests__/DashboardView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardView } from "../components/DashboardView";
import { api } from "../api/client";
import type { ChapterStatusRow } from "@smudge/shared";

vi.mock("../api/client");

const mockStatuses: ChapterStatusRow[] = [
  { status: "outline", sort_order: 1, label: "Outline" },
  { status: "rough_draft", sort_order: 2, label: "Rough Draft" },
  { status: "revised", sort_order: 3, label: "Revised" },
  { status: "edited", sort_order: 4, label: "Edited" },
  { status: "final", sort_order: 5, label: "Final" },
];

const mockDashboardData = {
  chapters: [
    {
      id: "ch1",
      title: "Chapter 1",
      status: "rough_draft",
      status_label: "Rough Draft",
      word_count: 5000,
      updated_at: "2026-03-28T10:00:00Z",
      sort_order: 0,
    },
    {
      id: "ch2",
      title: "Chapter 2",
      status: "outline",
      status_label: "Outline",
      word_count: 0,
      updated_at: "2026-03-25T10:00:00Z",
      sort_order: 1,
    },
  ],
  status_summary: {
    outline: 1,
    rough_draft: 1,
    revised: 0,
    edited: 0,
    final: 0,
  },
  totals: {
    word_count: 5000,
    chapter_count: 2,
    most_recent_edit: "2026-03-28T10:00:00Z",
    least_recent_edit: "2026-03-25T10:00:00Z",
  },
};

beforeEach(() => {
  vi.mocked(api.projects.dashboard).mockResolvedValue(mockDashboardData);
});

describe("DashboardView", () => {
  it("renders manuscript health bar", async () => {
    render(
      <DashboardView
        slug="test-project"
        statuses={mockStatuses}
        onNavigateToChapter={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("5,000 words")).toBeInTheDocument();
      expect(screen.getByText("2 chapters")).toBeInTheDocument();
    });
  });

  it("renders chapter table with all rows", async () => {
    render(
      <DashboardView
        slug="test-project"
        statuses={mockStatuses}
        onNavigateToChapter={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter 1")).toBeInTheDocument();
      expect(screen.getByText("Chapter 2")).toBeInTheDocument();
    });
  });

  it("navigates to chapter on title click", async () => {
    const onNavigate = vi.fn();
    render(
      <DashboardView
        slug="test-project"
        statuses={mockStatuses}
        onNavigateToChapter={onNavigate}
      />,
    );

    await waitFor(() => screen.getByText("Chapter 1"));
    await userEvent.click(screen.getByText("Chapter 1"));
    expect(onNavigate).toHaveBeenCalledWith("ch1");
  });

  it("renders status summary text", async () => {
    render(
      <DashboardView
        slug="test-project"
        statuses={mockStatuses}
        onNavigateToChapter={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/1 Outline.*1 Rough Draft/)).toBeInTheDocument();
    });
  });

  it("renders empty state when no chapters", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue({
      chapters: [],
      status_summary: { outline: 0, rough_draft: 0, revised: 0, edited: 0, final: 0 },
      totals: { word_count: 0, chapter_count: 0, most_recent_edit: null, least_recent_edit: null },
    });

    render(
      <DashboardView
        slug="test-project"
        statuses={mockStatuses}
        onNavigateToChapter={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No chapters yet. Add one to start writing.")).toBeInTheDocument();
    });
  });
});
```

### Step 8: Update PreviewMode tests

Update `packages/client/src/__tests__/PreviewMode.test.tsx` to remove references to `onClose`, the overlay wrapper, and the Escape key behavior. Update test setup to not pass `onClose`.

### Step 9: Update EditorPageFeatures tests

Update `packages/client/src/__tests__/EditorPageFeatures.test.tsx` to account for the tab-based navigation instead of the preview overlay.

### Step 10: Run all client tests

Run: `npm test -w packages/client`

Expected: ALL PASS

### Step 11: Commit

```bash
git add packages/client/src/pages/EditorPage.tsx \
      packages/client/src/components/PreviewMode.tsx \
      packages/client/src/components/DashboardView.tsx \
      packages/client/src/api/client.ts \
      packages/client/src/strings.ts \
      packages/client/src/__tests__/DashboardView.test.tsx \
      packages/client/src/__tests__/PreviewMode.test.tsx \
      packages/client/src/__tests__/EditorPageFeatures.test.tsx
git commit -m "feat: refactor to peer tabs (Editor/Preview/Dashboard) and add dashboard view"
```

---

## Task 6: Chapter Navigation Shortcuts

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/strings.ts`
- Test: `packages/client/src/__tests__/KeyboardShortcuts.test.tsx`

### Step 1: Add strings

Add to `packages/client/src/strings.ts` in the `shortcuts` section:

```ts
prevChapter: "Previous chapter",
nextChapter: "Next chapter",
```

Add to `sidebar` section:

```ts
navigatedToChapter: (title: string) => `Navigated to ${title}`,
```

### Step 2: Write failing tests

Add to `packages/client/src/__tests__/KeyboardShortcuts.test.tsx`:

```tsx
it("Ctrl+Shift+ArrowDown navigates to next chapter", async () => {
  // Render EditorPage with a project that has multiple chapters
  // Fire Ctrl+Shift+ArrowDown
  // Assert that handleSelectChapter was called with the next chapter's id
});

it("Ctrl+Shift+ArrowUp navigates to previous chapter", async () => {
  // Similar test for previous chapter
});

it("Ctrl+Shift+ArrowDown does nothing on last chapter", async () => {
  // Assert no navigation
});

it("Ctrl+Shift+ArrowUp does nothing on first chapter", async () => {
  // Assert no navigation
});
```

The exact test implementation depends on the existing test patterns in `KeyboardShortcuts.test.tsx`. Read that file to match the setup pattern.

### Step 3: Implement chapter navigation shortcuts

In `packages/client/src/pages/EditorPage.tsx`, add to the `handleKeyDown` effect:

```ts
if (ctrl && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
  if (viewMode !== "editor" || !activeChapter || !project) return;
  e.preventDefault();

  const chapters = project.chapters;
  const currentIndex = chapters.findIndex((c) => c.id === activeChapter.id);
  if (currentIndex === -1) return;

  const nextIndex = e.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= chapters.length) return;

  handleSelectChapterWithFlush(chapters[nextIndex].id);
  return;
}
```

Add `viewMode`, `activeChapter`, and `project` to the effect's dependency array, and also `handleSelectChapterWithFlush`.

### Step 4: Add to keyboard shortcuts dialog

In the shortcuts help dialog in EditorPage.tsx, add entries:

```tsx
<div className="flex justify-between">
  <dt className="text-text-secondary">{STRINGS.shortcuts.prevChapter}</dt>
  <dd className="font-mono text-text-muted">Ctrl+Shift+\u2191</dd>
</div>
<div className="flex justify-between">
  <dt className="text-text-secondary">{STRINGS.shortcuts.nextChapter}</dt>
  <dd className="font-mono text-text-muted">Ctrl+Shift+\u2193</dd>
</div>
```

### Step 5: Add screen reader announcement

Add an aria-live announcement when switching chapters via shortcuts. Use the existing `announcement` pattern or add one to EditorPage:

```tsx
const [navAnnouncement, setNavAnnouncement] = useState("");
```

In the shortcut handler, after calling `handleSelectChapterWithFlush`:

```ts
setNavAnnouncement(STRINGS.sidebar.navigatedToChapter(chapters[nextIndex].title));
```

Add to the JSX:

```tsx
<div aria-live="polite" className="sr-only">{navAnnouncement}</div>
```

### Step 6: Run all tests

Run: `npm test -w packages/client`

Expected: ALL PASS

### Step 7: Run full test suite

Run: `npm test -w packages/shared && npm test -w packages/server && npm test -w packages/client`

Expected: ALL PASS

### Step 8: Commit

```bash
git add packages/client/src/pages/EditorPage.tsx \
      packages/client/src/strings.ts \
      packages/client/src/__tests__/KeyboardShortcuts.test.tsx
git commit -m "feat: add Ctrl+Shift+Arrow chapter navigation shortcuts"
```

---

## Task 7: E2e Tests (Playwright)

**Files:**
- Create: `e2e/dashboard.spec.ts`
- Modify: existing Playwright config if needed

### Step 1: Write e2e test — change chapter status

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Writer's Dashboard - Phase 1", () => {
  test.beforeEach(async ({ page }) => {
    // Create a project with chapters via the UI or API setup
    await page.goto("/");
    // ... project creation setup
  });

  test("change chapter status from sidebar persists after reload", async ({ page }) => {
    // Click the status badge on a chapter
    await page.getByLabel(/Chapter status:/).first().click();
    // Select "Rough Draft" from dropdown
    await page.getByRole("option", { name: "Rough Draft" }).click();
    // Verify badge updated
    await expect(page.getByLabel("Chapter status: Rough Draft")).toBeVisible();
    // Reload and verify persistence
    await page.reload();
    await expect(page.getByLabel("Chapter status: Rough Draft")).toBeVisible();
  });

  test("dashboard shows chapter table and navigates to editor on click", async ({ page }) => {
    // Click Dashboard tab
    await page.getByRole("button", { name: "Dashboard" }).click();
    // Verify chapter table is visible
    await expect(page.getByText("Manuscript Dashboard")).toBeVisible();
    // Click a chapter title
    await page.getByRole("button", { name: /Untitled Chapter/ }).click();
    // Verify we're back in editor mode
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("Ctrl+Shift+ArrowDown navigates to next chapter", async ({ page }) => {
    // Add a second chapter
    await page.getByRole("button", { name: "Add Chapter" }).click();
    // Focus editor, use shortcut
    await page.getByRole("textbox").focus();
    await page.keyboard.press("Control+Shift+ArrowDown");
    // Verify the second chapter is now active
    // (check sidebar active state or chapter title)
  });

  test("aXe accessibility audit on dashboard view", async ({ page }) => {
    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.getByText("Manuscript Dashboard")).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("aXe accessibility audit on sidebar with status badges", async ({ page }) => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
```

**Note:** The exact test setup (creating projects/chapters) depends on the existing e2e test infrastructure. Read existing Playwright tests in `e2e/` to match the pattern. If no e2e tests exist yet, set up the basic Playwright config and a test helper that creates test data via the API.

### Step 2: Run e2e tests

Run: `npx playwright test e2e/dashboard.spec.ts`

Expected: ALL PASS

### Step 3: Commit

```bash
git add e2e/dashboard.spec.ts
git commit -m "test: add Playwright e2e tests for dashboard, status badges, and a11y"
```

---

## Post-Implementation Checklist

After all tasks are complete:

1. Run `make all` (lint + format + test) to confirm everything passes
2. Manual smoke test: create a project, change chapter statuses, view dashboard, resize sidebar, use Ctrl+Shift+↑/↓ to navigate
3. Check accessibility: tab through status badges, use keyboard to resize sidebar, screen reader announcements work
4. Review with `paad:agentic-review` before merging
