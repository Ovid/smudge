# Chapter Status Type Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chapter-status type load-bearing — introduce `ChapterStatusValue` (`z.infer<typeof ChapterStatus>`) and propagate it through the shared types, the entire client status-change chain, and an exhaustive status-color map, with a single server DB-boundary cast.

**Architecture:** A compile-time-only refactor. The Zod enum `ChapterStatus` is the single source of truth; a `z.infer` alias replaces the open `string` on `Chapter.status` and `ChapterStatusRow.status`. Because a status *value* flows freely into a wider `string` parameter, only sites that *assign into* a status field are forced to change; the handler chain, color map, and API payload are tightened deliberately for end-to-end safety. The server keeps `status: string` at its SQLite row boundary, casting only where it crosses into a shared type.

**Tech Stack:** TypeScript, Zod, Vitest (`expectTypeOf` + `@ts-expect-error`), React. The RED gate is the **type-checker** (`npm run typecheck` → `tsc -b`), not `npm test`.

**Design:** `docs/plans/2026-05-31-chapter-status-type-alignment-design.md`

---

## Critical execution notes (read before starting)

1. **RED is observed via `npm run typecheck`, never `npm test`.** Vitest/Vite transpiles tests without running `tsc`, so a broken type contract shows green under `npm test`. Every "verify it fails / passes" step that concerns types runs `npm run typecheck`.
2. **Task 2 is atomic by necessity.** Tightening `Chapter.status` simultaneously breaks every site that assigns a `string` into a status field (the optimistic update in `useChapterMetadata` at lines 192/197/203 assigns the handler's `status` param into a `Chapter`). There is no green intermediate state, so the field tighten, the whole write chain, the confirmed-status ref, the `DashboardView` cast, the server cast, and the test-fixture typo all land in **one commit**. Do not try to split Task 2 into green sub-commits — you can't.
3. **Tasks 3–4 are deliberate enhancements that each stay green** because they tighten *receivers* of an already-tightened value (narrow→wide assignment is always legal; tightening the receiver to the union keeps it legal because the value is already that union).
4. **No runtime behavior changes anywhere.** If a step would change runtime behavior, it is wrong. The existing behavioral suites are the regression net and must stay green.
5. **`make all` must be green at PR close** (lint-check, format-check, typecheck, coverage at 95/85/90/95, e2e), with zero warnings in test output.

---

## File Structure

**Shared (`packages/shared`)**
- `src/schemas.ts` — add `export type ChapterStatusValue`.
- `src/types.ts` — retype `Chapter.status` and `ChapterStatusRow.status`.
- `src/__tests__/types.test.ts` — add type-assertion tests (positive pin + closed-field `@ts-expect-error` + runtime options pin).

**Client (`packages/client`)**
- `src/hooks/useProjectEditor.ts` — `confirmedStatusRef` + `seedConfirmedStatus` retyping.
- `src/hooks/useProjectEditor.types.ts` — two `confirmedStatusRef` prop declarations.
- `src/hooks/useChapterMetadata.ts` — `handleStatusChange` param; revert path becomes type-clean automatically.
- `src/hooks/useTrashManager.ts` — `seedConfirmedStatus` callback prop param (finding [5]).
- `src/components/Sidebar.tsx` — three `onStatusChange` prop signatures + `selectStatus`.
- `src/pages/EditorPage.tsx` — `handleStatusChangeWithError` param.
- `src/components/DashboardView.tsx` — `effectiveStatuses` `Object.entries` cast.
- `src/statusColors.ts` — exhaustive `Record<ChapterStatusValue, string>`.
- `src/api/client.ts` — `chapters.update` payload + `projects.dashboard` inline type + asymmetry comment.
- `src/__tests__/useTrashManager.test.ts` — fix the off-enum `"drafting"` fixture + its assertion (finding [2]).
- `src/__tests__/useProjectEditor.test.ts` — replace off-enum `"drafting"` with `"edited"` throughout (finding [1]).

**Server (`packages/server`)**
- `src/chapter-statuses/chapter-statuses.service.ts` — one `toChapterStatus` cast.

**Docs**
- `CLAUDE.md` — closed-status-type invariant note.

---

## Task 1: Introduce the canonical `ChapterStatusValue` type

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Test: `packages/shared/src/__tests__/types.test.ts`

- [ ] **Step 1: Add the type alias**

In `packages/shared/src/schemas.ts`, immediately after the existing `ChapterStatus` enum declaration (currently the line `export const ChapterStatus = z.enum(["outline", "rough_draft", "revised", "edited", "final"]);`), add:

```ts
export type ChapterStatusValue = z.infer<typeof ChapterStatus>;
```

- [ ] **Step 2: Write the positive type-pin + runtime-options test**

In `packages/shared/src/__tests__/types.test.ts`, add a new `describe` block at the end of the file (keep the existing `ApiError` block untouched). Update the import line at the top from `import { describe, it, expect, expectTypeOf } from "vitest";` — it already imports all four — and add the schema imports:

```ts
import { ChapterStatus } from "../schemas";
import type { ChapterStatusValue } from "../schemas";
```

Then append:

```ts
describe("ChapterStatusValue", () => {
  // ChapterStatusValue is the canonical chapter-status type, inferred from
  // the Zod enum. This pins it to exactly the five known literals so a
  // refactor that widens it (e.g. back to `string`) fails at typecheck time.
  it("resolves to exactly the five status literals (type-level)", () => {
    expectTypeOf<ChapterStatusValue>().toEqualTypeOf<
      "outline" | "rough_draft" | "revised" | "edited" | "final"
    >();
  });

  // Runtime pin so the schema and the inferred type cannot silently drift,
  // and so this file registers a value-level test alongside the type checks.
  it("the schema enumerates exactly those five values (runtime)", () => {
    expect(ChapterStatus.options).toEqual([
      "outline",
      "rough_draft",
      "revised",
      "edited",
      "final",
    ]);
  });
});
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (the alias exists; the positive assertion holds).

- [ ] **Step 4: Verify the test runs green**

Run: `npm test -w packages/shared`
Expected: PASS, including the new `ChapterStatusValue` block, with no console warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/__tests__/types.test.ts
git commit -m "feat(4b.9): add ChapterStatusValue alias + type pin"
```

---

## Task 2: Close the shared status fields + all forced consumers (atomic)

**This is the heart of the phase and is intentionally one commit.** The RED state is observed mid-task; the commit at the end is green.

**Files:**
- Test: `packages/shared/src/__tests__/types.test.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/client/src/hooks/useProjectEditor.ts`
- Modify: `packages/client/src/hooks/useProjectEditor.types.ts`
- Modify: `packages/client/src/hooks/useChapterMetadata.ts`
- Modify: `packages/client/src/hooks/useTrashManager.ts`
- Modify: `packages/client/src/components/Sidebar.tsx`
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/components/DashboardView.tsx`
- Modify: `packages/server/src/chapter-statuses/chapter-statuses.service.ts`
- Modify: `packages/client/src/__tests__/useTrashManager.test.ts`
- Modify: `packages/client/src/__tests__/useProjectEditor.test.ts`

- [ ] **Step 1: Write the failing closed-field assertion (RED)**

In `packages/shared/src/__tests__/types.test.ts`, add `Chapter` to the type import from `../types` (currently `import type { ApiError } from "../types";` → `import type { ApiError, Chapter } from "../types";`). Then add this test inside the `ChapterStatusValue` describe block from Task 1:

```ts
  it("rejects an off-enum literal assigned to Chapter['status'] (type-level)", () => {
    // Before the field is tightened, Chapter["status"] is `string`, so
    // "published" IS assignable and the @ts-expect-error below is unused —
    // tsc reports TS2578. After tightening to ChapterStatusValue the
    // assignment errors, satisfying the directive. This is the RED→GREEN pin.
    // @ts-expect-error — "published" is not a ChapterStatusValue
    const bad: Chapter["status"] = "published";
    void bad;
  });
```

- [ ] **Step 2: Verify it fails (RED)**

Run: `npm run typecheck`
Expected: FAIL with `TS2578: Unused '@ts-expect-error' directive.` in `types.test.ts` (because `Chapter["status"]` is still `string`).

- [ ] **Step 3: Tighten the two shared interface fields**

In `packages/shared/src/types.ts`, add `ChapterStatusValue` to the schema type import. The current import is `import type { CreateProjectSchema, ProjectMode } from "./schemas";` → change to:

```ts
import type { ChapterStatusValue, CreateProjectSchema, ProjectMode } from "./schemas";
```

In the `Chapter` interface, change `status: string;` to:

```ts
  status: ChapterStatusValue;
```

In the `ChapterStatusRow` interface, change `status: string;` to:

```ts
  status: ChapterStatusValue;
```

(Leave `status_label?: string;` and `ChapterStatusRow.label: string;` unchanged.)

- [ ] **Step 4: Retype the confirmed-status ref + seeder (finding [1])**

In `packages/client/src/hooks/useProjectEditor.ts`:

- Ensure `ChapterStatusValue` is imported from `@smudge/shared` (add to the existing `import type { … } from "@smudge/shared";` block).
- Change the ref declaration (currently `const confirmedStatusRef = useRef<Record<string, string | undefined>>({});`) to:

```ts
  const confirmedStatusRef = useRef<Record<string, ChapterStatusValue | undefined>>({});
```

- Change `seedConfirmedStatus`'s signature (currently `const seedConfirmedStatus = useCallback((id: string, status: string) => {`) to:

```ts
  const seedConfirmedStatus = useCallback((id: string, status: ChapterStatusValue) => {
```

In `packages/client/src/hooks/useProjectEditor.types.ts`:

- Add `ChapterStatusValue` to the `@smudge/shared` type import.
- Change **both** `confirmedStatusRef` prop declarations (one in each of the two interfaces, currently `confirmedStatusRef: MutableRefObject<Record<string, string | undefined>>;`) to:

```ts
  confirmedStatusRef: MutableRefObject<Record<string, ChapterStatusValue | undefined>>;
```

(After this, `previousStatus` in `useChapterMetadata.ts` — `const previousStatus = confirmedStatusRef.current[chapterId];` — is inferred as `ChapterStatusValue | undefined`, so the revert spread `{ ...c, status: previousStatus }` becomes type-clean with no edit. `replaceConfirmedStatusesFromProject`'s `[c.id, c.status]` also stays clean: `c.status` is now `ChapterStatusValue`.)

- [ ] **Step 5: Tighten the status-change write chain**

In `packages/client/src/hooks/useChapterMetadata.ts`:

- Add an import: `import type { ChapterStatusValue } from "@smudge/shared";` (alongside the existing `import type { ChapterMetadataDeps } from "./useProjectEditor.types";`).
- Change `handleStatusChange`'s signature (currently `async (chapterId: string, status: string, onError?: (message: string) => void) => {`) to:

```ts
    async (chapterId: string, status: ChapterStatusValue, onError?: (message: string) => void) => {
```

(The optimistic assignments at `{ ...c, status }`, `{ ...prev, status }`, and `confirmedStatusRef.current[chapterId] = status;` now assign a `ChapterStatusValue` — type-clean.)

In `packages/client/src/components/Sidebar.tsx`:

- `ChapterStatusValue` must be importable; add it to the existing `import type { ProjectWithChapters, Chapter, ChapterStatusRow } from "@smudge/shared";` → `import type { ProjectWithChapters, Chapter, ChapterStatusRow, ChapterStatusValue } from "@smudge/shared";`.
- Change **all three** `onStatusChange: (chapterId: string, status: string) => void;` prop declarations (in `StatusBadgeProps`, the sidebar props interface, and `SortableChapterItemProps`) to:

```ts
  onStatusChange: (chapterId: string, status: ChapterStatusValue) => void;
```

- Change `selectStatus`'s signature (currently `function selectStatus(status: string) {`) to:

```ts
  function selectStatus(status: ChapterStatusValue) {
```

(`selectStatus(s.status)` passes a `ChapterStatusRow.status` — now `ChapterStatusValue` — so it matches.)

In `packages/client/src/pages/EditorPage.tsx`:

- Add `ChapterStatusValue` to the existing `import type { Chapter, ChapterStatusRow } from "@smudge/shared";` → `import type { Chapter, ChapterStatusRow, ChapterStatusValue } from "@smudge/shared";`.
- Change `handleStatusChangeWithError`'s signature (currently `(chapterId: string, status: string) => {`) to:

```ts
    (chapterId: string, status: ChapterStatusValue) => {
```

In `packages/client/src/hooks/useTrashManager.ts` (alignment finding [5]):

- Add `import type { ChapterStatusValue } from "@smudge/shared";` (if not already importing from shared, add the import).
- Change the optional seeder callback prop (currently `seedConfirmedStatus?: (id: string, status: string) => void;`) to:

```ts
  seedConfirmedStatus?: (id: string, status: ChapterStatusValue) => void;
```

This is needed for more than hygiene: the prop is a *property* arrow type, so under `strictFunctionTypes` its `status` param is contravariant. Wiring `useProjectEditor`'s now-`ChapterStatusValue` `seedConfirmedStatus` into a `(status: string) => void` slot is a TS2322 at the wiring site. The internal call `seedConfirmedStatusRef.current?.(restored.id, restored.status)` stays clean (`restored.status` is `ChapterStatusValue`). It also satisfies the CLAUDE.md invariant added in Task 4.

- [ ] **Step 6: Cast the DashboardView fallback (finding [2])**

In `packages/client/src/components/DashboardView.tsx`:

- Add `ChapterStatusValue` to the existing `import type { ChapterStatusRow, VelocityResponse } from "@smudge/shared";` → `import type { ChapterStatusRow, ChapterStatusValue, VelocityResponse } from "@smudge/shared";`.
- In the `effectiveStatuses` fallback, change the mapped object so the `Object.entries` key (always typed `string`) is cast at this derive-from-keys boundary. The current code:

```ts
      : Object.entries(status_summary).map(([status], i) => ({
          status,
          sort_order: i,
          label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        }));
```

becomes:

```ts
      : Object.entries(status_summary).map(([status], i) => ({
          // Object.entries keys are typed `string`; this summary came from a
          // server-validated status set, so cast at the derive-from-keys edge.
          status: status as ChapterStatusValue,
          sort_order: i,
          label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        }));
```

(Leave the file's `statusSortOrder[a.status] ?? null` and `STATUS_COLORS[s.status] ?? "#999"` defensive branches untouched — they become statically dead but are harmless, same rationale as the Sidebar `|| "outline"` note.)

- [ ] **Step 7: Cast the server DB→shared boundary**

In `packages/server/src/chapter-statuses/chapter-statuses.service.ts`:

- Add `ChapterStatusValue` to the existing import: `import type { ChapterStatusRow as SharedChapterStatusRow } from "@smudge/shared";` → `import type { ChapterStatusRow as SharedChapterStatusRow, ChapterStatusValue } from "@smudge/shared";`.
- In `toChapterStatus`, change `status: row.status,` to:

```ts
    // DB→type boundary: the chapter_statuses rows are seed-controlled and the
    // status column is enum-constrained at every write, so the raw string is a
    // trusted ChapterStatusValue here.
    status: row.status as ChapterStatusValue,
```

(The server's internal `ChapterStatusRow` and `ChapterRow` family stay `status: string` — they are the persistence boundary and out of scope.)

- [ ] **Step 8: Fix the off-enum literals in `useTrashManager.test.ts` (BOTH sites)**

`"drafting"` is not a valid status (the loose `string` type has hidden it). Change **both** occurrences to a valid status so the fixture and its assertion stay consistent (alignment finding [2]).

Line ~313 (the fixture):

```ts
    const restored = makeChapter({ id: "ch-restored", status: "rough_draft" });
```

Line ~340 (the assertion that the seeder was called with that chapter's status):

```ts
    expect(seedConfirmedStatus).toHaveBeenCalledWith("ch-restored", "rough_draft");
```

- [ ] **Step 8b: Fix the off-enum `"drafting"` literals in `useProjectEditor.test.ts` (alignment finding [1])**

This file uses `"drafting"` — not a valid status — as a stand-in non-default status in the I21 revert regression tests, in **typechecked** positions that will become TS2322: `handleStatusChange("ch1"/"ch3", "drafting")` (lines ~1492, ~3665, ~3764, ~3838) and `.mockResolvedValueOnce({ ...mockChapter1, status: "drafting" })` (line ~1479). Replace **every** occurrence of `"drafting"` in this file with `"edited"` — a valid status distinct from the `"outline"` baseline and the `"revised"` second status these tests use, so the test semantics (an arbitrary confirmed non-default status) are preserved. This includes the call-site arguments, the mock resolves, the `.toBe("drafting")` assertions (lines ~1494, ~1505), and the explanatory comments mentioning `"drafting"`.

Run to confirm none remain:

```bash
grep -n "drafting" packages/client/src/__tests__/useProjectEditor.test.ts
```

Expected: no output.

- [ ] **Step 9: Sweep hint (NOT the completeness gate)**

`npm run typecheck` (Step 10) is the **sole authoritative completeness check** for the sweep — it is the only thing that finds every broken site, including positional call arguments. The grep below is just a *hint* to eyeball before running typecheck; it cannot see literals passed as call arguments (e.g. `handleStatusChange(id, "drafting")`), which is why the design says to trust `tsc -b`.

```bash
grep -rEn 'status: *"[a-z_]+"' packages --include='*.ts' --include='*.tsx' \
  | grep -v node_modules \
  | grep -Ev '"(outline|rough_draft|revised|edited|final)"'
```

**Most hits are NOT chapter-status typos — DO NOT change these:**

- **Intentional invalid inputs in negative/validation tests** — `packages/shared/src/__tests__/schemas.test.ts:97` (`UpdateChapterSchema.safeParse({ status: "published" })`) and `packages/server/src/__tests__/chapters.test.ts:173` (`.send({ status: "invalid_status" })`). These deliberately feed a bad value to assert the server/schema **rejects** it. They are untyped request/parse inputs (no typecheck break) and are load-bearing — changing them would delete the negative test. Leave them.
- **Different `status` fields** — snapshot result discriminants (`status: "created" | "duplicate"`), the health endpoint (`status: "ok"`). Unrelated to chapter status. Leave them.
- **Server-row literals** — `packages/server/src/__tests__/snapshots.repository.test.ts:33` (`status: "draft"`) targets a server DB-row type that intentionally stays `status: string` (out of scope). Leave it.
- **Cast-shielded client fixture** — `packages/client/src/__tests__/useChapterTitleEditing.test.ts:14` (`status: "draft"` inside an `as Chapter` cast) does not break typecheck. Optional hygiene: change `"draft"` → `"outline"` to honor the new closed-status-type invariant; not required for the build.

The only literals this phase *must* change are the ones that break `npm run typecheck` (Steps 8 and 8b cover the known ones). Treat any additional typecheck error as the real list.

- [ ] **Step 10: Verify typecheck passes (GREEN) and behavior is unchanged**

Run: `npm run typecheck`
Expected: PASS — the `@ts-expect-error` is now satisfied and no consumer errors remain. **A clean `tsc -b` is the completeness check for the sweep.**

Run: `npm test -w packages/shared && npm test -w packages/client && npm test -w packages/server`
Expected: PASS, no console warnings. The behavioral suites (chapters, Sidebar, DashboardView, useProjectEditor, useTrashManager) prove zero runtime change.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/__tests__/types.test.ts \
  packages/client/src/hooks/useProjectEditor.ts \
  packages/client/src/hooks/useProjectEditor.types.ts \
  packages/client/src/hooks/useChapterMetadata.ts \
  packages/client/src/hooks/useTrashManager.ts \
  packages/client/src/components/Sidebar.tsx \
  packages/client/src/pages/EditorPage.tsx \
  packages/client/src/components/DashboardView.tsx \
  packages/server/src/chapter-statuses/chapter-statuses.service.ts \
  packages/client/src/__tests__/useTrashManager.test.ts \
  packages/client/src/__tests__/useProjectEditor.test.ts
git commit -m "feat(4b.9): close Chapter/ChapterStatusRow.status to ChapterStatusValue"
```

---

## Task 3: Tighten the optional receivers (color map + API types)

These are not forced by the field tighten; each keeps typecheck green because it tightens a receiver of an already-`ChapterStatusValue` value.

**Files:**
- Modify: `packages/client/src/statusColors.ts`
- Modify: `packages/client/src/api/client.ts`

- [ ] **Step 1: Make the status-color map exhaustive**

In `packages/client/src/statusColors.ts`, add an import and tighten the record type. The current file:

```ts
export const STATUS_COLORS: Record<string, string> = {
  outline: "#8B9E7C",
  rough_draft: "#C07850",
  revised: "#B8973E",
  edited: "#6B7F94",
  final: "#6B4E3D",
};
```

becomes:

```ts
import type { ChapterStatusValue } from "@smudge/shared";

// Exhaustive: every ChapterStatusValue must have a color, or this fails to
// compile. A future status added to the enum forces a color here.
export const STATUS_COLORS: Record<ChapterStatusValue, string> = {
  outline: "#8B9E7C",
  rough_draft: "#C07850",
  revised: "#B8973E",
  edited: "#6B7F94",
  final: "#6B4E3D",
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS. (`STATUS_COLORS[s.status]` / `STATUS_COLORS[chapter.status]` index with a `ChapterStatusValue` key, which is valid against the exhaustive record and returns `string`; `STATUS_COLORS.outline` remains valid.)

- [ ] **Step 3: Tighten the API write payload + dashboard read type (findings [3]/[6])**

In `packages/client/src/api/client.ts`:

- Add `ChapterStatusValue` to the `@smudge/shared` import block (which already imports `Chapter`, `ChapterStatusRow`, etc.).
- In `chapters.update`, change the payload field `status?: string;` to:

```ts
        status?: ChapterStatusValue;
```

- In `projects.dashboard`'s inline response type, change the chapter `status: string;` to `status: ChapterStatusValue;`, and change `status_summary: Record<string, number>;` to a sparse, enum-keyed record with a comment recording the intentional client/server asymmetry:

```ts
        chapters: Array<{
          id: string;
          title: string;
          status: ChapterStatusValue;
          status_label: string;
          word_count: number;
          updated_at: string;
          sort_order: number;
        }>;
        // The server declares status_summary as Record<string, number>; the
        // client narrows it to the enum here. The asymmetry is deliberate
        // (JSON boundary) — the shared ChapterStatus enum is the contract both
        // sides track. Partial because a status with zero chapters is absent.
        status_summary: Partial<Record<ChapterStatusValue, number>>;
```

- [ ] **Step 4: Verify typecheck + tests pass**

Run: `npm run typecheck`
Expected: PASS. (`status_summary[s.status] ?? 0` yields `number | undefined` → `?? 0` keeps it `number`; `Object.values(status_summary).reduce(...)` is `number[]`; `Object.entries(status_summary)` keys remain `string`, handled by the Task 2 cast.)

Run: `npm test -w packages/client`
Expected: PASS, no console warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/statusColors.ts packages/client/src/api/client.ts
git commit -m "feat(4b.9): tighten STATUS_COLORS + status API types to ChapterStatusValue"
```

---

## Task 4: Document the invariant in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the closed-status-type note**

In `CLAUDE.md`, under **## Key Architecture Decisions**, add a new bolded entry (place it after the **Chapter titles are DB metadata** entry, keeping the section's one-paragraph-per-decision style):

```markdown
**Chapter status is a closed type.** `ChapterStatusValue`
(`z.infer<typeof ChapterStatus>`, `packages/shared/src/schemas.ts`) is the
canonical type for a chapter's status across shared and client code — derive
from it; never re-declare status as `string`. The server's internal DB-row
types (`ChapterRow` et al.) intentionally keep `status: string` at the SQLite
persistence boundary, casting to `ChapterStatusValue` only where they cross into
a shared type (e.g. `toChapterStatus`).
```

- [ ] **Step 2: Verify nothing broke**

Run: `npm run typecheck`
Expected: PASS (docs-only change; sanity check that the working tree is clean of accidental edits).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(4b.9): record closed-status-type invariant in CLAUDE.md"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full CI pass**

Run: `make all`
Expected: PASS — lint-check, format-check, typecheck, coverage (≥95% statements, ≥85% branches, ≥90% functions, ≥95% lines), and e2e all green, with zero warnings in test output.

- [ ] **Step 2: Confirm no runtime/behavior drift**

Confirm the diff contains only type annotations, two casts (`DashboardView` `Object.entries` boundary, server `toChapterStatus`), one corrected test fixture literal, the new type-assertion tests, and the CLAUDE.md note — no logic changes. Run:

```bash
git diff main --stat
```

Expected: only the files listed in this plan, no `.js`/migration/SQL changes.

- [ ] **Step 3 (if coverage dipped): add a meaningful test, never lower the floor**

If `make cover` reports a drop (unlikely — this phase adds no executable branches), identify the uncovered line and add a meaningful test for it. Do **not** adjust thresholds in `vitest.config.ts`.

---

## Self-Review (completed during authoring)

- **Spec coverage:** schemas alias (T1), both shared fields (T2/3), write chain (T2/5), ref+seeder pushback finding [1] (T2/4), DashboardView pushback finding [2] (T2/6), exhaustive colors (T3/1), API payload+dashboard pushback finding [3] + asymmetry finding [6] (T3/3), dead-branch note (T2/6), RED-gate command (execution notes + every typecheck step), fixture-typo handling (T2/8, T2/8b), `tsc` as sole completeness gate (T2/9–10), server cast (T2/7), CLAUDE.md deliverable (T4), `make all` (T5). All design sections map to a task.
- **Alignment findings folded in:** off-enum `"drafting"` in `useProjectEditor.test.ts` (T2/8b, finding [1]); `useTrashManager.test.ts` assertion at line 340 (T2/8, finding [2]); grep demoted to a hint with a DO-NOT-TOUCH list incl. negative-test invalid inputs (T2/9, findings [3]/[4]); `useTrashManager.ts` seeder prop tightened (T2/5, finding [5]).
- **Placeholder scan:** none — every code step shows the exact before/after.
- **Type consistency:** `ChapterStatusValue` spelled identically everywhere; ref type `Record<string, ChapterStatusValue | undefined>` consistent across `useProjectEditor.ts` and both `.types.ts` declarations; `seedConfirmedStatus` param typed `ChapterStatusValue` in both `useProjectEditor.ts` and the `useTrashManager.ts` callback prop; `status_summary` typed `Partial<Record<ChapterStatusValue, number>>` consistently.
