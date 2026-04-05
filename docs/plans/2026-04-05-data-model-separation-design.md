# Data Model Separation Design

**Date:** 2026-04-05
**Branch:** ovid/data-model
**Status:** Approved

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
- Repositories are called only by services.
- **Documented exceptions:** Migrations and infrastructure jobs (purge, image cleanup, health checks) may access the data layer directly.

## Directory Structure

```
packages/server/src/
  projects/
    projects.routes.ts
    projects.service.ts
    projects.repository.ts
    projects.types.ts
  chapters/
    chapters.routes.ts
    chapters.service.ts
    chapters.repository.ts
    chapters.types.ts
  velocity/
    velocity.routes.ts
    velocity.service.ts
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
    connection.ts
    knexfile.ts
    purge.ts
    migrations/
  app.ts
  index.ts
```

Existing helper files (`parseChapterContent.ts`, `resolve-slug.ts`, `chapterQueries.ts`, `velocityHelpers.ts`, `status-labels.ts`) are absorbed into their respective domain's service or repository.

Future phases add new domain folders following the same pattern (e.g., `snapshots/`, `outtakes/`, `characters/`, `scenes/`).

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
async function createProject(data: CreateProjectInput) {
  return db.transaction(async (trx) => {
    const slug = await resolveUniqueSlug(trx, data.title);
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
  const [row] = await trx('projects').insert(data).returning('*');
  return row;
}
```

### Cross-Domain Coordination

When a service needs another domain's repository (e.g., project creation needing `ChapterRepo.insert`), it imports that repository directly. Services may also call other services when the other domain's business logic is needed.

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
  await VelocityService.recordSave(result.projectId, id, result.wordCount)
    .catch(err => logger.error('velocity tracking failed', err));
  return result;
}
```

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
6. Add unit tests for all services and repositories.
7. Verify existing integration tests (Supertest) and e2e tests (Playwright) pass without modification.

### Testing

- **Existing integration tests** (Supertest) are the safety net — they validate behavior end-to-end and must pass unchanged.
- **New repository unit tests** — test each repository function against a real SQLite database (consistent with project testing philosophy: no mocks).
- **New service unit tests** — test business logic, orchestration, and mapping. Services are tested with real repositories and a real database (same philosophy).
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
