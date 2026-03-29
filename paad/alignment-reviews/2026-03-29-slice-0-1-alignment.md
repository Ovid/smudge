# Alignment Review: Slices 0–1

**Date:** 2026-03-29
**Commit:** e4d5912

## Documents Reviewed

- **Intent:** `docs/plans/mvp.md` (PRD)
- **Design:** `docs/plans/2026-03-29-mvp-implementation-design.md` (implementation design, 10 slices)
- **Action:** `docs/plans/2026-03-29-slice-0-1-plan.md` (detailed plan for slices 0 and 1)

## Source Control Conflicts

None — greenfield project, only planning docs committed.

## Issues Reviewed

### [1] EditorPage saved on every keystroke instead of save-on-blur
- **Category:** design gap
- **Severity:** Important
- **Documents:** Implementation design (slice 1: "No auto-save yet. Temporary save-on-blur") vs. Plan (Task 18)
- **Issue:** TipTap `onUpdate` fired API save on every keystroke. Design specifies save-on-blur for slice 1.
- **Resolution:** Changed to `onBlur` handler. Renamed prop from `onUpdate` to `onSave` for clarity.

### [2] NewProjectDialog ref timing bug
- **Category:** design gap (code correctness)
- **Severity:** Important
- **Documents:** Plan Task 17
- **Issue:** `showModal()`/`close()` called in render body where `dialogRef.current` may be null on first render.
- **Resolution:** Moved to `useEffect` synced on `open` prop.

### [3] Plan header said "React 18" but deps specified React 19
- **Category:** internal inconsistency
- **Severity:** Minor
- **Documents:** Plan header vs. Task 4 package.json
- **Issue:** Version mismatch. MVP spec says "React 18+" so React 19 is acceptable.
- **Resolution:** Updated plan header to say "React 19".

### [4] No global error handler on Express app
- **Category:** missing coverage
- **Severity:** Minor
- **Documents:** MVP spec §6.1 (consistent JSON error envelope) vs. Plan Task 11
- **Issue:** Unhandled route exceptions would produce Express default HTML, not JSON envelope.
- **Resolution:** Added global error-handling middleware returning `{ error: { code, message } }` with 500 status.

### [5] Test setup boilerplate duplicated across test files
- **Category:** scope compliance (DRY violation)
- **Severity:** Minor
- **Documents:** Plan Tasks 11, 12, 14
- **Issue:** 15+ lines of identical `beforeAll`/`afterAll`/`beforeEach` DB setup repeated 3 times.
- **Resolution:** Extracted `test-helpers.ts` with `setupTestDb()` returning `{ db, app }`. All test files use it.

### [6] POST /api/projects return type didn't match client expectation
- **Category:** design gap
- **Severity:** Important
- **Documents:** Plan Task 12 (server) vs. Task 16 (client API types)
- **Issue:** Server returned `Project`, client typed response as `ProjectWithChapters`.
- **Resolution:** Fixed client API type to expect `Project` from create (EditorPage does a fresh GET anyway).

### [7] Missing @tailwindcss/typography for prose classes + token overrides
- **Category:** missing coverage
- **Severity:** Minor
- **Documents:** Cross-slice constraint (CSS custom properties) vs. Plan Task 18
- **Issue:** `prose` class used without typography plugin dependency; default typography colors bypass custom tokens.
- **Resolution:** Added `@tailwindcss/typography` dep, `@plugin` import in CSS, and prose override classes (`prose-headings:text-text-primary`, `prose-a:text-accent`).

## Unresolved Issues

None — all issues addressed.

## Alignment Summary

- **Requirements (slice 1 scope):** 8 items checked, 8 covered, 0 gaps
- **Tasks:** 20 total, 20 in scope, 0 orphaned
- **Design items:** All slice 0–1 design items addressed
- **Status:** Aligned (after fixes applied)
