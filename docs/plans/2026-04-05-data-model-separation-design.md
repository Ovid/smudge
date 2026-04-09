# Data Model Separation Design

**Date:** 2026-04-05
**Branch:** ovid/data-model
**Status:** Approved (post-pushback review)

---

## Problem

The server package has business logic and data access mixed into route handlers. Routes directly call Knex, build queries inline, and embed validation, side effects, and orchestration in the same functions. This works today with 6 tables, but the roadmap grows to 15+ tables across Phases 3–7 (characters, scenes, world-building, sources, argument nodes, snapshots, outtakes, etc.). A planned SQLite replacement makes encapsulation critical.

## Solution

Separate the server into three layers with domain-based file grouping:

- **Routes** — HTTP concerns only: parse request, call service, format response.
- **Services** — Business logic: validation, transaction boundaries, cross-domain coordination, invariant enforcement.
- **Repositories** — Data CRUD only: queries, inserts, updates, deletes. Fully opaque to services.

## Access Rules

- Routes call services. Never repositories.
- Services call repositories. Services may call other services for cross-domain coordination.
- Services may import another domain's repository directly when cross-domain data access is needed (e.g., project creation needs `ChapterRepo.insert`, dashboard needs `ChapterRepo.listByProject`).
- Repositories are called only by services.
- **Documented exceptions:** Migrations and infrastructure jobs (purge, image cleanup, health checks) may access the data layer directly.

## Directory Structure

```
packages/server/src/
  projects/
    projects.routes.ts
    projects.service.ts
    projects.repository.ts     # Owns resolveUniqueSlug (used by chapters service too)
    projects.types.ts
  chapters/
    chapters.routes.ts
    chapters.service.ts
    chapters.repository.ts
    chapters.types.ts
  velocity/
    velocity.routes.ts
    velocity.service.ts        # Injectable for testing failure paths
    velocity.repository.ts
    velocity.types.ts
  settings/
    settings.routes.ts
    settings.service.ts
    settings.repository.ts
    settings.types.ts
  chapter-statuses/
    chapter-statuses.routes.ts
    chapter-statuses.service.ts
    chapter-statuses.repository.ts
    chapter-statuses.types.ts
  db/
    connection.ts              # Singleton with setDb() for test injection
    knexfile.ts
    purge.ts
    migrations/
  app.ts
  index.ts
```

Existing helper files (`parseChapterContent.ts`, `resolve-slug.ts`, `chapterQueries.ts`, `velocityHelpers.ts`, `status-labels.ts`) are absorbed into their respective domain's service or repository.

Future phases add new domain folders following the same pattern (e.g., `snapshots/`, `outtakes/`, `characters/`, `scenes/`).

## Database Connection Management

Services import `db` directly from the `db/connection.ts` singleton module. Routes do not pass `db` — they just call service functions. `app.ts` mounts routers without passing `db`.

The `connection.ts` module exports:

- `db` — the current Knex instance (used by services for `db.transaction()`)
- `initDb(config)` — initializes the singleton (called at server startup)
- `setDb(instance)` — replaces the singleton (called by test setup to inject in-memory databases)

This preserves the existing `createApp(testDb)` test pattern while letting services import the connection directly.

## Type Flow

```
DB row → Repository (returns internal type) → Service (maps to shared type) → Route (returns to client)
```

### Internal Types

Each domain defines its own `*.types.ts` with row-level types that mirror the DB schema. These are private to the server package — never exported to shared.

```typescript
// projects/projects.types.ts
export interface ProjectRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  target_word_count: number | null;
  target_deadline: string | null;
  completion_threshold: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateProjectRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  created_at: string;
  updated_at: string;
}
```

### Mapping

Services map between internal and shared types via mapping functions:

```typescript
// projects/projects.service.ts
import type { Project } from '@smudge/shared';
import type { ProjectRow } from './projects.types';

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    mode: row.mode as ProjectMode,
    // ... map fields, parse dates, etc.
  };
}
```

When the database is swapped, internal types and mapping functions change. Shared types and routes do not.

## Transaction Handling

Services own transaction boundaries. The transaction handle is passed to repository calls.

```typescript
// projects/projects.service.ts
import { db } from '../db/connection';

async function createProject(data: CreateProjectInput) {
  return db.transaction(async (trx) => {
    const slug = await ProjectRepo.resolveUniqueSlug(trx, generateSlug(data.title));
    const projectRow = await ProjectRepo.insert(trx, { ... });
    const chapterRow = await ChapterRepo.insert(trx, { ... });
    return toProjectWithChapters(projectRow, [chapterRow]);
  });
}
```

Repository functions always accept a `Knex.Transaction` as their first parameter:

```typescript
// projects/projects.repository.ts
async function insert(trx: Knex.Transaction, data: CreateProjectRow): Promise<ProjectRow> {
  await trx('projects').insert(data);
  return trx('projects').where({ id: data.id }).first();
}
```

**Note on `.returning()`:** better-sqlite3 does not support `.returning('*')`. All repository insert/update functions that need to return the modified row must do a separate select query after the write. This is encapsulated within the repository — callers always get back the expected type.

### Transaction Type Coupling

Repository function signatures use `Knex.Transaction` as their first parameter. This means services have a type-level dependency on Knex, even though they never call Knex methods on the handle — they just pass it through. This is a pragmatic trade-off, documented here as a known coupling point. When Knex is replaced, repository signatures and service import statements will need updating, but service logic will not change.

### Cross-Domain Coordination

When a service needs another domain's repository (e.g., project creation needing `ChapterRepo.insert`), it imports that repository directly. Services may also call other services when the other domain's business logic is needed.

**Slug resolution:** `resolveUniqueSlug` lives in the projects repository since it's a query concern ("is this slug taken?"). It's used by:
- Projects service — on create and title update
- Chapters service — on restore (when the parent project's slug may conflict)

### Dashboard Aggregation

`GET /api/projects/:slug/dashboard` stays in the projects domain. The projects service imports `ChapterRepo.listByProject` and `ChapterStatusRepo.list` to get the data, then does JavaScript-level aggregation. This matches the URL structure and the mental model (dashboard is a project-level view).

### Velocity Side Effects

The chapter service calls the velocity service after a successful save, best-effort and outside the main transaction (preserving the existing pattern):

```typescript
// chapters/chapters.service.ts
async function updateContent(id: string, content: TipTapDoc) {
  const result = await db.transaction(async (trx) => {
    const wordCount = countWords(content);
    const row = await ChapterRepo.updateContent(trx, id, content, wordCount);
    return toChapter(row);
  });
  await velocityService.recordSave(result.projectId, id, result.wordCount)
    .catch(err => logger.error('velocity tracking failed', err));
  return result;
}
```

**Velocity service injection:** The velocity service is injectable (passed as a parameter or set via a module-level setter) so that tests can provide a throwing implementation to verify that save-failure resilience works. This is a narrow, documented exception to the "no mocks, real database" testing philosophy — it tests the error-handling path that's impractical to trigger with a real database.

## Repository Boundaries

Repositories are the only code that knows about Knex, SQL, table names, or column names.

**Repositories expose:**
- Functions named by intent: `insert`, `findById`, `findBySlug`, `updateTitle`, `softDelete`, `listByProject`
- Internal types in, internal types out
- Accept a `Knex.Transaction` as first parameter

**Repositories hide:**
- Table names, column names, join logic
- `whereNull('deleted_at')` filtering (baked into every query)
- JSON string parsing (content stored as text, parsed in repository)
- Sort order logic, COALESCE expressions, aggregations
- Insert-then-select pattern (better-sqlite3 `.returning()` limitation)

**Soft-delete rule:** Every "find" and "list" function filters `deleted_at IS NULL` by default. `listDeleted` is the explicit inverse for the trash view.

### Example Repository Interface

```typescript
// chapters/chapters.repository.ts
async function findById(trx: Knex.Transaction, id: string): Promise<ChapterRow | null>
async function listByProject(trx: Knex.Transaction, projectId: string): Promise<ChapterRow[]>
async function insert(trx: Knex.Transaction, data: CreateChapterRow): Promise<ChapterRow>
async function updateContent(trx: Knex.Transaction, id: string, content: object, wordCount: number): Promise<ChapterRow>
async function updateTitle(trx: Knex.Transaction, id: string, title: string): Promise<ChapterRow>
async function updateStatus(trx: Knex.Transaction, id: string, status: string): Promise<ChapterRow>
async function updateSortOrders(trx: Knex.Transaction, orders: { id: string; sortOrder: number }[]): Promise<void>
async function softDelete(trx: Knex.Transaction, id: string): Promise<void>
async function restore(trx: Knex.Transaction, id: string): Promise<ChapterRow>
async function listDeleted(trx: Knex.Transaction, projectId: string): Promise<ChapterRow[]>
```

## Migration Strategy

All at once in a single branch. The refactor is pure restructuring — no behavior changes.

1. Create all domain folders and files.
2. Extract repositories from existing route handler queries.
3. Extract services from existing route handler business logic.
4. Rewrite routes as thin HTTP handlers that call services.
5. Absorb helper files into their respective domains.
6. Refactor `db/connection.ts` to support `setDb()` for test injection.
7. Update `app.ts` to mount routers without passing `db`.
8. Add unit tests for all services and repositories.
9. Verify existing integration tests (Supertest) and e2e tests (Playwright) pass without modification.

### Testing

- **Existing integration tests** (Supertest) are the safety net — they validate behavior end-to-end and must pass unchanged.
- **New repository unit tests** — test each repository function against a real SQLite database (consistent with project testing philosophy: no mocks).
- **New service unit tests** — test business logic, orchestration, and mapping. Services are tested with real repositories and a real database (same philosophy).
- **Velocity failure path exception** — the velocity service is injectable so tests can verify that save operations succeed even when velocity tracking fails. This is the one case where a test double is used instead of the real implementation.
- **Existing e2e tests** (Playwright) must pass unchanged.

## Future Phases

As the roadmap adds entities, each gets its own domain folder:

| Phase | New Domains |
|-------|------------|
| 3 (Export) | `export/` |
| 4 (Annotations) | `snapshots/`, `outtakes/`, `images/` |
| 5a (Fiction) | `characters/`, `scenes/` |
| 5b (World-Building) | `world-entries/` |
| 5c (Visualizations) | `relationships/`, `timeline-events/` |
| 6a (Research) | `sources/` |
| 6b (Arguments) | `argument-nodes/` |
| 7 (Polish) | `journal/` |

## Pushback Review Log

Reviewed 2026-04-05. Seven issues found, all resolved:

| # | Issue | Severity | Resolution |
|---|-------|----------|-----------|
| 1 | `.returning('*')` unsupported by better-sqlite3 | Critical | Insert + select internally in repository |
| 2 | `resolveUniqueSlug` domain ownership ambiguous | Serious | Lives in projects repository, imported by chapters service |
| 3 | Dashboard endpoint crosses domain boundaries | Moderate | Stays in projects service, imports chapter/status repos |
| 4 | `Knex.Transaction` type leaks into services | Moderate | Accepted as pragmatic trade-off, documented |
| 5 | Testing velocity failure path needs injection | Moderate | Injectable velocity service for that specific case |
| 6 | How `db` reaches services unspecified | Minor | Services import singleton from `db/connection.ts` |
| 7 | Test DB injection breaks with singleton | Minor | `setDb()` function in `connection.ts` for test setup |
