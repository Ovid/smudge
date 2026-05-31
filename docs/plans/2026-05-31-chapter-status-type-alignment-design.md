# Phase 4b.9: Chapter Status Type Alignment — Design

**Date:** 2026-05-31
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.9 (`docs/roadmap.md`)
**Status:** Design approved; plan pending

## Goal

Close the type-system gap where `Chapter.status` and `ChapterStatusRow.status`
in `packages/shared/src/types.ts` are typed as the open `string`, while the
runtime contract is the closed Zod enum
`z.enum(["outline", "rough_draft", "revised", "edited", "final"])`. Introduce a
`z.infer` alias, `ChapterStatusValue`, retype both interface fields to it, and
**propagate the tightened type through the entire client status-change chain
and the status-color map** (Option B). The server participates only at the one
seam where it maps a raw DB row into a shared type.

No DB, API, or runtime behavior change. This is a compile-time-only tightening.

## Why Now

Today TypeScript silently accepts `chapter.status === "publishd"` typos because
the static type (`string`) is wider than the schema. Code that iterates over the
status set must reach for the schema rather than the type, and the status-color
map silently falls back to grey for an unknown key. Runtime safety is unaffected
(Zod gates write paths; seed data defines the set), but the type system is not
load-bearing where it should be — the data model lies about its own shape, and
the handler chain that *mutates* status accepts any string. Reference:
`paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md`
finding I3.

## Scope Decision: Option B (propagate), not Option A (minimal)

Two options were weighed:

- **Option A — minimal:** retype only the two shared interface fields + fix what
  `tsc` surfaces. Smallest PR, matches the roadmap's literal wording, but the
  safety is *shallow*: because a narrow union flows freely into a wider `string`
  parameter, the status-change handler chain (`onStatusChange` → `selectStatus`
  → `handleStatusChange`) still accepts any string internally, and the color map
  stays unchecked.
- **Option B — propagate (chosen):** also retype the client handler chain and
  make the color map an exhaustive `Record<ChapterStatusValue, string>`. Deeper
  end-to-end safety: a bogus status is rejected no matter where it is
  introduced, and adding a future status forces a color for it or the build
  fails. Still a single feature (status-type alignment), so the one-feature PR
  rule is respected; the blast radius is wider but almost entirely mechanical
  and confined to the client.

Ovid chose Option B: the status-change handler chain is the real writer-facing
risk surface, so shallow safety there is the whole problem worth fixing.

## Architecture / Boundary Map

A survey established who consumes the shared types:

- **Client** consumes shared `Chapter` and `ChapterStatusRow` pervasively
  (`api/client.ts`, `Sidebar.tsx`, `EditorMainContent.tsx`, `EditorPage.tsx`,
  `DashboardView.tsx`, `useChapterMetadata.ts`).
- **Server** uses its own internal row types (`ChapterRow`,
  `ChapterMetadataRow`, `ChapterRawRow`, `DeletedChapterRow`, `CreateChapterRow`
  in `chapters/chapters.types.ts`), all `status: string`, and **never imports
  the shared `Chapter`**. The only seam where the server touches a *shared* type
  is `chapter-statuses.service.ts`'s `toChapterStatus(row): SharedChapterStatusRow`.

Therefore Option B is overwhelmingly a client-side sweep, with exactly one
server cast.

## Changes

### 1. Shared type (root)

`packages/shared/src/schemas.ts`:

```ts
export type ChapterStatusValue = z.infer<typeof ChapterStatus>;
```

`packages/shared/src/types.ts`: import `ChapterStatusValue` and change
`status: string` → `status: ChapterStatusValue` in `Chapter` and
`ChapterStatusRow`. (`status_label?: string` and `ChapterStatusRow.label`
remain `string`.)

### 2. Client sweep (Option B)

- `statusColors.ts`: `Record<string, string>` → `Record<ChapterStatusValue, string>`
  (exhaustive — the five keys exist today; a future status without a color will
  not compile).
- `components/Sidebar.tsx`: the three `onStatusChange: (chapterId: string,
  status: string)` signatures → `status: ChapterStatusValue`; `selectStatus(status: string)`
  → `ChapterStatusValue`.
- `hooks/useChapterMetadata.ts`: `handleStatusChange(chapterId, status, onError?)`
  status param → `ChapterStatusValue` (flows through `useProjectEditor` /
  `useChapterCrud` re-exports unchanged).
- `pages/EditorPage.tsx`: `handleStatusChangeWithError(chapterId, status)` →
  `ChapterStatusValue`.
- `api/client.ts`:
  - `chapters.update` payload `status?: string` → `status?: ChapterStatusValue`
    (a **write** — this is what pushes the safety end-to-end through the handler
    chain).
  - `projects.dashboard` inline response: chapter `status: string` →
    `ChapterStatusValue`; `status_summary: Record<string, number>` →
    `Partial<Record<ChapterStatusValue, number>>` (honestly models a sparse
    summary; existing code already uses `?? 0`).

### 3. Server (DB-boundary only)

- `chapter-statuses/chapter-statuses.service.ts` `toChapterStatus()`:
  `status: row.status` now maps raw-text `string` into the tightened shared
  `ChapterStatusRow`, so it takes one cast: `status: row.status as ChapterStatusValue`,
  with a one-line comment noting this is the trusted DB→type boundary (Zod gates
  writes; seed data guarantees the set).
- Server-internal row types stay `status: string` **deliberately**: they are the
  DB boundary, they are out of the roadmap's scope, and they are never assigned
  into a shared `Chapter`. The server's `DashboardResponse.status_summary` stays
  `Record<string, number>` (server-internal; the wire is JSON, so client/server
  type asymmetry across the boundary is acceptable and already the norm).

## Testing — RED → GREEN for a type-only change

Precedent: `packages/shared/src/__tests__/types.test.ts` already uses
`expectTypeOf` + `@ts-expect-error`, enforced by `npm run typecheck` (the
`tsc -b` step in `make all`) — Vitest/Vite transpiles tests so the project
`tsc` is the gate.

Add to that file (or a sibling):

1. **RED via missing type:**
   `expectTypeOf<ChapterStatusValue>().toEqualTypeOf<"outline" | "rough_draft" | "revised" | "edited" | "final">()`
   — fails to compile until `ChapterStatusValue` exists.
2. **RED via unused directive:**
   ```ts
   // @ts-expect-error — "published" is not a ChapterStatusValue
   const bad: Chapter["status"] = "published";
   ```
   Before the change, `Chapter["status"]` is `string`, so `"published"` is
   assignable → the `@ts-expect-error` is unused → `tsc` errors (TS2578) → RED.
   After tightening, the assignment errors → directive satisfied → GREEN.
3. **Runtime drift pin:** assert `ChapterStatus.options` deep-equals the five
   literals, mirroring the file's existing runtime-assert pattern, so the schema
   and the inferred type cannot silently drift and the test file registers a
   runtime test.

**Regression net:** all existing behavioral suites (chapters, Sidebar,
DashboardView, useProjectEditor) must stay green — they prove zero runtime
change. `make all` (lint-check, format-check, typecheck, coverage, e2e) green at
PR close.

## Expected Test Churn

Test fixtures using bare `status: "outline"` literals are fine — a string
literal is assignable to the union under a union contextual type. The only edits
expected are any test-local helper that explicitly declares a `status: string`
parameter and feeds a genuinely-`string` value into a tightened slot; these are
surfaced by `tsc` and fixed as found. No bulk rewrite anticipated.

## Notable Micro-Decision

`Sidebar.tsx`: `const currentStatus = chapter.status || "outline"` — once
`status` is a non-nullable union, the `|| "outline"` fallback is statically
dead. **Leave it untouched** (harmless defensive runtime code; removing it is a
behavior-adjacent change outside this phase's intent), unless lint/`tsc`
objects, in which case note and resolve minimally.

## Definition of Done

- `ChapterStatusValue` exported from `schemas.ts`; `Chapter.status` and
  `ChapterStatusRow.status` typed as `ChapterStatusValue`.
- Client status-change chain and `STATUS_COLORS` typed to `ChapterStatusValue`
  (exhaustive color map).
- One server DB-boundary cast in `toChapterStatus()`.
- Type-assertion test landed (RED→GREEN demonstrated).
- `tsc` green; any caller using an off-enum literal fixed.
- `make all` green.
- No behavior change visible to the user.

## Out of Scope

- DB or API changes — both already enforce the enum at write time.
- Migration of `chapter_statuses` table seed data.
- Renaming `ChapterStatus` (the schema export name).
- Tightening server-internal row types beyond the single `toChapterStatus` cast.

## Dependencies

None. Independently shippable. May land alongside or in parallel with 4b.8.
