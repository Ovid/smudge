# Project Slugs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace UUID-based project URLs with human-readable slugs derived from project titles.

**Architecture:** Add a `slug` column to the projects table, create a shared `generateSlug()` utility, switch all project API endpoints from `:id` to `:slug`, and update the React client to use slugs for routing and API calls. UUIDs remain as internal primary keys.

**Tech Stack:** TypeScript, better-sqlite3/Knex.js (migration), Vitest (tests), React Router, Express

**Design doc:** `docs/plans/2026-03-29-project-slugs-design.md`

---

### Task 1: generateSlug

**Requirement:** Slug generation algorithm (design doc §Slug Generation)

#### RED

Write `packages/shared/src/__tests__/slugify.test.ts`:

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

Run: `npm test -w packages/shared -- --run slugify`
Expected failure: module `../slugify` does not exist

#### GREEN

Create `packages/shared/src/slugify.ts`:

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

Add export to `packages/shared/src/index.ts`:

```typescript
export { generateSlug } from "./slugify";
```

Run: `npm test -w packages/shared -- --run slugify`
Expected: All 8 tests PASS

#### REFACTOR

- Check if any regex steps can be combined (unlikely — they're already minimal)
- Verify the export appears correctly in the shared barrel

**Commit:**

```bash
git add packages/shared/src/slugify.ts packages/shared/src/__tests__/slugify.test.ts packages/shared/src/index.ts
git commit -m "feat: add generateSlug utility to shared package"
```

---

### Task 2: Migration — add slug column

**Requirement:** Data layer (design doc §Data Layer)

This must come before `resolveUniqueSlug` tests (Task 3) because those tests insert rows with a `slug` column.

#### RED

No direct test for this task — the migration is infrastructure. It will be exercised by Task 3's tests (which run `migrate.latest()` via test-helpers).

#### GREEN

Create `packages/server/src/db/migrations/002_add_project_slugs.js`:

```javascript
import { generateSlug } from "@smudge/shared";

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // Add slug column — nullable because SQLite doesn't support adding NOT NULL
  // columns to existing tables. Application code always sets slug, so this is
  // a known SQLite limitation, not a gap in enforcement.
  await knex.schema.alterTable("projects", (table) => {
    table.string("slug").nullable();
  });

  // Backfill existing projects
  const projects = await knex("projects").select("id", "title");
  for (const project of projects) {
    const baseSlug = generateSlug(project.title);
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

  // Partial unique indexes — only enforce uniqueness among non-deleted rows.
  // This allows reuse of titles/slugs after soft-deleting a project.
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
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("slug");
  });
}
```

#### REFACTOR

- Verify migration runs without error: `npm test -w packages/server -- --run projects` (existing tests should still pass since slug is nullable and existing routes don't use it yet)

**Commit:**

```bash
git add packages/server/src/db/migrations/002_add_project_slugs.js
git commit -m "feat: add migration for project slug column with partial unique indexes"
```

---

### Task 3: resolveUniqueSlug

**Requirement:** Slug collision handling (design doc §Slug Generation, item 7)

#### RED

Create `packages/server/src/__tests__/resolve-slug.test.ts`:

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
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel-2");
  });

  it("appends -3 when -2 is also taken", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    await t.db("projects").insert({
      id: "p2",
      title: "My Novel 2",
      slug: "my-novel-2",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel-3");
  });

  it("ignores soft-deleted projects for collision", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
      deleted_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel");
  });

  it("excludes a specific project id when provided", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel", "p1");
    expect(slug).toBe("my-novel");
  });
});
```

Run: `npm test -w packages/server -- --run resolve-slug`
Expected failure: module `../routes/resolve-slug` does not exist

#### GREEN

Create `packages/server/src/routes/resolve-slug.ts`:

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

Run: `npm test -w packages/server -- --run resolve-slug`
Expected: All 5 tests PASS

#### REFACTOR

- Nothing to refactor — function is minimal and focused

**Commit:**

```bash
git add packages/server/src/routes/resolve-slug.ts packages/server/src/__tests__/resolve-slug.test.ts
git commit -m "feat: add resolveUniqueSlug helper for slug collision resolution"
```

---

### Task 4: Update shared types

**Requirement:** Add slug to Project and ProjectListItem (design doc §Client Changes)

#### RED

No failing test needed — this is a type-only change. TypeScript compilation in downstream packages will catch mismatches once those packages start using the new field.

#### GREEN

In `packages/shared/src/types.ts`, add `slug: string` to both interfaces:

```typescript
export interface Project {
  id: string;
  slug: string;
  title: string;
  mode: ProjectMode;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProjectListItem {
  id: string;
  slug: string;
  title: string;
  mode: ProjectMode;
  total_word_count: number;
  updated_at: string;
}
```

Run: `npm test -w packages/shared -- --run`
Expected: All existing tests PASS

#### REFACTOR

- Verify no Zod schema changes are needed: `CreateProjectSchema` and `UpdateProjectSchema` accept `title` only — the server generates the slug. Response shapes use TypeScript interfaces, not Zod. No changes needed.

**Commit:**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add slug field to Project and ProjectListItem types"
```

---

### Task 5: Update server project routes — tests

**Requirement:** All project endpoints switch to slug (design doc §Server API Changes), title uniqueness (§Data Layer), existing test updates (§Scope)

#### RED

Replace the entire `packages/server/src/__tests__/projects.test.ts` with this file. Changes from original:
- All endpoint URLs use `createRes.body.slug` instead of `createRes.body.id`
- New tests: slug in create response, slug in list response, title uniqueness on create, slug regeneration on rename, title uniqueness on rename
- Direct DB operations still use `id` (internal PK) where needed

```typescript
import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("POST /api/projects", () => {
  it("creates a project and returns 201 with slug", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.slug).toBe("my-novel");
    expect(res.body.title).toBe("My Novel");
    expect(res.body.mode).toBe("fiction");
    expect(res.body.created_at).toBeDefined();
    expect(res.body.updated_at).toBeDefined();
  });

  it("auto-creates a first chapter", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(201);

    const chapters = await t.db("chapters").where({ project_id: res.body.id }).select("*");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Untitled Chapter");
    expect(chapters[0].sort_order).toBe(0);
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(t.app).post("/api/projects").send({ mode: "fiction" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when mode is invalid", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "poetry" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("trims whitespace from title", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "  My Novel  ", mode: "fiction" });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("My Novel");
    expect(res.body.slug).toBe("my-novel");
  });

  it("returns 400 when title duplicates an existing project", async () => {
    await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROJECT_TITLE_EXISTS");
  });

  it("allows reuse of a soft-deleted project title", async () => {
    const first = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${first.body.slug}`);

    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("my-novel");
  });
});

describe("GET /api/projects", () => {
  it("returns empty array when no projects exist", async () => {
    const res = await request(t.app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all non-deleted projects sorted by updated_at desc", async () => {
    await request(t.app).post("/api/projects").send({ title: "First", mode: "fiction" });
    await request(t.app).post("/api/projects").send({ title: "Second", mode: "nonfiction" });

    const res = await request(t.app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe("Second");
    expect(res.body[1].title).toBe("First");
    expect(res.body[0].total_word_count).toBe(0);
  });

  it("returns projects with slug field", async () => {
    await request(t.app).post("/api/projects").send({ title: "First", mode: "fiction" });

    const res = await request(t.app).get("/api/projects");
    expect(res.body[0].slug).toBe("first");
  });

  it("excludes soft-deleted projects", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Deleted", mode: "fiction" });
    await t
      .db("projects")
      .where({ id: createRes.body.id })
      .update({ deleted_at: new Date().toISOString() });

    const res = await request(t.app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("PATCH /api/projects/:slug", () => {
  it("renames a project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Old Name", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Name");
  });

  it("returns updated slug when title changes", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Old Name", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("new-name");
  });

  it("trims whitespace from title", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "  Trimmed  " });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Trimmed");
  });

  it("returns 400 when title is missing", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when title is whitespace-only", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "   " });

    expect(res.status).toBe(400);
  });

  it("returns 400 when renaming to a duplicate title", async () => {
    await request(t.app)
      .post("/api/projects")
      .send({ title: "First", mode: "fiction" });
    const second = await request(t.app)
      .post("/api/projects")
      .send({ title: "Second", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${second.body.slug}`)
      .send({ title: "First" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROJECT_TITLE_EXISTS");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app)
      .patch("/api/projects/nonexistent-slug")
      .send({ title: "Nope" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for soft-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Deleted", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "Nope" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:slug", () => {
  it("returns project with chapters", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    const res = await request(t.app).get(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("My Novel");
    expect(res.body.slug).toBe("my-novel");
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].title).toBe("Untitled Chapter");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent-slug");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for soft-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Deleted", mode: "fiction" });
    await t
      .db("projects")
      .where({ id: createRes.body.id })
      .update({ deleted_at: new Date().toISOString() });

    const res = await request(t.app).get(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(404);
  });

  it("orders chapters by sort_order", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    const projectId = createRes.body.id;
    const now = new Date().toISOString();
    await t.db("chapters").insert({
      id: "ch-2",
      project_id: projectId,
      title: "Chapter Two",
      sort_order: 1,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });

    const res = await request(t.app).get(`/api/projects/${createRes.body.slug}`);
    expect(res.body.chapters).toHaveLength(2);
    expect(res.body.chapters[0].title).toBe("Untitled Chapter");
    expect(res.body.chapters[1].title).toBe("Chapter Two");
  });
});

describe("PUT /api/projects/:slug/chapters/order", () => {
  it("reorders chapters by provided ID array", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    await request(t.app).post(`/api/projects/${projectSlug}/chapters`);
    await request(t.app).post(`/api/projects/${projectSlug}/chapters`);

    const getRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    const [ch1Id, ch2Id, ch3Id] = getRes.body.chapters.map((c: { id: string }) => c.id);

    const res = await request(t.app)
      .put(`/api/projects/${projectSlug}/chapters/order`)
      .send({ chapter_ids: [ch3Id, ch2Id, ch1Id] });

    expect(res.status).toBe(200);

    const updated = await request(t.app).get(`/api/projects/${projectSlug}`);
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
    const projectSlug = projectRes.body.slug;

    const res = await request(t.app)
      .put(`/api/projects/${projectSlug}/chapters/order`)
      .send({ chapter_ids: ["wrong-id"] });

    expect(res.status).toBe(400);
  });

  it("returns 400 if chapter_ids is missing or not an array", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    const res = await request(t.app)
      .put(`/api/projects/${projectSlug}/chapters/order`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app)
      .put("/api/projects/nonexistent-slug/chapters/order")
      .send({ chapter_ids: [] });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:slug/trash", () => {
  it("returns soft-deleted chapters for a project", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    const getRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    const chapterId = getRes.body.chapters[0].id;

    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).get(`/api/projects/${projectSlug}/trash`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(chapterId);
    expect(res.body[0].deleted_at).toBeTruthy();
  });

  it("returns empty array when no trashed chapters", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    const res = await request(t.app).get(`/api/projects/${projectSlug}/trash`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent-slug/trash");

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:slug", () => {
  it("soft-deletes a project and returns 200", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });

    const res = await request(t.app).delete(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Project moved to trash.");
  });

  it("sets deleted_at on the project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const project = await t.db("projects").where({ id: createRes.body.id }).first();
    expect(project.deleted_at).not.toBeNull();
  });

  it("soft-deleted project no longer appears in GET /api/projects", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const listRes = await request(t.app).get("/api/projects");
    expect(listRes.body).toHaveLength(0);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).delete("/api/projects/nonexistent-slug");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for already-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const res = await request(t.app).delete(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(404);
  });

  it("soft-deletes all chapters when project is deleted", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;
    const projectId = projectRes.body.id;

    await request(t.app).post(`/api/projects/${projectSlug}/chapters`);

    await request(t.app).delete(`/api/projects/${projectSlug}`);

    const chapters = await t.db("chapters").where({ project_id: projectId });
    expect(chapters.every((c: { deleted_at: string | null }) => c.deleted_at !== null)).toBe(true);
  });
});
```

Run: `npm test -w packages/server -- --run projects`
Expected failure: routes still use `:id` and don't return `slug`

---

### Task 6: Update server project routes — implementation

**Requirement:** All project endpoints switch to slug (design doc §Server API Changes)

#### GREEN

Modify `packages/server/src/routes/projects.ts`:

**Update imports** — add at the top:

```typescript
import { generateSlug } from "@smudge/shared";
import { resolveUniqueSlug } from "./resolve-slug";
```

**Update `POST /` (create)** — after validation, before inserting:

```typescript
const { title, mode } = parsed.data;

// Check title uniqueness
const existingTitle = await db("projects")
  .where({ title })
  .whereNull("deleted_at")
  .first();
if (existingTitle) {
  res.status(400).json({
    error: {
      code: "PROJECT_TITLE_EXISTS",
      message: "A project with that title already exists",
    },
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

**Update `GET /` (list)** — add `"projects.slug"` to the `.select(...)` call.

**Change all `:id` params to `:slug`** — for every route:

1. Change route path from `"/:id"` to `"/:slug"`
2. Change project lookups from `.where({ id: req.params.id })` to `.where({ slug: req.params.slug }).whereNull("deleted_at")`
3. Use `project.id` (from the looked-up row) for any subsequent operations that need the UUID (chapter queries, FK references, etc.)

**Special handling for `GET /:slug/trash`** — this endpoint currently doesn't filter by `deleted_at` on the project (it shows trash for deleted projects too). Keep that behavior: look up by slug without the `whereNull("deleted_at")` filter, but search both active and deleted projects:

```typescript
const project = await db("projects").where({ slug: req.params.slug }).first();
```

**Update `PATCH /:slug`** — after title validation and project lookup, add title uniqueness check and slug regeneration:

```typescript
const { title } = parsed.data;

const existingTitle = await db("projects")
  .where({ title })
  .whereNull("deleted_at")
  .whereNot({ id: project.id })
  .first();
if (existingTitle) {
  res.status(400).json({
    error: {
      code: "PROJECT_TITLE_EXISTS",
      message: "A project with that title already exists",
    },
  });
  return;
}

const newSlug = await resolveUniqueSlug(db, generateSlug(title), project.id);

await db("projects")
  .where({ id: project.id })
  .update({ title, slug: newSlug, updated_at: new Date().toISOString() });
```

Run: `npm test -w packages/server -- --run projects`
Expected: All tests PASS

#### REFACTOR

- Look for duplicated "find project by slug" logic. If 5+ routes share the same pattern (`db("projects").where({ slug }).whereNull("deleted_at").first()` + 404 check), consider extracting a `findProjectBySlug(db, slug)` helper. Only do this if the duplication is truly identical — don't abstract if some routes need different `deleted_at` behavior (like the trash endpoint).
- Verify the full test suite still passes: `npm test`

**Commit:**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/projects.test.ts
git commit -m "feat: switch project API endpoints from UUID to slug"
```

---

### Task 7: Update chapters.test.ts for slug-based project endpoints

**Requirement:** Existing tests must pass after route changes (design doc §Scope)

#### RED

The existing `chapters.test.ts` will be failing because its `createProjectWithChapter` helper uses `GET /api/projects/${projectId}` (UUID) which no longer matches the `:slug` route.

Run: `npm test -w packages/server -- --run chapters`
Expected failure: 404 errors on project endpoints that now expect slugs

#### GREEN

Modify `packages/server/src/__tests__/chapters.test.ts`:

Update the `createProjectWithChapter` helper to return `projectSlug` and use it for project-endpoint calls:

```typescript
/** Helper: create a project and return its id, slug, + first chapter id */
async function createProjectWithChapter(app: ReturnType<typeof setupTestDb>["app"]) {
  const projectRes = await request(app)
    .post("/api/projects")
    .send({ title: "Test Project", mode: "fiction" });
  const projectId = projectRes.body.id;
  const projectSlug = projectRes.body.slug;

  const getRes = await request(app).get(`/api/projects/${projectSlug}`);
  const chapterId = getRes.body.chapters[0].id;

  return { projectId, projectSlug, chapterId };
}
```

Then update every test that calls project endpoints to use `projectSlug`:

- `POST /api/projects/${projectSlug}/chapters` (create chapter)
- `GET /api/projects/${projectSlug}` (get project)
- `DELETE /api/projects/${projectSlug}` (delete project)

Chapter endpoints (`GET/PATCH/DELETE /api/chapters/:id`, `POST /api/chapters/:id/restore`) stay unchanged — they still use UUIDs.

For the restore test "also restores parent project if it was deleted" — the final assertion `GET /api/projects/${projectId}` needs to change to `GET /api/projects/${projectSlug}`.

Run: `npm test -w packages/server -- --run chapters`
Expected: All tests PASS

#### REFACTOR

- Nothing to refactor — mechanical find-and-replace

Run: `npm test` (full suite)
Expected: All tests PASS across all packages

**Commit:**

```bash
git add packages/server/src/__tests__/chapters.test.ts
git commit -m "fix: update chapters tests to use slug-based project endpoints"
```

---

### Task 8: Update client API client

**Requirement:** API client uses slugs (design doc §Client Changes)

#### RED

No test to write — the client API module has no unit tests (it's tested via integration). The type changes will surface compile errors if parameter names are wrong.

#### GREEN

Modify `packages/client/src/api/client.ts`:

Change parameter names from `id` to `slug` for all project methods:

```typescript
projects: {
  list: () => apiFetch<ProjectListItem[]>("/projects"),

  get: (slug: string) => apiFetch<ProjectWithChapters>(`/projects/${slug}`),

  create: (input: CreateProjectInput) =>
    apiFetch<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  update: (slug: string, data: { title?: string }) =>
    apiFetch<Project>(`/projects/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (slug: string) =>
    apiFetch<{ message: string }>(`/projects/${slug}`, { method: "DELETE" }),

  reorderChapters: (slug: string, chapterIds: string[]) =>
    apiFetch<{ message: string }>(`/projects/${slug}/chapters/order`, {
      method: "PUT",
      body: JSON.stringify({ chapter_ids: chapterIds }),
    }),

  trash: (slug: string) => apiFetch<Chapter[]>(`/projects/${slug}/trash`),
},
```

Update `chapters.create` to use slug:

```typescript
create: (projectSlug: string) =>
  apiFetch<Chapter>(`/projects/${projectSlug}/chapters`, { method: "POST" }),
```

#### REFACTOR

- Nothing to refactor — parameter rename only

**Commit:**

```bash
git add packages/client/src/api/client.ts
git commit -m "refactor: update API client to use slugs for project endpoints"
```

---

### Task 9: Update client routing and pages

**Requirement:** Client routing uses slugs, rename updates URL (design doc §Client Changes)

#### RED

No unit tests for client pages currently. This will be verified via the smoke test (Task 10).

#### GREEN

**`packages/client/src/App.tsx`** — change route param:

```typescript
<Route path="/projects/:slug" element={<EditorPage />} />
```

**`packages/client/src/pages/HomePage.tsx`** — change navigation and delete to use slug:

```typescript
// In handleCreate (around line 41):
navigate(`/projects/${project.slug}`);

// In project list button onClick (around line 93):
navigate(`/projects/${project.slug}`);

// In handleDelete (around line 51):
await api.projects.delete(deleteTarget.slug);
```

Keep local state filtering by `id`:

```typescript
setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
```

**`packages/client/src/pages/EditorPage.tsx`** — extract `slug` instead of `projectId`:

```typescript
const { slug } = useParams<{ slug: string }>();
```

Pass `slug` to `useProjectEditor`:

```typescript
const { ... } = useProjectEditor(slug);
```

Update `openTrash` to use `project.slug` instead of `projectId`:

```typescript
async function openTrash() {
  if (!project) return;
  try {
    const trashed = await api.projects.trash(project.slug);
    setTrashedChapters(trashed);
    setTrashOpen(true);
  } catch {
    // Silently fail
  }
}
```

Update `confirmDeleteChapter` similarly:

```typescript
if (trashOpen && project) {
  try {
    const trashed = await api.projects.trash(project.slug);
    setTrashedChapters(trashed);
  } catch {
    // Trash refresh failed
  }
}
```

Update `saveProjectTitle` to handle slug change in URL:

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

**`packages/client/src/hooks/useProjectEditor.ts`** — change parameter and all usages:

```typescript
export function useProjectEditor(slug: string | undefined) {
```

In `loadProject`:

```typescript
if (!slug) return;
const data = await api.projects.get(slug);
```

Update `useEffect` dependency from `projectId` to `slug`:

```typescript
}, [slug]);
```

In `handleCreateChapter` — use `project.slug`:

```typescript
const handleCreateChapter = useCallback(async () => {
  if (!project) return;
  try {
    const newChapter = await api.chapters.create(project.slug);
    // ... rest unchanged
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
      // ... rest unchanged
    }
  },
  [project],
);
```

In `handleUpdateProjectTitle` — use `project.slug` and return the new slug:

```typescript
const handleUpdateProjectTitle = useCallback(
  async (title: string): Promise<string | undefined> => {
    if (!project) return undefined;
    try {
      const updated = await api.projects.update(project.slug, { title });
      setProject((prev) =>
        prev ? { ...prev, title: updated.title, slug: updated.slug } : prev,
      );
      return updated.slug;
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.updateTitleFailed);
      return undefined;
    }
  },
  [project],
);
```

#### REFACTOR

- Check that no stale references to `projectId` remain in EditorPage or useProjectEditor
- Run: `npm test` — all tests should pass

**Commit:**

```bash
git add packages/client/src/App.tsx packages/client/src/pages/HomePage.tsx packages/client/src/pages/EditorPage.tsx packages/client/src/hooks/useProjectEditor.ts
git commit -m "feat: switch client routing and navigation from UUIDs to slugs"
```

---

### Task 10: Manual smoke test

**Requirement:** End-to-end verification of all slug functionality

#### Steps

1. Start the dev server: `make dev`
2. Verify in the browser:
   - Create a new project "My Test Novel" → URL should be `/projects/my-test-novel`
   - Open the project → editor loads correctly
   - Rename the project to "My Renamed Novel" → URL should update to `/projects/my-renamed-novel` without page reload
   - Go back to home page → project shows new name
   - Create another project and try to give it the same name → should see error
   - Delete a project, create a new one with the same name → should work (partial unique index)
3. Run full suite: `make all` — lint + format + all tests PASS
