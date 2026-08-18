import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { UNTITLED_CHAPTER } from "@smudge/shared";
import { setupTestDb } from "./test-helpers";
import { logger } from "../logger";
import * as ChapterService from "../chapters/chapters.service";

// A well-formed UUID that is not in the DB. Distinct from a MALFORMED id,
// which is a 400 (OOSS1) — these routes must still 404 for "valid shape,
// no such row".
const UNKNOWN_UUID = "11111111-1111-4111-8111-111111111111";

const t = setupTestDb();

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

describe("POST /api/projects/:id/chapters", () => {
  it("creates a new chapter appended to end", async () => {
    const { projectId, projectSlug } = await createProjectWithChapter(t.app);

    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();

    expect(res.status).toBe(201);
    expect(res.body.title).toBe(UNTITLED_CHAPTER);
    expect(res.body.project_id).toBe(projectId);
    expect(res.body.sort_order).toBe(1); // after the auto-created chapter at 0
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).post("/api/projects/nonexistent-id/chapters").send();

    expect(res.status).toBe(404);
  });

  it("returns 404 for deleted project", async () => {
    const { projectSlug } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/projects/${projectSlug}`);

    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();

    expect(res.status).toBe(404);
  });

  it("increments sort_order for each new chapter", async () => {
    const { projectSlug } = await createProjectWithChapter(t.app);

    await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();
    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();

    expect(res.body.sort_order).toBe(2);
  });

  // --- F-28 safety net (architecture report 2026-08-11) ---------------------
  // createChapter's transaction does two things and then re-reads OUTSIDE the
  // transaction; the F-28 fix moves that read inside. These two pin the parts
  // of the observable result that the restructure could silently drop: the
  // timestamp bump that happens beside the insert, and the status-label
  // enrichment that happens after it. Neither was asserted anywhere.

  it("bumps the parent project's updated_at", async () => {
    const { projectSlug } = await createProjectWithChapter(t.app);

    // Backdate directly so the comparison cannot turn on same-millisecond
    // ISO timestamps — the API writes new Date().toISOString().
    const stale = "2020-01-01T00:00:00.000Z";
    await t.db("projects").where({ slug: projectSlug }).update({ updated_at: stale });

    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();
    expect(res.status).toBe(201);

    const projectRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    expect(projectRes.body.updated_at).not.toBe(stale);
    expect(new Date(projectRes.body.updated_at).getTime()).toBeGreaterThan(
      new Date(stale).getTime(),
    );
  });

  it("returns the new chapter enriched with its status_label", async () => {
    const { projectSlug } = await createProjectWithChapter(t.app);

    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();

    expect(res.status).toBe(201);
    // Default status is "outline" (migration 003); the label is looked up from
    // chapter_statuses, so this fails if enrichment is dropped or fed the raw
    // status as a fallback.
    expect(res.body.status).toBe("outline");
    expect(res.body.status_label).toBe("Outline");
  });
});

describe("GET /api/chapters/:id", () => {
  it("returns chapter by id", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).get(`/api/chapters/${chapterId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(chapterId);
    expect(res.body.title).toBe(UNTITLED_CHAPTER);
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).get(`/api/chapters/${UNKNOWN_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 500 CORRUPT_CONTENT when chapter has corrupt JSON in DB", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { chapterId } = await createProjectWithChapter(t.app);

    // Directly corrupt the content in the DB (bypassing the API validation)
    await t.db("chapters").where({ id: chapterId }).update({ content: "{invalid json!!!" });

    const res = await request(t.app).get(`/api/chapters/${chapterId}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("CORRUPT_CONTENT");
    expect(res.body.error.message).toContain("corrupted");
    errorSpy.mockRestore();
  });
});

describe("PATCH /api/chapters/:id", () => {
  it("updates chapter content", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };

    const res = await request(t.app).patch(`/api/chapters/${chapterId}`).send({ content });

    expect(res.status).toBe(200);
    expect(res.body.content).toEqual(content);
  });

  it("updates chapter title", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ title: "Chapter One" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Chapter One");
  });

  it("returns 400 when content has wrong root type", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "paragraph" } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is empty", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).patch(`/api/chapters/${chapterId}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).patch(`/api/chapters/${UNKNOWN_UUID}`).send({ title: "Nope" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for soft-deleted chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    await t
      .db("chapters")
      .where({ id: chapterId })
      .update({ deleted_at: new Date().toISOString() });

    const res = await request(t.app).patch(`/api/chapters/${chapterId}`).send({ title: "Nope" });

    expect(res.status).toBe(404);
  });

  it("updates chapter status", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ status: "rough_draft" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rough_draft");
  });

  it("returns 400 for invalid status", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ status: "invalid_status" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns chapter with status in response", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).get(`/api/chapters/${chapterId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("outline");
  });

  it("GET /api/projects/:slug includes chapter status and status_label", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);

    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ status: "edited" });

    const res = await request(t.app).get(`/api/projects/${projectSlug}`);

    expect(res.status).toBe(200);
    expect(res.body.chapters[0].status).toBe("edited");
    expect(res.body.chapters[0].status_label).toBe("Edited");
  });

  it("returns 400 when status is valid in schema but missing from DB", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    // Remove a status from the DB table to simulate drift between Zod enum and DB
    await t.db("chapter_statuses").where({ status: "final" }).del();

    try {
      const res = await request(t.app)
        .patch(`/api/chapters/${chapterId}`)
        .send({ status: "final" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toContain("Invalid status");
    } finally {
      // Restore the deleted row so subsequent tests see all statuses
      await t.db("chapter_statuses").insert({ status: "final", sort_order: 5, label: "Final" });
    }
  });

  it("preserves content on invalid update", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const validContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }],
    };

    // Save valid content first
    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ content: validContent });

    // Attempt invalid update
    const badRes = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "paragraph" } });
    expect(badRes.status).toBe(400);

    // Verify original content preserved
    const getRes = await request(t.app).get(`/api/chapters/${chapterId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.content).toEqual(validContent);
  });

  it("succeeds for title-only update even when chapter has corrupt content", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { chapterId } = await createProjectWithChapter(t.app);

    // Directly corrupt the content in the DB
    await t.db("chapters").where({ id: chapterId }).update({ content: "{invalid json!!!" });

    // PATCH only the title — should succeed despite corrupt content
    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ title: "New Title" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Title");
    errorSpy.mockRestore();
  });
});

describe("DELETE /api/chapters/:id", () => {
  it("soft-deletes a chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).delete(`/api/chapters/${chapterId}`);

    // F-16: all DELETE endpoints return 204 No Content (uniform success contract).
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).delete(`/api/chapters/${UNKNOWN_UUID}`);

    expect(res.status).toBe(404);
  });

  it("returns 404 for already-deleted chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).delete(`/api/chapters/${chapterId}`);

    expect(res.status).toBe(404);
  });

  it("chapter no longer appears in project chapters after delete", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const projectRes = await request(t.app).get(`/api/projects/${projectSlug}`);

    expect(projectRes.body.chapters).toHaveLength(0);
  });
});

describe("POST /api/chapters/:id/restore", () => {
  it("restores a soft-deleted chapter", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.deleted_at).toBeNull();

    // Chapter should appear in project again
    const projectRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    expect(projectRes.body.chapters).toHaveLength(1);
  });

  it("also restores parent project if it was deleted", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);
    await request(t.app).delete(`/api/projects/${projectSlug}`);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(200);

    // Project should be accessible again
    const projectRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    expect(projectRes.status).toBe(200);
  });

  it("re-slugs restored project when slug is now taken", async () => {
    // Create project A, delete it
    const projectA = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    const chapterA = (await request(t.app).get(`/api/projects/${projectA.body.slug}`)).body
      .chapters[0];
    await request(t.app).delete(`/api/chapters/${chapterA.id}`);
    await request(t.app).delete(`/api/projects/${projectA.body.slug}`);

    // Create project B with the same title — slug reuse is allowed after soft-delete
    const projectB = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    expect(projectB.body.slug).toBe("my-novel");

    // Restore chapter from A — this also restores project A
    const res = await request(t.app).post(`/api/chapters/${chapterA.id}/restore`);
    expect(res.status).toBe(200);

    // Project A should be accessible with a new slug (not "my-novel", that's taken by B)
    const restoredProject = await t.db("projects").where({ id: projectA.body.id }).first();
    expect(restoredProject.deleted_at).toBeNull();
    expect(restoredProject.slug).toBe("my-novel-2");

    // Project B should be unaffected
    const projectBRes = await request(t.app).get("/api/projects/my-novel");
    expect(projectBRes.status).toBe(200);
    expect(projectBRes.body.id).toBe(projectB.body.id);
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).post(`/api/chapters/${UNKNOWN_UUID}/restore`);

    expect(res.status).toBe(404);
  });

  it("returns 404 for a chapter that is not deleted", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(404);
  });

  it("returns PROJECT_PURGED when parent project has been hard-deleted", async () => {
    const { projectId, chapterId } = await createProjectWithChapter(t.app);

    // Soft-delete the chapter
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    // Temporarily disable FK constraints so we can hard-delete the project
    // while leaving the orphaned chapter behind
    await t.db.raw("PRAGMA foreign_keys = OFF");

    await t.db("chapters").where({ project_id: projectId }).del();
    await t.db("projects").where({ id: projectId }).del();

    // Re-insert just the soft-deleted chapter (no parent project)
    const now = new Date().toISOString();
    await t.db("chapters").insert({
      id: chapterId,
      project_id: projectId,
      title: "Orphaned Chapter",
      sort_order: 0,
      word_count: 0,
      created_at: now,
      updated_at: now,
      deleted_at: now,
    });

    // Re-enable FK constraints
    await t.db.raw("PRAGMA foreign_keys = ON");

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROJECT_PURGED");
    expect(res.body.error.message).toBe("The parent project has been permanently deleted.");
  });

  it("succeeds when restoring a chapter with corrupt JSON content", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    // applyImageRefDiff logs a warn when it can't parse corrupt content
    // before aborting the diff. The warn is expected here; suppress and
    // assert rather than letting it pollute test stderr.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { chapterId } = await createProjectWithChapter(t.app);

    // Soft-delete the chapter
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    // Directly corrupt the content in the DB
    await t.db("chapters").where({ id: chapterId }).update({ content: "{invalid json!!!" });

    // Restore should succeed — corruption is surfaced when the user opens the chapter
    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(chapterId);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: expect.any(String) }),
      "applyImageRefDiff: newContent is not a TipTap object; aborting diff to avoid mass decrement",
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// The route maps each service outcome onto a specific HTTP status + machine
// `error.code`. Those codes are load-bearing — the client error scopes map
// them by name. A few outcomes are defensive race conditions that can't be
// provoked through the real DB path, so we drive them by stubbing the service
// and assert the wiring directly.
describe("chapter route error-code mappings (service-outcome wiring)", () => {
  const VALID_ID = "00000000-0000-0000-0000-000000000000";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PATCH maps read_after_update_failure → 500 UPDATE_READ_FAILURE", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(ChapterService, "updateChapter").mockResolvedValue("read_after_update_failure");
    const res = await request(t.app).patch(`/api/chapters/${VALID_ID}`).send({ title: "x" });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("UPDATE_READ_FAILURE");
    errorSpy.mockRestore();
  });

  it("PATCH maps a corrupt post-update read → 500 CORRUPT_CONTENT", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(ChapterService, "updateChapter").mockResolvedValue({ corrupt: true });
    const res = await request(t.app).patch(`/api/chapters/${VALID_ID}`).send({ title: "x" });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("CORRUPT_CONTENT");
    errorSpy.mockRestore();
  });

  it("restore maps chapter_purged → 404 CHAPTER_PURGED", async () => {
    vi.spyOn(ChapterService, "restoreChapter").mockResolvedValue("chapter_purged");
    const res = await request(t.app).post(`/api/chapters/${VALID_ID}/restore`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CHAPTER_PURGED");
  });

  it("restore maps conflict → 409 RESTORE_CONFLICT", async () => {
    vi.spyOn(ChapterService, "restoreChapter").mockResolvedValue("conflict");
    const res = await request(t.app).post(`/api/chapters/${VALID_ID}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESTORE_CONFLICT");
  });

  it("restore maps read_failure → 500 RESTORE_READ_FAILURE", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(ChapterService, "restoreChapter").mockResolvedValue("read_failure");
    const res = await request(t.app).post(`/api/chapters/${VALID_ID}/restore`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("RESTORE_READ_FAILURE");
    errorSpy.mockRestore();
  });
});

// `UpdateChapterSchema` is `.partial()` without `.strict()`, so Zod STRIPS
// unknown keys rather than rejecting them. That is a real contract on the
// autosave endpoint and it was untested: the previous test here claimed to
// check that `target_word_count` (dropped by migration 010) is ignored, but it
// never sent the field — it PATCHed `{ title }` and asserted the response
// lacked a column that no longer exists, so it could only fail if someone
// re-added the column. `target_word_count` is kept as the concrete case because
// it is the removed field a stale client is most likely to still send.
//
// The two cases pin the strip from both sides, and each was verified to fail
// under the change it guards: `.passthrough()` breaks the first (an
// unknown-only body would 200 for a write that changed nothing), `.strict()`
// breaks the second (a mixed body would 400 and lose the edit). Neither can
// pass vacuously — which is exactly what the test they replaced could not say.
describe("PATCH /api/chapters/:id — unknown fields are stripped, not honoured", () => {
  it("400s a body of only unknown fields rather than reporting a no-op success", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ target_word_count: 500 });

    // Stripping leaves {}, which trips the "at least one field" refine. The
    // alternative — 200 for a write that changed nothing — is the ambiguity
    // this codebase spends the most effort avoiding: the client would believe
    // the update landed.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("still applies the known fields when an unknown one rides along", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ title: "Updated Title", target_word_count: 500 });

    // A stale client sending one dead field must not lose the edit it made.
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated Title");

    const reread = await request(t.app).get(`/api/chapters/${chapterId}`);
    expect(reread.status).toBe(200);
    expect(reread.body.title).toBe("Updated Title");
  });
});

describe("chapter routes reject a malformed :id with 400 (OOSS1)", () => {
  const BAD_UUID = "not-a-uuid";

  // Pre-existing on main: all four /:id handlers read req.params.id raw, so a
  // malformed id fell through to a service lookup and 404'd — telling the client
  // "this chapter does not exist" (stop retrying) when the truth is "you sent a
  // malformed id". Its siblings already 400: snapshots and outtakes via
  // validateUuidParam, images via its own requireUuidParam middleware.
  it.each([
    ["GET", () => request(t.app).get(`/api/chapters/${BAD_UUID}`)],
    ["PATCH", () => request(t.app).patch(`/api/chapters/${BAD_UUID}`).send({ title: "x" })],
    ["DELETE", () => request(t.app).delete(`/api/chapters/${BAD_UUID}`)],
    ["POST restore", () => request(t.app).post(`/api/chapters/${BAD_UUID}/restore`)],
  ])("%s returns 400, not 404", async (_method, send) => {
    const res = await send();
    expect(res.status).toBe(400);
  });

  // I4 (review 2026-08-16): the boundary between 400 and 404 is SHAPE, not
  // UUID version. This id has a non-4 version nibble, so it is a well-formed
  // 32-hex id that simply does not exist — 404, the same as any other absent
  // chapter. It 400'd before the zod pin, and nothing noticed. See
  // validateUuidParam.test.ts for the full domain.
  it("GET with a valid-shape, non-v4 id returns 404, not 400", async () => {
    const res = await request(t.app).get("/api/chapters/9f8e7d6c-5b4a-9392-8b1c-2d3e4f5a6b7c");
    expect(res.status).toBe(404);
  });
});
