import { describe, it, expectTypeOf } from "vitest";
import type { Chapter, Project, ChapterStatusValue, ProjectModeType } from "@smudge/shared";
import type { ChapterRow, ChapterWithLabel, DeletedChapterRow } from "../chapters/chapters.types";
import type { ProjectRow } from "../projects/projects.types";

// S11 (dedup review 2026-07-26): the server re-declares the shape of every
// shared wire type it serves. That is the ACCEPTED pattern — the *Row types are
// the SQLite persistence boundary and deliberately keep enum-valued columns as
// `string` (CLAUDE.md §Chapter status is a closed type) — but chapters and
// projects executed it WITHOUT the narrowing cast the pattern calls for.
// chapter-statuses does it properly, via the documented `toChapterStatus`
// (chapter-statuses.service.ts), which is the one place the widened string is
// asserted back to ChapterStatusValue.
//
// The residual is that shared `Chapter` was an informal supertype of three
// server shapes and shared `Project` of one, with nothing enforcing it: adding
// a field to the shared type, or drifting a field's type on either side, would
// compile cleanly on both and only surface as a wrong response body at
// runtime. These are compile-time assertions — they carry no runtime behavior,
// and `tsc` is what actually runs them.
//
// ┌─ NEW SERVER ROW TYPE SERVED ON THE WIRE? ──────────────────────────────┐
// │ Add it here. If it cannot satisfy the shared type even after the       │
// │ documented status/mode narrowing, that is a real divergence to resolve │
// │ deliberately, not to work around with a cast at the call site.         │
// └────────────────────────────────────────────────────────────────────────┘

/**
 * A server row with its persistence-boundary `string` columns narrowed back to
 * the closed unions the shared type declares. This models exactly what the
 * documented cast does, so the assertions below check every OTHER field
 * without re-litigating the intentional widening.
 */
type NarrowStatus<T extends { status: string }> = Omit<T, "status"> & {
  status: ChapterStatusValue;
};
type NarrowMode<T extends { mode: string }> = Omit<T, "mode"> & { mode: ProjectModeType };

describe("server row types still satisfy the shared wire types (S11)", () => {
  it("ChapterWithLabel — the shape served by GET/PATCH /api/chapters/:id", () => {
    expectTypeOf<NarrowStatus<ChapterWithLabel>>().toExtend<Chapter>();
  });

  it("ChapterRow — the shape carried inside the project payload", () => {
    expectTypeOf<NarrowStatus<Omit<ChapterRow, "content_corrupt">>>().toExtend<Chapter>();
  });

  it("DeletedChapterRow — the shape served by the trash list", () => {
    expectTypeOf<NarrowStatus<DeletedChapterRow>>().toExtend<Omit<Chapter, "deleted_at">>();
  });

  it("ProjectRow — the shape served by GET /api/projects/:slug", () => {
    expectTypeOf<NarrowMode<ProjectRow>>().toExtend<Project>();
  });

  it("the narrowing is the ONLY divergence — the raw rows do not satisfy the wire types", () => {
    // If these ever start extending, the persistence boundary has stopped
    // widening enum columns to `string` and the casts documented at
    // toChapterStatus are dead. That is a decision, not a drive-by.
    expectTypeOf<ChapterWithLabel>().not.toExtend<Chapter>();
    expectTypeOf<ProjectRow>().not.toExtend<Project>();
  });
});
