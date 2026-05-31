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
  status param → `ChapterStatusValue`. **Also** the optimistic-revert path:
  `previousStatus` is read from `confirmedStatusRef` and spread back as
  `{ ...c, status: previousStatus }`; once `Chapter.status` is a union, that
  override is only type-clean if the ref stores the union (see next bullet).
- `hooks/useProjectEditor.ts` + `hooks/useProjectEditor.types.ts`: the
  status-confirmation ref and its seeder, **surfaced by pushback finding [1]**.
  `confirmedStatusRef: MutableRefObject<Record<string, string | undefined>>`
  (declared once in `useProjectEditor.ts` and twice in the `.types.ts` prop
  interfaces) → `Record<string, ChapterStatusValue | undefined>`; and
  `seedConfirmedStatus(id, status: string)` param → `ChapterStatusValue`. Without
  this, the revert spread above is a TS2322. These files were missing from the
  original change list.
- `components/DashboardView.tsx`: **surfaced by pushback finding [2]**. The
  fetch-failed fallback builds `const effectiveStatuses: ChapterStatusRow[]` from
  `Object.entries(status_summary).map(([status]) => ({ status, … }))`.
  `Object.entries` keys are always `string`, so this needs an explicit cast
  (`status: status as ChapterStatusValue`) at that derive-from-keys boundary —
  the value genuinely came from a server-validated summary. Audit the file's
  defensive branches while here (finding [3]): `statusSortOrder[a.status] ?? null`
  and `STATUS_COLORS[s.status] ?? "#999"` become statically dead once the keys
  are a closed union (same situation as the Sidebar `|| "outline"` note); **leave
  them untouched** as harmless defensive runtime code. `Object.values(status_summary)
  .reduce(…)` and `status_summary[s.status] ?? 0` stay live and type-clean because
  `Partial<Record<…>>` indexing yields `number | undefined`.
- `pages/EditorPage.tsx`: `handleStatusChangeWithError(chapterId, status)` →
  `ChapterStatusValue` (flows through `useProjectEditor` / `useChapterCrud`
  re-exports unchanged otherwise).
- `api/client.ts`:
  - `chapters.update` payload `status?: string` → `status?: ChapterStatusValue`
    (a **write** — this is what pushes the safety end-to-end through the handler
    chain).
  - `projects.dashboard` inline response: chapter `status: string` →
    `ChapterStatusValue`; `status_summary: Record<string, number>` →
    `Partial<Record<ChapterStatusValue, number>>` (honestly models a sparse
    summary; existing code already uses `?? 0`).
  - **Intentional client/server asymmetry (finding [6]):** the server's
    `DashboardResponse.status_summary` stays `Record<string, number>` while this
    client inline type narrows it. The shared `ChapterStatus` enum is the single
    source of truth, but this endpoint re-declares its shape inline, so add a
    short code comment at the client inline type noting the asymmetry is
    deliberate (JSON boundary) and that the enum is the contract both sides
    track.

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

### 4. CLAUDE.md note (deliverable, not afterthought)

Add a short invariant to `CLAUDE.md` §Key Architecture Decisions so a future
change cannot silently re-widen the status type (the regression this phase
exists to prevent), scoped to stay accurate about the server boundary:

> **Chapter status is a closed type.** `ChapterStatusValue`
> (`z.infer<typeof ChapterStatus>`, `packages/shared/src/schemas.ts`) is the
> canonical type for a chapter's status across shared and client code — derive
> from it; never re-declare status as `string`. The server's internal DB-row
> types (`ChapterRow` et al.) intentionally keep `status: string` at the SQLite
> persistence boundary, casting to `ChapterStatusValue` only where they cross
> into a shared type (e.g. `toChapterStatus`).

This is a task in the implementation plan, landing in the same PR as the code.

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

**RED gate command (finding [5]):** the RED state for test #2 manifests **only**
under `tsc -b` — i.e. `npm run typecheck` (or `make typecheck` / the typecheck
phase of `make all`) — **not** under `npm test`, because Vitest/Vite transpiles
tests and never runs `tsc` (the existing `types.test.ts` documents this). The
implementation plan must specify `npm run typecheck` as the command that
demonstrates RED; running only `npm test` would show misleading green.

**Regression net:** all existing behavioral suites (chapters, Sidebar,
DashboardView, useProjectEditor) must stay green — they prove zero runtime
change. `make all` (lint-check, format-check, typecheck, coverage, e2e) green at
PR close.

## Expected Test Churn

The earlier blanket claim that "fixtures are fine" was wrong (pushback finding
[4]) and is corrected here:

- **Bare valid literals are fine.** `status: "outline"` etc. in a `Chapter`-typed
  fixture remain assignable to the union under a union contextual type.
- **Off-enum literals break — and that is the point.** Several invalid status
  literals exist in the test suites today, hidden by the loose `string` type, and
  the tightening turns each into a TS2322. Known cases: `useTrashManager.test.ts`
  (a `"drafting"` fixture **and** a matching `toHaveBeenCalledWith(..., "drafting")`
  assertion — both must change together) and `useProjectEditor.test.ts` (multiple
  `"drafting"` stand-in statuses across the I21 revert regression tests, in
  typechecked `handleStatusChange(..., "drafting")` calls and a `mockResolvedValueOnce`).
  Each is fixed to a valid status that preserves the test's intent. These are
  latent-bug fixes the phase legitimately surfaces, not churn to be avoided.
- **Do not "fix" intentional invalid inputs.** Negative/validation tests
  deliberately feed bad status values to assert rejection
  (`schemas.test.ts` `safeParse({ status: "published" })`,
  `chapters.test.ts` `.send({ status: "invalid_status" })`). These are untyped
  request/parse inputs, do not break typecheck, and must be left intact. Likewise
  server-row literals and unrelated `status` discriminants (snapshot
  `"created"/"duplicate"`, health `"ok"`) are out of scope.
- **`status: string`-typed helpers.** Any test-local helper that explicitly
  declares a `status: string` parameter and feeds a genuinely-`string` value into
  a tightened slot is surfaced by `tsc` and fixed as found.

Net: more than the original "no bulk rewrite" estimate (the revert-ref retyping
in finding [1] and the DashboardView cast in finding [2] are production edits,
not test edits), but still bounded, mechanical, and fully enumerated above. The
authoritative fallout list is whatever `npm run typecheck` reports — the plan
should treat a clean `tsc -b` as the completeness check for the sweep.

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
- `tsc` green (`npm run typecheck` is the authoritative completeness check for
  the sweep); any caller using an off-enum literal fixed.
- `CLAUDE.md` §Key Architecture Decisions carries the closed-status-type note.
- `make all` green.
- No behavior change visible to the user.

## Out of Scope

- DB or API changes — both already enforce the enum at write time.
- Migration of `chapter_statuses` table seed data.
- Renaming `ChapterStatus` (the schema export name).
- Tightening server-internal row types beyond the single `toChapterStatus` cast.

## Dependencies

None. Independently shippable. May land alongside or in parallel with 4b.8.
