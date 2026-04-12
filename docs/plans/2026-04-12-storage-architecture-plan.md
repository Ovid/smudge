# Storage Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a `ProjectStore` interface between services and existing repositories, creating a clean seam for Phase 8's per-project SQLite transition.

**Architecture:** Thin interface-only abstraction. `SqliteProjectStore` delegates 1:1 to existing project, chapter, and chapter-status repositories. Module-level singleton access via injectable. AssetStore and SnapshotStore are type-only definitions.

**Tech Stack:** TypeScript, Knex.js, Vitest

**Design doc:** `docs/plans/2026-04-12-storage-architecture-design.md`

---

### Task 1: ProjectStore Interface

**Requirement:** Design decisions 1, 3, 5, 6, 7, 8 — define the core interface covering projects, chapters, and chapter-statuses with correct naming, null returns, and transaction signature.

**Files:**
- Create: `packages/server/src/stores/project-store.types.ts`

> No RED/GREEN/REFACTOR — this is a type-only file with no runtime behavior. Compilation is the verification.

**Step 1: Create the ProjectStore interface file**

Create `packages/server/src/stores/project-store.types.ts` with the full interface. Every method mirrors an existing repository function — the only change is dropping the leading `trx` parameter. Method naming prefixes the entity name for clarity in the combined interface.

```typescript
import type { Knex } from "knex";
import type {
  ProjectRow,
  CreateProjectRow,
  ProjectListRow,
  UpdateProjectData,
} from "../projects/projects.types";
import type {
  ChapterRow,
  ChapterRawRow,
  ChapterMetadataRow,
  DeletedChapterRow,
  CreateChapterRow,
  UpdateChapterData,
} from "../chapters/chapters.types";
import type { ChapterStatusRow } from "../chapter-statuses/chapter-statuses.types";

export interface ProjectStore {
  // --- Projects ---
  insertProject(data: CreateProjectRow): Promise<ProjectRow>;
  findProjectById(id: string): Promise<ProjectRow | null>;
  findProjectByIdIncludingDeleted(id: string): Promise<ProjectRow | null>;
  findProjectBySlug(slug: string): Promise<ProjectRow | null>;
  findProjectBySlugIncludingDeleted(slug: string): Promise<ProjectRow | null>;
  findProjectByTitle(title: string, excludeId?: string): Promise<ProjectRow | null>;
  listProjects(): Promise<ProjectListRow[]>;
  updateProject(id: string, data: UpdateProjectData): Promise<ProjectRow>;
  updateProjectIncludingDeleted(id: string, data: UpdateProjectData): Promise<ProjectRow>;
  updateProjectTimestamp(id: string): Promise<void>;
  softDeleteProject(id: string, now: string): Promise<void>;
  resolveUniqueSlug(baseSlug: string, excludeProjectId?: string): Promise<string>;

  // --- Chapters ---
  insertChapter(data: CreateChapterRow): Promise<void>;
  findChapterById(id: string): Promise<ChapterRow | null>;
  findDeletedChapterById(id: string): Promise<ChapterRawRow | null>;
  findChapterByIdRaw(id: string): Promise<ChapterRawRow | null>;
  listChaptersByProject(projectId: string): Promise<ChapterRow[]>;
  listChapterMetadataByProject(projectId: string): Promise<ChapterMetadataRow[]>;
  listDeletedChaptersByProject(projectId: string): Promise<DeletedChapterRow[]>;
  listChapterIdsByProject(projectId: string): Promise<string[]>;
  listChapterIdTitleStatusByProject(
    projectId: string,
  ): Promise<Array<{ id: string; title: string; status: string }>>;
  sumChapterWordCountByProject(projectId: string): Promise<number>;
  getMaxChapterSortOrder(projectId: string): Promise<number>;
  updateChapter(id: string, updates: UpdateChapterData): Promise<number>;
  updateChapterSortOrders(orders: Array<{ id: string; sort_order: number }>): Promise<void>;
  softDeleteChapter(id: string, now: string): Promise<void>;
  softDeleteChaptersByProject(projectId: string, now: string): Promise<void>;
  restoreChapter(id: string, sortOrder: number, now: string): Promise<void>;

  // --- Chapter statuses ---
  listStatuses(): Promise<ChapterStatusRow[]>;
  findStatusByStatus(status: string): Promise<ChapterStatusRow | undefined>;
  getStatusLabel(status: string): Promise<string>;
  getStatusLabelMap(): Promise<Record<string, string>>;

  // --- Transactions ---
  transaction<T>(fn: (txStore: ProjectStore, trx: Knex.Transaction) => Promise<T>): Promise<T>;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p packages/server/tsconfig.json`
Expected: No errors (the file only defines types, imports existing types).

**Step 3: Commit**

```bash
git add packages/server/src/stores/project-store.types.ts
git commit -m "feat: add ProjectStore interface definition"
```

---

### Task 2: AssetStore and SnapshotStore Interfaces (types only)

**Requirement:** Design decision 2 — interfaces only, no implementations until Phase 4a/4b.

**Files:**
- Create: `packages/server/src/stores/asset-store.types.ts`
- Create: `packages/server/src/stores/snapshot-store.types.ts`

> No RED/GREEN/REFACTOR — type-only files with no runtime behavior. Compilation is the verification.

**Step 1: Create AssetStore types**

Create `packages/server/src/stores/asset-store.types.ts`:

```typescript
export type AssetKind = "pdf" | "docx" | "image" | "web-link" | "note";
export type AssetStorageMode = "linked" | "managed";

export interface AssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  storage_mode: AssetStorageMode;
  path_or_uri: string;
  title: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateAssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  storage_mode: AssetStorageMode;
  path_or_uri: string;
  title: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface AssetStore {
  insertAsset(data: CreateAssetRow): Promise<AssetRow>;
  findAssetById(id: string): Promise<AssetRow | null>;
  listAssetsByProject(projectId: string): Promise<AssetRow[]>;
  softDeleteAsset(id: string, now: string): Promise<void>;
}
```

**Step 2: Create SnapshotStore types**

Create `packages/server/src/stores/snapshot-store.types.ts`:

```typescript
export type SnapshotType = "auto" | "manual" | "pre-destructive-op";

export interface SnapshotRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  snapshot_type: SnapshotType;
  label: string | null;
  content: string;
  created_at: string;
}

export interface CreateSnapshotRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  snapshot_type: SnapshotType;
  label: string | null;
  content: string;
  created_at: string;
}

export interface SnapshotStore {
  insertSnapshot(data: CreateSnapshotRow): Promise<SnapshotRow>;
  findSnapshotById(id: string): Promise<SnapshotRow | null>;
  listSnapshotsByProject(projectId: string): Promise<SnapshotRow[]>;
  listSnapshotsByChapter(chapterId: string): Promise<SnapshotRow[]>;
  deleteSnapshot(id: string): Promise<void>;
}
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p packages/server/tsconfig.json`
Expected: No errors.

**Step 4: Commit**

```bash
git add packages/server/src/stores/asset-store.types.ts packages/server/src/stores/snapshot-store.types.ts
git commit -m "feat: add AssetStore and SnapshotStore interface definitions (types only)"
```

---

### Task 3: SqliteProjectStore Implementation

**Requirement:** Design decision 1 — thin delegation layer; every method delegates 1:1 to existing repositories. Transaction support per design decision 7.

**Files:**
- Create: `packages/server/src/stores/sqlite-project-store.ts`
- Test: `packages/server/src/__tests__/sqlite-project-store.test.ts`

#### RED — Write failing tests

Create `packages/server/src/__tests__/sqlite-project-store.test.ts`. Tests prove the store delegates correctly: round-trip insert→find for projects, chapters, and statuses; transaction commit/rollback; raw trx escape hatch.

Expected failure: `Cannot find module '../stores/sqlite-project-store'`

If tests pass unexpectedly: the module somehow already exists — check for stale files.

```typescript
import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import { SqliteProjectStore } from "../stores/sqlite-project-store";

const ctx = setupTestDb();

describe("SqliteProjectStore", () => {
  function createStore() {
    return new SqliteProjectStore(ctx.db);
  }

  describe("project delegation", () => {
    it("insertProject + findProjectById round-trip", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      const project = await store.insertProject({
        id: "p1",
        title: "Test Project",
        slug: "test-project",
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      expect(project.id).toBe("p1");
      expect(project.title).toBe("Test Project");

      const found = await store.findProjectById("p1");
      expect(found).not.toBeNull();
      expect(found!.title).toBe("Test Project");
    });

    it("findProjectById returns null for missing project", async () => {
      const store = createStore();
      const found = await store.findProjectById("nonexistent");
      expect(found).toBeNull();
    });

    it("listProjects returns all active projects", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      await store.insertProject({
        id: "p1",
        title: "Project One",
        slug: "project-one",
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      await store.insertProject({
        id: "p2",
        title: "Project Two",
        slug: "project-two",
        mode: "nonfiction",
        created_at: now,
        updated_at: now,
      });
      const list = await store.listProjects();
      expect(list).toHaveLength(2);
    });

    it("softDeleteProject excludes project from findProjectById", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      await store.insertProject({
        id: "p1",
        title: "Doomed",
        slug: "doomed",
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      await store.softDeleteProject("p1", now);
      const found = await store.findProjectById("p1");
      expect(found).toBeNull();
    });

    it("findProjectByIdIncludingDeleted finds soft-deleted projects", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      await store.insertProject({
        id: "p1",
        title: "Doomed",
        slug: "doomed",
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      await store.softDeleteProject("p1", now);
      const found = await store.findProjectByIdIncludingDeleted("p1");
      expect(found).not.toBeNull();
      expect(found!.deleted_at).not.toBeNull();
    });

    it("resolveUniqueSlug generates unique slugs", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      await store.insertProject({
        id: "p1",
        title: "My Book",
        slug: "my-book",
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      const slug = await store.resolveUniqueSlug("my-book");
      expect(slug).toBe("my-book-2");
    });
  });

  describe("chapter delegation", () => {
    async function seedProject(store: SqliteProjectStore) {
      const now = new Date().toISOString();
      await store.insertProject({
        id: "p1",
        title: "Test Project",
        slug: "test-project",
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      return now;
    }

    it("insertChapter + findChapterById round-trip", async () => {
      const store = createStore();
      const now = await seedProject(store);
      await store.insertChapter({
        id: "c1",
        project_id: "p1",
        title: "Chapter One",
        content: null,
        sort_order: 0,
        word_count: 0,
        created_at: now,
        updated_at: now,
      });
      const found = await store.findChapterById("c1");
      expect(found).not.toBeNull();
      expect(found!.title).toBe("Chapter One");
    });

    it("listChaptersByProject returns chapters in sort order", async () => {
      const store = createStore();
      const now = await seedProject(store);
      await store.insertChapter({
        id: "c1",
        project_id: "p1",
        title: "Second",
        content: null,
        sort_order: 1,
        word_count: 0,
        created_at: now,
        updated_at: now,
      });
      await store.insertChapter({
        id: "c2",
        project_id: "p1",
        title: "First",
        content: null,
        sort_order: 0,
        word_count: 0,
        created_at: now,
        updated_at: now,
      });
      const chapters = await store.listChaptersByProject("p1");
      expect(chapters).toHaveLength(2);
      expect(chapters[0]!.title).toBe("First");
      expect(chapters[1]!.title).toBe("Second");
    });

    it("sumChapterWordCountByProject sums correctly", async () => {
      const store = createStore();
      const now = await seedProject(store);
      await store.insertChapter({
        id: "c1",
        project_id: "p1",
        title: "Ch1",
        content: null,
        sort_order: 0,
        word_count: 100,
        created_at: now,
        updated_at: now,
      });
      await store.insertChapter({
        id: "c2",
        project_id: "p1",
        title: "Ch2",
        content: null,
        sort_order: 1,
        word_count: 250,
        created_at: now,
        updated_at: now,
      });
      const total = await store.sumChapterWordCountByProject("p1");
      expect(total).toBe(350);
    });
  });

  describe("chapter status delegation", () => {
    it("listStatuses returns seed statuses", async () => {
      const store = createStore();
      const statuses = await store.listStatuses();
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses[0]).toHaveProperty("status");
      expect(statuses[0]).toHaveProperty("label");
    });

    it("findStatusByStatus returns a status row for known status", async () => {
      const store = createStore();
      const status = await store.findStatusByStatus("outline");
      expect(status).toBeDefined();
      expect(status!.status).toBe("outline");
      expect(status!.label).toBe("Outline");
    });

    it("findStatusByStatus returns undefined for unknown status", async () => {
      const store = createStore();
      const status = await store.findStatusByStatus("nonexistent");
      expect(status).toBeUndefined();
    });

    it("getStatusLabelMap returns a complete map", async () => {
      const store = createStore();
      const map = await store.getStatusLabelMap();
      expect(map).toHaveProperty("outline");
      expect(typeof map["outline"]).toBe("string");
    });
  });

  describe("transaction support", () => {
    it("transaction commits on success", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      await store.transaction(async (txStore) => {
        await txStore.insertProject({
          id: "p1",
          title: "Transacted",
          slug: "transacted",
          mode: "fiction",
          created_at: now,
          updated_at: now,
        });
        await txStore.insertChapter({
          id: "c1",
          project_id: "p1",
          title: "Ch1",
          content: null,
          sort_order: 0,
          word_count: 0,
          created_at: now,
          updated_at: now,
        });
      });
      const found = await store.findProjectById("p1");
      expect(found).not.toBeNull();
    });

    it("transaction rolls back on error", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      try {
        await store.transaction(async (txStore) => {
          await txStore.insertProject({
            id: "p1",
            title: "Will Rollback",
            slug: "will-rollback",
            mode: "fiction",
            created_at: now,
            updated_at: now,
          });
          throw new Error("deliberate failure");
        });
      } catch {
        // expected
      }
      const found = await store.findProjectById("p1");
      expect(found).toBeNull();
    });

    it("transaction exposes raw trx for non-store repos", async () => {
      const store = createStore();
      const now = new Date().toISOString();
      await store.transaction(async (txStore, trx) => {
        await txStore.insertProject({
          id: "p1",
          title: "With Raw Trx",
          slug: "with-raw-trx",
          mode: "fiction",
          created_at: now,
          updated_at: now,
        });
        // Verify trx is a real Knex transaction by using it directly
        const row = await trx("projects").where({ id: "p1" }).first();
        expect(row).toBeTruthy();
      });
    });
  });
});
```

**Run tests to verify they fail:**

Run: `npm test -w packages/server -- --run sqlite-project-store`
Expected: FAIL — `Cannot find module '../stores/sqlite-project-store'`

#### GREEN — Write minimal implementation

Create `packages/server/src/stores/sqlite-project-store.ts`. Each method is a one-liner delegating to the corresponding repository function. Keep it simple — no anticipatory abstractions.

```typescript
import type { Knex } from "knex";
import type { ProjectStore } from "./project-store.types";
import type {
  CreateProjectRow,
  UpdateProjectData,
} from "../projects/projects.types";
import type {
  CreateChapterRow,
  UpdateChapterData,
} from "../chapters/chapters.types";
import * as projectsRepo from "../projects/projects.repository";
import * as chaptersRepo from "../chapters/chapters.repository";
import * as statusesRepo from "../chapter-statuses/chapter-statuses.repository";

export class SqliteProjectStore implements ProjectStore {
  constructor(private db: Knex.Transaction | Knex) {}

  // --- Projects ---

  insertProject(data: CreateProjectRow) {
    return projectsRepo.insert(this.db, data);
  }
  findProjectById(id: string) {
    return projectsRepo.findById(this.db, id);
  }
  findProjectByIdIncludingDeleted(id: string) {
    return projectsRepo.findByIdIncludingDeleted(this.db, id);
  }
  findProjectBySlug(slug: string) {
    return projectsRepo.findBySlug(this.db, slug);
  }
  findProjectBySlugIncludingDeleted(slug: string) {
    return projectsRepo.findBySlugIncludingDeleted(this.db, slug);
  }
  findProjectByTitle(title: string, excludeId?: string) {
    return projectsRepo.findByTitle(this.db, title, excludeId);
  }
  listProjects() {
    return projectsRepo.listAll(this.db);
  }
  updateProject(id: string, data: UpdateProjectData) {
    return projectsRepo.update(this.db, id, data);
  }
  updateProjectIncludingDeleted(id: string, data: UpdateProjectData) {
    return projectsRepo.updateIncludingDeleted(this.db, id, data);
  }
  updateProjectTimestamp(id: string) {
    return projectsRepo.updateTimestamp(this.db, id);
  }
  softDeleteProject(id: string, now: string) {
    return projectsRepo.softDelete(this.db, id, now);
  }
  resolveUniqueSlug(baseSlug: string, excludeProjectId?: string) {
    return projectsRepo.resolveUniqueSlug(this.db, baseSlug, excludeProjectId);
  }

  // --- Chapters ---

  insertChapter(data: CreateChapterRow) {
    return chaptersRepo.insert(this.db, data);
  }
  findChapterById(id: string) {
    return chaptersRepo.findById(this.db, id);
  }
  findDeletedChapterById(id: string) {
    return chaptersRepo.findDeletedById(this.db, id);
  }
  findChapterByIdRaw(id: string) {
    return chaptersRepo.findByIdRaw(this.db, id);
  }
  listChaptersByProject(projectId: string) {
    return chaptersRepo.listByProject(this.db, projectId);
  }
  listChapterMetadataByProject(projectId: string) {
    return chaptersRepo.listMetadataByProject(this.db, projectId);
  }
  listDeletedChaptersByProject(projectId: string) {
    return chaptersRepo.listDeletedByProject(this.db, projectId);
  }
  listChapterIdsByProject(projectId: string) {
    return chaptersRepo.listIdsByProject(this.db, projectId);
  }
  listChapterIdTitleStatusByProject(projectId: string) {
    return chaptersRepo.listIdTitleStatusByProject(this.db, projectId);
  }
  sumChapterWordCountByProject(projectId: string) {
    return chaptersRepo.sumWordCountByProject(this.db, projectId);
  }
  getMaxChapterSortOrder(projectId: string) {
    return chaptersRepo.getMaxSortOrder(this.db, projectId);
  }
  updateChapter(id: string, updates: UpdateChapterData) {
    return chaptersRepo.update(this.db, id, updates);
  }
  updateChapterSortOrders(orders: Array<{ id: string; sort_order: number }>) {
    return chaptersRepo.updateSortOrders(this.db, orders);
  }
  softDeleteChapter(id: string, now: string) {
    return chaptersRepo.softDelete(this.db, id, now);
  }
  softDeleteChaptersByProject(projectId: string, now: string) {
    return chaptersRepo.softDeleteByProject(this.db, projectId, now);
  }
  restoreChapter(id: string, sortOrder: number, now: string) {
    return chaptersRepo.restore(this.db, id, sortOrder, now);
  }

  // --- Chapter statuses ---

  listStatuses() {
    return statusesRepo.list(this.db);
  }
  findStatusByStatus(status: string) {
    return statusesRepo.findByStatus(this.db, status);
  }
  getStatusLabel(status: string) {
    return statusesRepo.getStatusLabel(this.db, status);
  }
  getStatusLabelMap() {
    return statusesRepo.getStatusLabelMap(this.db);
  }

  // --- Transactions ---

  async transaction<T>(
    fn: (txStore: ProjectStore, trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return (this.db as Knex).transaction(async (trx) => {
      const txStore = new SqliteProjectStore(trx);
      return fn(txStore, trx);
    });
  }
}
```

**Run tests to verify they pass:**

Run: `npm test -w packages/server -- --run sqlite-project-store`
Expected: All tests PASS.

**Run TypeScript check:**

Run: `npx tsc --noEmit -p packages/server/tsconfig.json`
Expected: No errors.

#### REFACTOR

Look for:
- Any method where the delegation pattern differs from the others (inconsistent style)
- Missing return type annotations that TypeScript doesn't infer correctly
- Import organization — ensure consistent ordering

**Commit:**

```bash
git add packages/server/src/stores/sqlite-project-store.ts packages/server/src/__tests__/sqlite-project-store.test.ts
git commit -m "feat: add SqliteProjectStore implementation with tests"
```

---

### Task 4: Injectable and Barrel Export

**Requirement:** Design decision 4 — module-level singleton matching existing getDb() and velocity.injectable.ts patterns.

**Files:**
- Create: `packages/server/src/stores/project-store.injectable.ts`
- Create: `packages/server/src/stores/index.ts`
- Test: `packages/server/src/__tests__/project-store-injectable.test.ts`

#### RED — Write failing tests

Create `packages/server/src/__tests__/project-store-injectable.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  getProjectStore,
  setProjectStore,
  initProjectStore,
} from "../stores/project-store.injectable";
import type { ProjectStore } from "../stores/project-store.types";
import { setupTestDb } from "./test-helpers";

setupTestDb();

describe("project-store.injectable", () => {
  beforeEach(() => {
    // Reset to uninitialized state by setting to null via a mock
    setProjectStore(null as unknown as ProjectStore);
  });

  it("getProjectStore throws before initialization", () => {
    expect(() => getProjectStore()).toThrow("ProjectStore not initialized");
  });

  it("initProjectStore makes getProjectStore return a store", () => {
    initProjectStore();
    const store = getProjectStore();
    expect(store).toBeDefined();
    expect(typeof store.findProjectById).toBe("function");
  });

  it("setProjectStore overrides the store", () => {
    const mockStore = { findProjectById: () => Promise.resolve(null) } as unknown as ProjectStore;
    setProjectStore(mockStore);
    expect(getProjectStore()).toBe(mockStore);
  });
});
```

**Run tests to verify they fail:**

Run: `npm test -w packages/server -- --run project-store-injectable`
Expected: FAIL — cannot find module.

#### GREEN — Write minimal implementation

Create `packages/server/src/stores/project-store.injectable.ts`:

```typescript
import type { ProjectStore } from "./project-store.types";
import { SqliteProjectStore } from "./sqlite-project-store";
import { getDb } from "../db/connection";

let store: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
  if (!store) throw new Error("ProjectStore not initialized — call initProjectStore() first");
  return store;
}

export function setProjectStore(s: ProjectStore): void {
  store = s;
}

export function initProjectStore(): void {
  store = new SqliteProjectStore(getDb());
}
```

**Create the barrel export:**

Create `packages/server/src/stores/index.ts`:

```typescript
export type { ProjectStore } from "./project-store.types";
export type { AssetStore, AssetRow, CreateAssetRow, AssetKind, AssetStorageMode } from "./asset-store.types";
export type { SnapshotStore, SnapshotRow, CreateSnapshotRow, SnapshotType } from "./snapshot-store.types";
export { SqliteProjectStore } from "./sqlite-project-store";
export { getProjectStore, setProjectStore, initProjectStore } from "./project-store.injectable";
```

**Run tests to verify they pass:**

Run: `npm test -w packages/server -- --run project-store-injectable`
Expected: All tests PASS.

#### REFACTOR

Look for:
- Error message wording consistency with the velocity injectable
- Whether the barrel export re-exports all necessary types for consumers

**Commit:**

```bash
git add packages/server/src/stores/project-store.injectable.ts packages/server/src/stores/index.ts packages/server/src/__tests__/project-store-injectable.test.ts
git commit -m "feat: add ProjectStore injectable and barrel export"
```

---

### Task 5: Wire initProjectStore into Server Bootstrap

**Requirement:** Design doc "Startup Wiring" section — initProjectStore() called immediately after initDb().

**Files:**
- Modify: `packages/server/src/index.ts`

> No RED/GREEN — wiring-only change verified by existing test suite passing. No new behavior to test.

**Step 1: Add initProjectStore to server startup**

In `packages/server/src/index.ts`, add the import and call `initProjectStore()` right after `initDb()` completes (after line 26, before `purgeOldTrash`):

```typescript
// Add to imports at top:
import { initProjectStore } from "./stores/project-store.injectable";

// Add after the initDb() block (after line 26):
initProjectStore();
```

**Step 2: Verify the server starts**

Run: `npm run dev -w packages/server` (or however the dev server starts), confirm it boots without error, then stop it.

Alternatively, run the full test suite to confirm nothing breaks:

Run: `npm test -w packages/server -- --run`
Expected: All existing tests continue to pass.

**Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: wire initProjectStore into server bootstrap"
```

---

### Task 6: Wire initProjectStore into Test Helpers

**Requirement:** Design doc "Test migration" section — integration tests use setProjectStore(new SqliteProjectStore(testDb)).

**Files:**
- Modify: `packages/server/src/__tests__/test-helpers.ts`

> No RED/GREEN — wiring-only change verified by existing test suite passing. No new behavior to test.

**Step 1: Update test-helpers to initialize the store**

In `packages/server/src/__tests__/test-helpers.ts`, import and call `setProjectStore` + `SqliteProjectStore` in the `beforeAll` block so all integration tests have the store available. Add after the `await setDb(testDb)` line:

```typescript
// Add to imports at top:
import { setProjectStore } from "../stores/project-store.injectable";
import { SqliteProjectStore } from "../stores/sqlite-project-store";

// Add after `await setDb(testDb)` in beforeAll:
setProjectStore(new SqliteProjectStore(testDb));
```

This ensures all integration tests that go through services will work after services are migrated. We use `setProjectStore(new SqliteProjectStore(testDb))` rather than `initProjectStore()` because `initProjectStore()` calls `getDb()` which may not reflect the test DB in all cases.

**Step 2: Run the full server test suite**

Run: `npm test -w packages/server -- --run`
Expected: All tests pass — no behavior change, just wiring the store into the test environment.

**Step 3: Commit**

```bash
git add packages/server/src/__tests__/test-helpers.ts
git commit -m "feat: wire ProjectStore into integration test helpers"
```

---

### Task 7: Migrate chapter-statuses.service to ProjectStore

**Requirement:** Design doc "Service Migration Strategy" — migrate simplest service first.

**Files:**
- Modify: `packages/server/src/chapter-statuses/chapter-statuses.service.ts`

This is the simplest service — one function, no transactions, read-only.

#### RED — Verify existing tests pass (baseline)

Run: `npm test -w packages/server -- --run chapter-statuses`
Expected: All pass. This is our safety net — the existing tests must still pass after the refactor.

If any fail: fix them before proceeding. Do not refactor against a broken baseline.

#### GREEN — Migrate the service

Replace the contents of `packages/server/src/chapter-statuses/chapter-statuses.service.ts`:

**Before (current):**
```typescript
import type { ChapterStatusRow as SharedChapterStatusRow } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterStatusRepo from "./chapter-statuses.repository";
import type { ChapterStatusRow } from "./chapter-statuses.types";
```

**After:**
```typescript
import type { ChapterStatusRow as SharedChapterStatusRow } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import type { ChapterStatusRow } from "./chapter-statuses.types";
```

And update the function body:

**Before:**
```typescript
export async function listStatuses(): Promise<SharedChapterStatusRow[]> {
  const db = getDb();
  const rows = await ChapterStatusRepo.list(db);
  return rows.map(toChapterStatus);
}
```

**After:**
```typescript
export async function listStatuses(): Promise<SharedChapterStatusRow[]> {
  const store = getProjectStore();
  const rows = await store.listStatuses();
  return rows.map(toChapterStatus);
}
```

**Run tests to verify migration is correct:**

Run: `npm test -w packages/server -- --run chapter-statuses`
Expected: All tests pass — behavior is identical.

**Run the full server test suite:**

Run: `npm test -w packages/server -- --run`
Expected: All pass — no regressions.

#### REFACTOR

Look for:
- Unused imports left behind (getDb, ChapterStatusRepo)
- Whether the `toChapterStatus` helper could be simplified now that it receives rows from the store

**Commit:**

```bash
git add packages/server/src/chapter-statuses/chapter-statuses.service.ts
git commit -m "refactor: migrate chapter-statuses.service to ProjectStore"
```

---

### Task 8: Migrate chapters.service to ProjectStore

**Requirement:** Design doc "Service Migration Strategy" — migrate chapters.service (moderate complexity, transactions, velocity side-effects).

**Files:**
- Modify: `packages/server/src/chapters/chapters.service.ts`

This is moderately complex — multiple functions, transactions, cross-repo calls (ProjectRepo + ChapterRepo + ChapterStatusRepo), and velocity side-effects outside the store.

#### RED — Verify existing tests pass (baseline)

Run: `npm test -w packages/server -- --run chapters`
Expected: All pass. Safety net for the refactor.

If any fail: fix them before proceeding.

#### GREEN — Migrate the service

**Update imports:**

Replace the repository imports with the store import. Keep the velocity injectable import — velocity stays outside the store.

**Before:**
```typescript
import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterRepo from "./chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import {
  getVelocityService,
  setVelocityService,
  resetVelocityService,
} from "../velocity/velocity.injectable";
```

**After:**
```typescript
import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import {
  getVelocityService,
  setVelocityService,
  resetVelocityService,
} from "../velocity/velocity.injectable";
```

**Migrate each service function:**

Apply this pattern to every function: replace `const db = getDb()` with `const store = getProjectStore()`, replace `SomeRepo.method(db, ...)` with `store.storeMethod(...)`, and replace `db.transaction(async (trx) => { ... })` with `store.transaction(async (txStore) => { ... })`.

**getChapter:**

```typescript
export async function getChapter(id: string): Promise<ChapterWithLabel | null | "corrupt"> {
  const store = getProjectStore();
  const chapter = await store.findChapterById(id);
  if (!chapter) return null;

  if (isCorruptChapter(chapter)) return "corrupt";

  const clean = stripCorruptFlag(chapter);
  const status_label = await store.getStatusLabel(chapter.status);
  return { ...clean, status_label };
}
```

**updateChapter:**

```typescript
export async function updateChapter(
  id: string,
  body: unknown,
): Promise<
  | { chapter: ChapterWithLabel }
  | { validationError: string }
  | { corrupt: true }
  | null
  | "read_after_update_failure"
> {
  const parsed = UpdateChapterSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const store = getProjectStore();
  const chapter = await store.findChapterByIdRaw(id);
  if (!chapter) return null;

  const updates: UpdateChapterData = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.title !== undefined) {
    updates.title = parsed.data.title;
  }

  if (parsed.data.content !== undefined) {
    updates.content = JSON.stringify(parsed.data.content);
    updates.word_count = countWords(parsed.data.content as Record<string, unknown>);
  }

  if (parsed.data.status !== undefined) {
    const valid = !!(await store.findStatusByStatus(parsed.data.status));
    if (!valid) {
      return { validationError: `Invalid status: ${parsed.data.status}` };
    }
    updates.status = parsed.data.status;
  }

  const rowsUpdated = await store.transaction(async (txStore) => {
    const count = await txStore.updateChapter(id, updates);
    if (count === 0) return 0;
    await txStore.updateProjectTimestamp(chapter.project_id);
    return count;
  });

  if (rowsUpdated === 0) return null;

  if (parsed.data.content !== undefined) {
    try {
      const svc = getVelocityService();
      await svc.recordSave(chapter.project_id);
    } catch {
      // Velocity tracking is best-effort; save must still succeed
    }
  }

  const updated = await store.findChapterById(id);
  if (!updated) return "read_after_update_failure";

  if (parsed.data.content !== undefined && isCorruptChapter(updated)) {
    return { corrupt: true };
  }

  const clean = stripCorruptFlag(updated);
  const updatedStatusLabel = await store.getStatusLabel(updated.status);
  return {
    chapter: {
      ...clean,
      status_label: updatedStatusLabel,
    },
  };
}
```

**deleteChapter:**

```typescript
export async function deleteChapter(id: string): Promise<boolean> {
  const store = getProjectStore();
  const chapter = await store.findChapterByIdRaw(id);
  if (!chapter) return false;

  const now = new Date().toISOString();
  await store.transaction(async (txStore) => {
    await txStore.softDeleteChapter(id, now);
    await txStore.updateProjectTimestamp(chapter.project_id);
  });

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch {
    // Velocity tracking is best-effort; delete must still succeed
  }
  return true;
}
```

**restoreChapter:**

```typescript
export async function restoreChapter(
  id: string,
): Promise<RestoredChapterResponse | null | "purged" | "conflict" | "read_failure"> {
  const store = getProjectStore();
  const chapter = await store.findDeletedChapterById(id);
  if (!chapter) return null;

  try {
    const now = new Date().toISOString();
    await store.transaction(async (txStore) => {
      const parentProject = await txStore.findProjectByIdIncludingDeleted(chapter.project_id);
      if (!parentProject) {
        throw new Error("PARENT_PURGED");
      }

      const maxSort = await txStore.getMaxChapterSortOrder(chapter.project_id);
      await txStore.restoreChapter(id, maxSort + 1, now);
      await txStore.updateProjectTimestamp(chapter.project_id);

      if (parentProject.deleted_at) {
        const freshSlug = await txStore.resolveUniqueSlug(
          generateSlug(parentProject.title),
          parentProject.id,
        );
        await txStore.updateProjectIncludingDeleted(chapter.project_id, {
          deleted_at: null,
          updated_at: now,
          slug: freshSlug,
        });
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "PARENT_PURGED") {
      return "purged";
    }
    if ((err as Record<string, unknown>).code === "SQLITE_CONSTRAINT_UNIQUE") {
      return "conflict";
    }
    throw err;
  }

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch {
    // Velocity tracking is best-effort; restore must still succeed
  }

  const restored = await store.findChapterById(id);
  if (!restored) return "read_failure";

  const clean = stripCorruptFlag(restored);
  const updatedProject = await store.findProjectById(chapter.project_id);
  if (!updatedProject) {
    throw new Error(`Project ${chapter.project_id} not found after restore`);
  }
  const restoredStatusLabel = await store.getStatusLabel(restored.status);

  return {
    ...clean,
    status_label: restoredStatusLabel,
    project_slug: updatedProject.slug,
  };
}
```

**Run chapter tests:**

Run: `npm test -w packages/server -- --run chapters`
Expected: All pass.

**Run full server test suite:**

Run: `npm test -w packages/server -- --run`
Expected: All pass — no regressions.

#### REFACTOR

Look for:
- Unused imports left behind (getDb, ChapterRepo, ProjectRepo, ChapterStatusRepo)
- The `generateSlug` import — only used in restoreChapter; verify it's still needed
- Whether any type imports can be simplified now that the store re-exports types
- Consistency of `store` variable naming across all functions

**Commit:**

```bash
git add packages/server/src/chapters/chapters.service.ts
git commit -m "refactor: migrate chapters.service to ProjectStore"
```

---

### Task 9: Migrate projects.service to ProjectStore

**Requirement:** Design doc "Service Migration Strategy" — migrate projects.service last (most complex, multi-repo transactions, slug resolution).

**Files:**
- Modify: `packages/server/src/projects/projects.service.ts`

This is the most complex service — transactions that cross project + chapter repos, slug resolution, title uniqueness checks.

#### RED — Verify existing tests pass (baseline)

Run: `npm test -w packages/server -- --run projects`
Expected: All pass. Safety net for the refactor.

If any fail: fix them before proceeding.

#### GREEN — Migrate the service

**Update imports:**

**Before:**
```typescript
import { v4 as uuid } from "uuid";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ReorderChaptersSchema,
  generateSlug,
  UNTITLED_CHAPTER,
} from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ProjectRepo from "./projects.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import { stripCorruptFlag } from "../chapters/chapters.service";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import type { ProjectRow, ProjectListRow, UpdateProjectData } from "./projects.types";
import type {
  ChapterWithLabel,
  ChapterMetadataRow,
  DeletedChapterRow,
} from "../chapters/chapters.types";
```

**After:**
```typescript
import { v4 as uuid } from "uuid";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ReorderChaptersSchema,
  generateSlug,
  UNTITLED_CHAPTER,
} from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { stripCorruptFlag } from "../chapters/chapters.service";
import type { ProjectRow, ProjectListRow, UpdateProjectData } from "./projects.types";
import type {
  ChapterWithLabel,
  ChapterMetadataRow,
  DeletedChapterRow,
} from "../chapters/chapters.types";
```

**Migrate each service function:**

**createProject:**

```typescript
export async function createProject(
  body: unknown,
): Promise<{ project: ProjectRow; validationError?: undefined } | { validationError: string }> {
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { title, mode } = parsed.data;
  const store = getProjectStore();

  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();

  const project = await store.transaction(async (txStore) => {
    const existing = await txStore.findProjectByTitle(title);
    if (existing) {
      throw new ProjectTitleExistsError();
    }

    const slug = await txStore.resolveUniqueSlug(generateSlug(title));

    const inserted = await txStore.insertProject({
      id: projectId,
      title,
      slug,
      mode,
      created_at: now,
      updated_at: now,
    });

    await txStore.insertChapter({
      id: chapterId,
      project_id: projectId,
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 0,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });

    return inserted;
  });

  return { project };
}
```

**listProjects:**

```typescript
export async function listProjects(): Promise<ProjectListRow[]> {
  const store = getProjectStore();
  return store.listProjects();
}
```

**getProject:**

```typescript
export async function getProject(
  slug: string,
): Promise<{ project: ProjectRow; chapters: ChapterWithLabel[] } | null> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const chapters = await store.listChaptersByProject(project.id);
  const statusLabelMap = await store.getStatusLabelMap();

  const chaptersWithLabels = chapters.map((ch) => {
    const clean = stripCorruptFlag(ch);
    return {
      ...clean,
      status_label: statusLabelMap[ch.status] ?? ch.status,
    };
  });

  return { project, chapters: chaptersWithLabels };
}
```

**updateProject:**

```typescript
export async function updateProject(
  slug: string,
  body: unknown,
): Promise<
  { project: ProjectRow; validationError?: undefined } | { validationError: string } | null
> {
  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const updates: UpdateProjectData = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.target_word_count !== undefined) {
    updates.target_word_count = parsed.data.target_word_count;
  }
  if (parsed.data.target_deadline !== undefined) {
    updates.target_deadline = parsed.data.target_deadline;
  }
  await store.transaction(async (txStore) => {
    if (parsed.data.title !== undefined) {
      const existingTitle = await txStore.findProjectByTitle(parsed.data.title, project.id);
      if (existingTitle) {
        throw new ProjectTitleExistsError();
      }
      const newSlug = await txStore.resolveUniqueSlug(
        generateSlug(parsed.data.title),
        project.id,
      );
      updates.title = parsed.data.title;
      updates.slug = newSlug;
    }
    await txStore.updateProject(project.id, updates);
  });

  const updated = await store.findProjectById(project.id);
  if (!updated) {
    throw new Error(`Project ${project.id} not found after update`);
  }
  return { project: updated };
}
```

**deleteProject:**

```typescript
export async function deleteProject(slug: string): Promise<boolean> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return false;

  const now = new Date().toISOString();

  await store.transaction(async (txStore) => {
    await txStore.softDeleteChaptersByProject(project.id, now);
    await txStore.softDeleteProject(project.id, now);
  });

  return true;
}
```

**createChapter:**

```typescript
export async function createChapter(
  slug: string,
): Promise<ChapterWithLabel | "project_not_found" | "read_after_create_failure"> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return "project_not_found";

  const chapterId = uuid();
  const now = new Date().toISOString();

  await store.transaction(async (txStore) => {
    const maxOrder = await txStore.getMaxChapterSortOrder(project.id);
    await txStore.insertChapter({
      id: chapterId,
      project_id: project.id,
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: maxOrder + 1,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });
    await txStore.updateProjectTimestamp(project.id);
  });

  const chapter = await store.findChapterById(chapterId);
  if (!chapter) return "read_after_create_failure";

  const clean = stripCorruptFlag(chapter);
  const statusLabelMap = await store.getStatusLabelMap();
  return {
    ...clean,
    status_label: statusLabelMap[chapter.status] ?? chapter.status,
  };
}
```

**reorderChapters:**

```typescript
export async function reorderChapters(
  slug: string,
  body: unknown,
): Promise<{ success: true } | { validationError: string } | { mismatch: true } | null> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const parsed = ReorderChaptersSchema.safeParse(body);
  if (!parsed.success) {
    return {
      validationError: parsed.error.issues[0]?.message ?? "chapter_ids must be an array of UUIDs.",
    };
  }
  const { chapter_ids } = parsed.data;

  return store.transaction(async (txStore) => {
    const existingIds = (await txStore.listChapterIdsByProject(project.id)).sort();
    const providedIds = [...chapter_ids].sort();

    if (
      existingIds.length !== providedIds.length ||
      !existingIds.every((id, i) => id === providedIds[i])
    ) {
      return { mismatch: true } as const;
    }

    const orders = chapter_ids.map((id, i) => ({ id, sort_order: i }));
    await txStore.updateChapterSortOrders(orders);
    await txStore.updateProjectTimestamp(project.id);

    return { success: true } as const;
  });
}
```

**getDashboard:**

```typescript
export async function getDashboard(slug: string): Promise<DashboardResponse | null> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const chapters = await store.listChapterMetadataByProject(project.id);

  const allStatuses = await store.listStatuses();
  const statusLabelMap: Record<string, string> = Object.fromEntries(
    allStatuses.map((s) => [s.status, s.label]),
  );

  const chaptersWithLabels = chapters.map((ch) => ({
    ...ch,
    status_label: statusLabelMap[ch.status] ?? ch.status,
  }));

  const statusSummary: Record<string, number> = {};
  for (const s of allStatuses) {
    statusSummary[s.status] = 0;
  }
  for (const ch of chapters) {
    if (ch.status in statusSummary) {
      statusSummary[ch.status] = (statusSummary[ch.status] ?? 0) + 1;
    }
  }

  const totalWordCount = chapters.reduce((sum, ch) => sum + ch.word_count, 0);
  const updatedAts = chapters.map((ch) => ch.updated_at);
  const mostRecentEdit =
    updatedAts.length > 0 ? updatedAts.reduce((a, b) => (a > b ? a : b)) : null;
  const leastRecentEdit =
    updatedAts.length > 0 ? updatedAts.reduce((a, b) => (a < b ? a : b)) : null;

  return {
    chapters: chaptersWithLabels,
    status_summary: statusSummary,
    totals: {
      word_count: totalWordCount,
      chapter_count: chapters.length,
      most_recent_edit: mostRecentEdit,
      least_recent_edit: leastRecentEdit,
    },
  };
}
```

**getTrash:**

```typescript
export async function getTrash(slug: string): Promise<DeletedChapterRow[] | null> {
  const store = getProjectStore();
  const project = await store.findProjectBySlugIncludingDeleted(slug);
  if (!project) return null;

  return store.listDeletedChaptersByProject(project.id);
}
```

**Run project tests:**

Run: `npm test -w packages/server -- --run projects`
Expected: All pass.

**Run full server test suite:**

Run: `npm test -w packages/server -- --run`
Expected: All pass — no regressions.

#### REFACTOR

Look for:
- Unused imports left behind (getDb, ProjectRepo, ChapterRepo, ChapterStatusRepo)
- Whether `stripCorruptFlag` import from chapters.service is still the right import path
- The `deleteProject` comment about skipping updateDailySnapshot — verify it still makes sense through the store
- Whether `DashboardResponse` type and `ChapterMetadataWithLabel` interface can be moved to a shared types file
- Consistency of `store` / `txStore` naming across all functions

**Commit:**

```bash
git add packages/server/src/projects/projects.service.ts
git commit -m "refactor: migrate projects.service to ProjectStore"
```

---

### Task 10: Final Verification

**Requirement:** All design non-goals — verify no schema, API, or user-facing changes. Full CI pass.

**Step 1: Run lint**

Run: `make lint`
Expected: No errors.

**Step 2: Run format**

Run: `make format`
Expected: No changes needed (or auto-fixed).

**Step 3: Run TypeScript check**

Run: `npx tsc --noEmit -p packages/server/tsconfig.json`
Expected: No errors.

**Step 4: Run full test suite with coverage**

Run: `make cover`
Expected: All tests pass, coverage thresholds met.

**Step 5: Run e2e tests**

Run: `make e2e`
Expected: All e2e tests pass — behavior is identical from the API level.

**Step 6: Commit any formatting fixes**

If `make format` made changes:

```bash
git add -A
git commit -m "style: apply formatting after ProjectStore migration"
```
