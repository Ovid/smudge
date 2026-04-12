# Phase 2.5b: Storage Architecture — Design Document

**Date:** 2026-04-12
**Phase:** 2.5b (Storage Architecture)
**Depends on:** Phase 2.5a (Simplify Progress Model) — Done
**Author:** Ovid / Claude (collaborative)

---

## Goal

Introduce a `ProjectStore` interface between services and the existing project/chapter/chapter-status repositories. This creates a clean seam so that Phase 8 (per-project SQLite) can swap the storage backend without rewriting service logic. AssetStore and SnapshotStore are defined as interface-only contracts for future phases.

## Non-goals

- No database schema changes
- No API changes
- No user-facing changes
- No dependency injection framework
- No implementation of AssetStore or SnapshotStore — interfaces only
- No refactoring of settings or velocity repositories (they remain independent)

---

## Design Decisions

These decisions were made during brainstorming and refined by pushback review.

1. **Interface-only abstraction (thinnest layer).** The store delegates to existing repositories 1:1. No new API surface, no facade, no DI container.

2. **AssetStore and SnapshotStore: interfaces only, no implementations.** No current consumers exist. Implementations arrive with Phase 4a (images) and Phase 4b (snapshots).

3. **ProjectStore covers projects + chapters + chapter-statuses.** Settings and velocity remain independent — they are app-level concerns, not manuscript data. When Phase 8 gives each project its own SQLite DB, statuses travel with the project but settings do not.

4. **Module-level singleton access** via `getProjectStore()` / `setProjectStore()` / `initProjectStore()`. Matches the existing `getDb()` and `velocity.injectable.ts` patterns.

5. **`null` for not-found returns** to match existing repository conventions. No `null` → `undefined` conversion.

6. **Method names mirror repository names** — `insertProject` not `createProject`, `insertChapter` not `createChapter`. The store is delegation, not a new API.

7. **`transaction()` exposes both a scoped store and the raw `trx`** so services can still pass `trx` to velocity or settings repos within the same transaction.

8. **No `purgeDeletedProjects` or `restoreProject`** — these methods do not exist in current repositories. Added when needed (YAGNI).

---

## ProjectStore Interface

The interface covers every method currently exposed by the three wrapped repositories: `projects.repository`, `chapters.repository`, and `chapter-statuses.repository`.

```typescript
// packages/server/src/stores/project-store.types.ts

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
  restoreChapter(id: string, sortOrder: number, now: string): Promise<number>;

  // --- Chapter statuses ---

  listStatuses(): Promise<ChapterStatusRow[]>;
  findStatusByStatus(status: string): Promise<ChapterStatusRow | undefined>;
  getStatusLabel(status: string): Promise<string>;
  getStatusLabelMap(): Promise<Record<string, string>>;

  // --- Transactions ---

  /** Run a function within a database transaction.
   *  The callback receives a transaction-scoped store and the raw Knex
   *  transaction (escape hatch for repos not covered by this store,
   *  e.g., velocity or settings). */
  transaction<T>(fn: (txStore: ProjectStore, trx: Knex.Transaction) => Promise<T>): Promise<T>;
}
```

### Notes on naming

Repository methods are prefixed with the entity name to avoid ambiguity in a combined interface:
- `findById` → `findProjectById` / `findChapterById`
- `listAll` → `listProjects`
- `list` (statuses) → `listStatuses`
- `softDeleteByProject` → `softDeleteChaptersByProject`
- `findByStatus` → `findStatusByStatus`

Return types and signatures match the existing repositories exactly. The only difference is the removal of the leading `trx` parameter — the store holds its own connection internally.

---

## AssetStore Interface (types only)

No implementation until Phase 4a (Reference Panel & Images).

```typescript
// packages/server/src/stores/asset-store.types.ts

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

---

## SnapshotStore Interface (types only)

No implementation until Phase 4b (Snapshots & Find-and-Replace).

```typescript
// packages/server/src/stores/snapshot-store.types.ts

export type SnapshotType = "auto" | "manual" | "pre-destructive-op";

export interface SnapshotRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  snapshot_type: SnapshotType;
  label: string | null;
  content: string; // TipTap JSON, stringified
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

---

## SqliteProjectStore Implementation

Thin delegation layer over the three existing repositories.

```typescript
// packages/server/src/stores/sqlite-project-store.ts

import type { Knex } from "knex";
import type { ProjectStore } from "./project-store.types";
import * as projectsRepo from "../projects/projects.repository";
import * as chaptersRepo from "../chapters/chapters.repository";
import * as statusesRepo from "../chapter-statuses/chapter-statuses.repository";

export class SqliteProjectStore implements ProjectStore {
  constructor(private db: Knex.Transaction | Knex) {}

  // --- Projects (delegates to projectsRepo) ---

  insertProject(data)      { return projectsRepo.insert(this.db, data); }
  findProjectById(id)      { return projectsRepo.findById(this.db, id); }
  // ... each method delegates: return repo.method(this.db, ...args)

  // --- Chapters (delegates to chaptersRepo) ---

  insertChapter(data)      { return chaptersRepo.insert(this.db, data); }
  findChapterById(id)      { return chaptersRepo.findById(this.db, id); }
  // ... same pattern

  // --- Statuses (delegates to statusesRepo) ---

  listStatuses()           { return statusesRepo.list(this.db); }
  // ... same pattern

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

Every method is a one-liner that passes `this.db` as the first argument to the corresponding repository function. The full implementation will have all ~30 methods written out explicitly with proper TypeScript signatures — the pseudocode above shows the pattern.

---

## Injectable (Singleton Access)

```typescript
// packages/server/src/stores/project-store.injectable.ts

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

---

## File Organization

```
packages/server/src/stores/
  project-store.types.ts        # ProjectStore interface
  asset-store.types.ts           # AssetStore interface (types only, no implementation)
  snapshot-store.types.ts        # SnapshotStore interface (types only, no implementation)
  sqlite-project-store.ts        # SqliteProjectStore — delegates to existing repos
  project-store.injectable.ts    # getProjectStore / setProjectStore / initProjectStore
  index.ts                       # re-exports
```

---

## Startup Wiring

In the server bootstrap (wherever `initDb()` is called):

```typescript
initDb();            // existing
initProjectStore();  // new — called immediately after initDb()
```

---

## Service Migration Strategy

Services are migrated one at a time. Each migration is a single commit.

### Migration order

1. **chapter-statuses.service** — simplest, read-only, few methods
2. **chapters.service** — moderate complexity, some transactions
3. **projects.service** — most complex, multi-repo transactions, slug resolution

### What changes in each service

**Before:**
```typescript
import { getDb } from "../db/connection";
import * as projectsRepo from "../projects/projects.repository";

export async function getProject(id: string) {
  const db = getDb();
  return projectsRepo.findById(db, id);
}

export async function deleteProject(id: string) {
  const db = getDb();
  await db.transaction(async (trx) => {
    await chaptersRepo.softDeleteByProject(trx, id, now);
    await projectsRepo.softDelete(trx, id, now);
  });
}
```

**After:**
```typescript
import { getProjectStore } from "../stores/project-store.injectable";

export async function getProject(id: string) {
  const store = getProjectStore();
  return store.findProjectById(id);
}

export async function deleteProject(id: string) {
  const store = getProjectStore();
  await store.transaction(async (txStore) => {
    await txStore.softDeleteChaptersByProject(id, now);
    await txStore.softDeleteProject(id, now);
  });
}
```

For transactions that also touch velocity (e.g., chapter update triggers a daily snapshot):

```typescript
await store.transaction(async (txStore, trx) => {
  await txStore.updateChapter(id, updates);
  // velocity is outside the store — use the raw trx escape hatch
  await velocityRepo.upsertDailySnapshot(trx, projectId, date, totalWords);
});
```

### Test migration

Tests that currently set up a test DB and call repos directly continue to work. Tests that go through services update to use `setProjectStore(new SqliteProjectStore(testDb))` in setup.

---

## What This Enables

- **Phase 8 (per-project SQLite):** Swap `SqliteProjectStore` for a `ProjectPackageStore` that opens a per-project `.smudge/project.sqlite` file. Services don't change.
- **Phase 4a (images):** Implement `AssetStore` against the interface already defined here.
- **Phase 4b (snapshots):** Implement `SnapshotStore` against the interface already defined here.
- **Testing:** Mock the entire store for service-level unit tests without touching SQLite.

---

## Open Questions

None — all design questions were resolved during brainstorming and pushback review.
