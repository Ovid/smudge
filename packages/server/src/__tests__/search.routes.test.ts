import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { logger } from "../logger";

const t = setupTestDb();

afterEach(() => {
  vi.restoreAllMocks();
});

async function createProjectWithChapters(): Promise<{
  projectId: string;
  projectSlug: string;
  chapterId: string;
}> {
  const projRes = await request(t.app)
    .post("/api/projects")
    .send({ title: `Search Project ${Date.now()}`, mode: "fiction" });
  const projectId = projRes.body.id;
  const projectSlug = projRes.body.slug;

  // Get the auto-created first chapter
  const projDetail = await request(t.app).get(`/api/projects/${projectSlug}`);
  const chapterId = projDetail.body.chapters[0].id;

  // Give the chapter content with known text
  await request(t.app)
    .patch(`/api/chapters/${chapterId}`)
    .send({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "The quick brown fox jumps over the lazy dog" }],
          },
        ],
      },
    });

  return { projectId, projectSlug, chapterId };
}

describe("search routes", () => {
  describe("POST /api/projects/:slug/search", () => {
    it("returns 200 with results for matching query", async () => {
      const { projectSlug } = await createProjectWithChapters();

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/search`)
        .send({ query: "quick brown" });

      expect(res.status).toBe(200);
      expect(res.body.total_count).toBeGreaterThan(0);
      expect(res.body.chapters).toHaveLength(1);
      expect(res.body.chapters[0].matches.length).toBeGreaterThan(0);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(t.app)
        .post("/api/projects/nonexistent-slug/search")
        .send({ query: "test" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for empty query", async () => {
      const { projectSlug } = await createProjectWithChapters();

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/search`)
        .send({ query: "" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid regex", async () => {
      const { projectSlug } = await createProjectWithChapters();

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/search`)
        .send({ query: "[invalid", options: { regex: true } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("re-throws non-regex errors from searchProject", async () => {
      const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const { projectSlug } = await createProjectWithChapters();

      // Spy on SearchService to throw a generic error
      const SearchService = await import("../search/search.service");
      const spy = vi
        .spyOn(SearchService, "searchProject")
        .mockRejectedValueOnce(new Error("unexpected DB error"));

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/search`)
        .send({ query: "test" });

      expect(res.status).toBe(500);
      expect(logSpy).toHaveBeenCalled();
      spy.mockRestore();
      logSpy.mockRestore();
    });
  });

  describe("POST /api/projects/:slug/replace", () => {
    it("returns 200 with count and affected IDs", async () => {
      const { projectSlug, chapterId } = await createProjectWithChapters();

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/replace`)
        .send({ search: "quick brown", replace: "slow red" });

      expect(res.status).toBe(200);
      expect(res.body.replaced_count).toBe(1);
      expect(res.body.affected_chapter_ids).toContain(chapterId);
    });

    it("auto-snapshots created before replacement", async () => {
      const { projectSlug, chapterId } = await createProjectWithChapters();

      await request(t.app)
        .post(`/api/projects/${projectSlug}/replace`)
        .send({ search: "quick", replace: "slow" });

      // Verify snapshot was created via the snapshots API
      const snapRes = await request(t.app).get(`/api/chapters/${chapterId}/snapshots`);
      expect(snapRes.status).toBe(200);
      expect(snapRes.body.length).toBeGreaterThanOrEqual(1);
      const autoSnapshot = snapRes.body.find((s: { is_auto: boolean }) => s.is_auto);
      expect(autoSnapshot).toBeDefined();
      expect(autoSnapshot.label).toContain("find-and-replace");
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(t.app)
        .post("/api/projects/nonexistent-slug/replace")
        .send({ search: "test", replace: "other" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for invalid regex", async () => {
      const { projectSlug } = await createProjectWithChapters();

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/replace`)
        .send({
          search: "[invalid",
          replace: "test",
          options: { regex: true },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 when replaceInProject returns null (project vanished between slug lookup and service)", async () => {
      const { projectSlug } = await createProjectWithChapters();

      const SearchService = await import("../search/search.service");
      const spy = vi.spyOn(SearchService, "replaceInProject").mockResolvedValueOnce(null);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/replace`)
        .send({ search: "test", replace: "other" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      spy.mockRestore();
    });

    it("returns 400 for empty search", async () => {
      const { projectSlug } = await createProjectWithChapters();

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/replace`)
        .send({ search: "", replace: "test" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("replace with empty string works", async () => {
      const { projectSlug } = await createProjectWithChapters();

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/replace`)
        .send({ search: "quick brown ", replace: "" });

      expect(res.status).toBe(200);
      expect(res.body.replaced_count).toBe(1);
    });
  });
});
