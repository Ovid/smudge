# Project Slugs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace UUID-based project URLs with human-readable slugs derived from project titles.

**Architecture:** Add a `slug` column to the projects table, create a shared `generateSlug()` utility, switch all project API endpoints from `:id` to `:slug`, and update the React client to use slugs for routing and API calls. UUIDs remain as internal primary keys.

**Tech Stack:** TypeScript, better-sqlite3/Knex.js (migration), Vitest (tests), React Router, Express

---

### Task 1: generateSlug — failing tests

**Files:**
- Create: `packages/shared/src/__tests__/slugify.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { generateSlug } from "../slugify";

describe("generateSlug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(generateSlug("My Novel")).toBe("my-novel");
  });

  it("transliterates accented characters", () => {
    expect(generateSlug("Café Début")).toBe("cafe-debut");
  });

  it("strips non-alphanumeric characters", () => {
    expect(generateSlug("The Cat's Meow!!")).toBe("the-cats-meow");
  });

  it("collapses consecutive hyphens", () => {
    expect(generateSlug("My---Novel")).toBe("my-novel");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateSlug("--hello--")).toBe("hello");
  });

  it("falls back to 'untitled' for empty result", () => {
    expect(generateSlug("!!!")).toBe("untitled");
    expect(generateSlug("")).toBe("untitled");
  });

  it("handles mixed unicode and ascii", () => {
    expect(generateSlug("Chapter 1: Début")).toBe("chapter-1-debut");
  });

  it("handles already-clean input", () => {
    expect(generateSlug("simple")).toBe("simple");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/shared -- --run slugify`
Expected: FAIL — module `../slugify` does not exist

---

### Task 2: generateSlug — implementation

**Files:**
- Create: `packages/shared/src/slugify.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Implement generateSlug**

```typescript
export function generateSlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "untitled";
}
```

**Step 2: Export from index.ts**

Add to `packages/shared/src/index.ts`:
```typescript
export { generateSlug } from "./slugify";
```

**Step 3: Run tests to verify they pass**

Run: `npm test -w packages/shared -- --run slugify`
Expected: All 8 tests PASS

**Step 4: Commit**

```bash
git add packages/shared/src/slugify.ts packages/shared/src/__tests__/slugify.test.ts packages/shared/src/index.ts
git commit -m "feat: add generateSlug utility to shared package"
```

---

### Task 3: resolveUniqueSlug — failing tests

**Files:**
- Create: `packages/server/src/__tests__/resolve-slug.test.ts`

This tests the server-side helper that appends `-2`, `-3`, etc. on slug collision. It needs a database to check existing slugs.

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import { resolveUniqueSlug } from "../routes/resolve-slug";

const t = setupTestDb();

describe("resolveUniqueSlug", () => {
  it("returns the base slug when no collision", async () => {
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel");
  });

  it("appends -2 on first collision", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1", title: "My Novel", slug: "my-novel",
      mode: "fiction", created_at: now, updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel-2");
  });

  it("appends -3 when -2 is also taken", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1", title: "My Novel", slug: "my-novel",
      mode: "fiction", created_at: now, updated_at: now,
    });
    await t.db("projects").insert({
      id: "p2", title: "My Novel 2", slug: "my-novel-2",
      mode: "fiction", created_at: now, updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel-3");
  });

  it("ignores soft-deleted projects for collision", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1", title: "My Novel", slug: "my-novel",
      mode: "fiction", created_at: now, updated_at: now, deleted_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel");
  });

  it("excludes a specific project id when provided", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1", title: "My Novel", slug: "my-novel",
      mode: "fiction", created_at: now, updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel", "p1");
    expect(slug).toBe("my-novel");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run resolve-slug`
Expected: FAIL — module `../routes/resolve-slug` does not exist

**Note:** These tests will also fail because the `slug` column doesn't exist yet. Task 4 (migration) must run before these tests can pass.

---

### Task 4: Migration — add slug column

**Files:**
- Create: `packages/server/src/db/migrations/002_add_project_slugs.js`

**Step 1: Write the migration**

```javascript
import { generateSlug } from "@smudge/shared";

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // Add slug column (nullable first for backfill)
  await knex.schema.alterTable("projects", (table) => {
    table.string("slug").nullable();
  });

  // Backfill existing projects
  const projects = await knex("projects").select("id", "title");
  for (const project of projects) {
    const baseSlug = generateSlug(project.title);
    // Simple collision resolution for backfill
    let slug = baseSlug;
    let suffix = 2;
    while (true) {
      const existing = await knex("projects")
        .where({ slug })
        .whereNot({ id: project.id })
        .whereNull("deleted_at")
        .first();
      if (!existing) break;
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }
    await knex("projects").where({ id: project.id }).update({ slug });
  }

  // Make slug NOT NULL after backfill
  // SQLite doesn't support ALTER COLUMN, so we use raw SQL
  // The column is already populated, so we add the partial unique indexes
  await knex.raw(`
    CREATE UNIQUE INDEX idx_projects_slug_active
    ON projects(slug)
    WHERE deleted_at IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_projects_title_active
    ON projects(title)
    WHERE deleted_at IS NULL
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS idx_projects_slug_active");
  await knex.raw("DROP INDEX IF EXISTS idx_projects_title_active");

  // SQLite doesn't support DROP COLUMN in older versions,
  // but better-sqlite3 with recent SQLite does
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("slug");
  });
}
```

**Step 2: Run the migration in tests**

Run: `npm test -w packages/server -- --run resolve-slug`
Expected: FAIL — `resolveUniqueSlug` module still doesn't exist (but migration runs via test-helpers `migrate.latest()`)

**Step 3: Commit**

```bash
git add packages/server/src/db/migrations/002_add_project_slugs.js
git commit -m "feat: add migration for project slug column with partial unique indexes"
```

---

### Task 5: resolveUniqueSlug — implementation

**Files:**
- Create: `packages/server/src/routes/resolve-slug.ts`

**Step 1: Implement resolveUniqueSlug**

```typescript
import type { Knex } from "knex";

export async function resolveUniqueSlug(
  db: Knex,
  baseSlug: string,
  excludeProjectId?: string,
): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;

  while (true) {
    const query = db("projects").where({ slug }).whereNull("deleted_at");
    if (excludeProjectId) {
      query.whereNot({ id: excludeProjectId });
    }
    const existing = await query.first();
    if (!existing) return slug;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
}
```

**Step 2: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run resolve-slug`
Expected: All 5 tests PASS

**Step 3: Commit**

```bash
git add packages/server/src/routes/resolve-slug.ts packages/server/src/__tests__/resolve-slug.test.ts
git commit -m "feat: add resolveUniqueSlug helper for slug collision resolution"
```

---

### Task 6: Update shared types and schemas

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`

**Step 1: Add slug to Project and ProjectListItem**

In `packages/shared/src/types.ts`, add `slug: string` to both interfaces:

```typescript
export interface Project {
  id: string;
  slug: string;          // <-- add
  title: string;
  mode: ProjectMode;
  // ...
}

export interface ProjectListItem {
  id: string;
  slug: string;          // <-- add
  title: string;
  mode: ProjectMode;
  total_word_count: number;
  updated_at: string;
}
```

**Step 2: No Zod schema changes needed for input**

The `CreateProjectSchema` and `UpdateProjectSchema` accept a `title` — the server generates the slug. No slug field in request bodies. Response shapes are defined by TypeScript interfaces, not Zod schemas in this codebase.

**Step 3: Run existing tests to verify nothing breaks**

Run: `npm test -w packages/shared -- --run`
Expected: All existing tests PASS (type changes don't break runtime)

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add slug field to Project and ProjectListItem types"
```

---

### Task 7: Update server project routes — failing tests

**Files:**
- Modify: `packages/server/src/__tests__/projects.test.ts`

This is a large task — rewrite all project tests to use slugs instead of UUIDs. The key changes:

1. `POST /api/projects` response now includes `slug` — assert it
2. All `/:id` endpoints become `/:slug` — use `createRes.body.slug` instead of `createRes.body.id`
3. Add tests for title uniqueness (duplicate title → 400 `PROJECT_TITLE_EXISTS`)
4. Add tests for slug regeneration on rename
5. `GET /api/projects` response items now include `slug`

**Step 1: Rewrite the test file**

Replace the entire test file. Key changes per describe block:

**POST /api/projects:**
```typescript
it("creates a project and returns 201 with slug", async () => {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: "My Novel", mode: "fiction" });

  expect(res.status).toBe(201);
  expect(res.body.slug).toBe("my-novel");
  expect(res.body.title).toBe("My Novel");
});

it("returns 400 when title duplicates an existing project", async () => {
  await request(t.app).post("/api/projects").send({ title: "My Novel", mode: "fiction" });
  const res = await request(t.app).post("/api/projects").send({ title: "My Novel", mode: "fiction" });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("PROJECT_TITLE_EXISTS");
});
```

**GET /api/projects:**
```typescript
it("returns projects with slug field", async () => {
  await request(t.app).post("/api/projects").send({ title: "First", mode: "fiction" });
  const res = await request(t.app).get("/api/projects");

  expect(res.body[0].slug).toBe("first");
});
```

**All `:id` endpoints switch to `:slug`:**
```typescript
// Before:
const res = await request(t.app).get(`/api/projects/${createRes.body.id}`);
// After:
const res = await request(t.app).get(`/api/projects/${createRes.body.slug}`);
```

**PATCH /api/projects/:slug — slug regeneration:**
```typescript
it("returns updated slug when title changes", async () => {
  const createRes = await request(t.app)
    .post("/api/projects")
    .send({ title: "Old Name", mode: "fiction" });

  const res = await request(t.app)
    .patch(`/api/projects/${createRes.body.slug}`)
    .send({ title: "New Name" });

  expect(res.status).toBe(200);
  expect(res.body.title).toBe("New Name");
  expect(res.body.slug).toBe("new-name");
});

it("returns 400 when renaming to a duplicate title", async () => {
  await request(t.app).post("/api/projects").send({ title: "First", mode: "fiction" });
  const second = await request(t.app).post("/api/projects").send({ title: "Second", mode: "fiction" });

  const res = await request(t.app)
    .patch(`/api/projects/${second.body.slug}`)
    .send({ title: "First" });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("PROJECT_TITLE_EXISTS");
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run projects`
Expected: FAIL — routes still use `:id` and don't return `slug`

---

### Task 8: Update server project routes — implementation

**Files:**
- Modify: `packages/server/src/routes/projects.ts`

**Step 1: Update imports**

Add at the top of `projects.ts`:
```typescript
import { generateSlug } from "@smudge/shared";
import { resolveUniqueSlug } from "./resolve-slug";
```

**Step 2: Update POST / (create)**

After validation, before inserting:
```typescript
// Check title uniqueness
const existingTitle = await db("projects")
  .where({ title })
  .whereNull("deleted_at")
  .first();
if (existingTitle) {
  res.status(400).json({
    error: { code: "PROJECT_TITLE_EXISTS", message: "A project with that title already exists" },
  });
  return;
}

const slug = await resolveUniqueSlug(db, generateSlug(title));
```

Add `slug` to the project insert:
```typescript
await trx("projects").insert({
  id: projectId, title, slug, mode, created_at: now, updated_at: now,
});
```

**Step 3: Update GET / (list)**

Add `"projects.slug"` to the `.select(...)` call.

**Step 4: Change all `:id` params to `:slug`**

For every route (`PATCH /:id`, `GET /:id`, `POST /:id/chapters`, `PUT /:id/chapters/order`, `GET /:id/trash`, `DELETE /:id`):

1. Change route path from `/:id` to `/:slug`
2. Replace `req.params.id` lookups: instead of `.where({ id: req.params.id })`, use `.where({ slug: req.params.slug }).whereNull("deleted_at")` to find the project, then use `project.id` for any subsequent operations that need the UUID (chapter queries, updates, etc.)

**Step 5: Update PATCH /:slug specifically**

After title validation and project lookup, add title uniqueness check and slug regeneration:
```typescript
const { title } = parsed.data;

// Check title uniqueness (exclude current project)
const existingTitle = await db("projects")
  .where({ title })
  .whereNull("deleted_at")
  .whereNot({ id: project.id })
  .first();
if (existingTitle) {
  res.status(400).json({
    error: { code: "PROJECT_TITLE_EXISTS", message: "A project with that title already exists" },
  });
  return;
}

const newSlug = await resolveUniqueSlug(db, generateSlug(title), project.id);

await db("projects")
  .where({ id: project.id })
  .update({ title, slug: newSlug, updated_at: new Date().toISOString() });
```

**Step 6: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run projects`
Expected: All tests PASS

**Step 7: Run full test suite**

Run: `npm test`
Expected: All tests PASS across all packages

**Step 8: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/projects.test.ts
git commit -m "feat: switch project API endpoints from UUID to slug"
```

---

### Task 9: Update client API client

**Files:**
- Modify: `packages/client/src/api/client.ts`

**Step 1: Update project methods to use slug**

Change parameter names from `id` to `slug` for all project methods:

```typescript
projects: {
  list: () => apiFetch<ProjectListItem[]>("/projects"),
  get: (slug: string) => apiFetch<ProjectWithChapters>(`/projects/${slug}`),
  create: (input: CreateProjectInput) =>
    apiFetch<Project>("/projects", { method: "POST", body: JSON.stringify(input) }),
  update: (slug: string, data: { title?: string }) =>
    apiFetch<Project>(`/projects/${slug}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (slug: string) =>
    apiFetch<{ message: string }>(`/projects/${slug}`, { method: "DELETE" }),
  reorderChapters: (slug: string, chapterIds: string[]) =>
    apiFetch<{ message: string }>(`/projects/${slug}/chapters/order`, {
      method: "PUT", body: JSON.stringify({ chapter_ids: chapterIds }),
    }),
  trash: (slug: string) => apiFetch<Chapter[]>(`/projects/${slug}/trash`),
},
```

**Step 2: Update chapters.create to use slug**

```typescript
chapters: {
  // ...
  create: (projectSlug: string) =>
    apiFetch<Chapter>(`/projects/${projectSlug}/chapters`, { method: "POST" }),
  // ...
},
```

**Step 3: Commit**

```bash
git add packages/client/src/api/client.ts
git commit -m "refactor: update API client to use slugs for project endpoints"
```

---

### Task 10: Update client routing and pages

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/pages/HomePage.tsx`
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/hooks/useProjectEditor.ts`

**Step 1: Update App.tsx route**

```typescript
<Route path="/projects/:slug" element={<EditorPage />} />
```

**Step 2: Update HomePage.tsx**

Change navigation to use slug:
```typescript
// In handleCreate:
navigate(`/projects/${project.slug}`);

// In project list button onClick:
navigate(`/projects/${project.slug}`);

// In handleDelete — use slug:
await api.projects.delete(deleteTarget.slug);
```

Keep filtering by `id` for local state updates (the `id` is still on the object):
```typescript
setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
```

**Step 3: Update EditorPage.tsx**

Change `useParams` to extract `slug`:
```typescript
const { slug } = useParams<{ slug: string }>();
```

Pass `slug` to `useProjectEditor`:
```typescript
const { ... } = useProjectEditor(slug);
```

Update `openTrash` and `confirmDeleteChapter` to use `project.slug` instead of `projectId`:
```typescript
async function openTrash() {
  if (!project) return;
  try {
    const trashed = await api.projects.trash(project.slug);
    // ...
  }
}

// In confirmDeleteChapter:
if (trashOpen && project) {
  const trashed = await api.projects.trash(project.slug);
  // ...
}
```

**Step 4: Update useProjectEditor.ts**

Change parameter name and usage:
```typescript
export function useProjectEditor(slug: string | undefined) {
```

In `loadProject`:
```typescript
const data = await api.projects.get(slug);
```

In `handleCreateChapter` — use `project.slug` instead of `projectId`:
```typescript
const handleCreateChapter = useCallback(async () => {
  if (!project) return;
  try {
    const newChapter = await api.chapters.create(project.slug);
    // ...
  }
}, [project]);
```

In `handleReorderChapters` — use `project.slug`:
```typescript
const handleReorderChapters = useCallback(
  async (orderedIds: string[]) => {
    if (!project) return;
    try {
      await api.projects.reorderChapters(project.slug, orderedIds);
      // ...
    }
  },
  [project],
);
```

In `handleUpdateProjectTitle` — use `project.slug` and handle slug change:
```typescript
const handleUpdateProjectTitle = useCallback(
  async (title: string) => {
    if (!project) return;
    try {
      const updated = await api.projects.update(project.slug, { title });
      setProject((prev) => (prev ? { ...prev, title: updated.title, slug: updated.slug } : prev));
      return updated.slug;  // Return new slug so EditorPage can update URL
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.updateTitleFailed);
      return undefined;
    }
  },
  [project],
);
```

**Step 5: Update EditorPage.tsx — handle slug change on rename**

In `saveProjectTitle`, update URL when slug changes:
```typescript
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
    const newSlug = await handleUpdateProjectTitle(trimmed);
    if (newSlug && newSlug !== slug) {
      navigate(`/projects/${newSlug}`, { replace: true });
    }
  }
  setEditingProjectTitle(false);
}
```

**Step 6: Run the full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/pages/HomePage.tsx packages/client/src/pages/EditorPage.tsx packages/client/src/hooks/useProjectEditor.ts
git commit -m "feat: switch client routing and navigation from UUIDs to slugs"
```

---

### Task 11: Manual smoke test

**Step 1: Start the dev server**

Run: `make dev`

**Step 2: Verify these scenarios in the browser**

1. Create a new project "My Test Novel" → URL should be `/projects/my-test-novel`
2. Open the project → editor loads correctly
3. Rename the project to "My Renamed Novel" → URL should update to `/projects/my-renamed-novel` without page reload
4. Go back to home page → project shows new name
5. Create another project and try to give it the same name → should see error
6. Delete a project, create a new one with the same name → should work (partial unique index)

**Step 3: Run full test suite one final time**

Run: `make all`
Expected: Lint + format + all tests PASS
