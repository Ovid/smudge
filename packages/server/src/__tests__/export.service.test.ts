import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

const TIPTAP_CONTENT = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
};

const TIPTAP_CONTENT_2 = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Second chapter text" }] }],
};

async function createProjectWithChapters(
  app: ReturnType<typeof setupTestDb>["app"],
  options?: { authorName?: string },
) {
  const projRes = await request(app)
    .post("/api/projects")
    .send({ title: "My Novel", mode: "fiction" });

  const projectSlug = projRes.body.slug as string;
  const projectId = projRes.body.id as string;

  // Set author_name if requested
  if (options?.authorName) {
    await request(app)
      .patch(`/api/projects/${projectSlug}`)
      .send({ author_name: options.authorName });
  }

  // Get the auto-created first chapter
  const getRes = await request(app).get(`/api/projects/${projectSlug}`);
  const firstChapterId = getRes.body.chapters[0].id as string;

  // Update first chapter with title and content
  await request(app)
    .patch(`/api/chapters/${firstChapterId}`)
    .send({ title: "Chapter One", content: TIPTAP_CONTENT });

  // Create a second chapter
  const ch2Res = await request(app).post(`/api/projects/${projectSlug}/chapters`).send();
  const secondChapterId = ch2Res.body.id as string;
  await request(app)
    .patch(`/api/chapters/${secondChapterId}`)
    .send({ title: "Chapter Two", content: TIPTAP_CONTENT_2 });

  return { projectSlug, projectId, firstChapterId, secondChapterId };
}

describe("POST /api/projects/:slug/export", () => {
  describe("HTML export", () => {
    it("exports all chapters as HTML", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html" });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-disposition"]).toContain(`filename="${projectSlug}.html"`);
      expect(res.text).toContain("<!DOCTYPE html>");
      expect(res.text).toContain("Chapter One");
      expect(res.text).toContain("Chapter Two");
      expect(res.text).toContain("Hello world");
      expect(res.text).toContain("Second chapter text");
    });

    it("includes author_name when set", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app, {
        authorName: "Jane Austen",
      });

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Jane Austen");
    });

    it("includes TOC by default", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Table of Contents");
    });

    it("omits TOC when include_toc is false", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html", include_toc: false });

      expect(res.status).toBe(200);
      expect(res.text).not.toContain("Table of Contents");
    });
  });

  describe("Markdown export", () => {
    it("exports as Markdown", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "markdown" });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/markdown");
      expect(res.headers["content-disposition"]).toContain(`filename="${projectSlug}.md"`);
      expect(res.text).toContain("# My Novel");
      expect(res.text).toContain("## Chapter One");
      expect(res.text).toContain("## Chapter Two");
    });
  });

  describe("Plain text export", () => {
    it("exports as plain text", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "plaintext" });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.headers["content-disposition"]).toContain(`filename="${projectSlug}.txt"`);
      expect(res.text).toContain("MY NOVEL");
    });
  });

  describe("chapter selection", () => {
    it("exports only selected chapters", async () => {
      const { projectSlug, firstChapterId } = await createProjectWithChapters(t.app);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html", chapter_ids: [firstChapterId] });

      expect(res.status).toBe(200);
      expect(res.text).toContain("Chapter One");
      expect(res.text).toContain("Hello world");
      expect(res.text).not.toContain("Chapter Two");
      expect(res.text).not.toContain("Second chapter text");
    });

    it("returns 400 when chapter_ids contain IDs from another project", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);

      // Create a second project with its own chapter
      const proj2Res = await request(t.app)
        .post("/api/projects")
        .send({ title: "Other Novel", mode: "fiction" });
      const proj2Slug = proj2Res.body.slug as string;
      const proj2GetRes = await request(t.app).get(`/api/projects/${proj2Slug}`);
      const otherChapterId = proj2GetRes.body.chapters[0].id as string;

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html", chapter_ids: [otherChapterId] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("EXPORT_INVALID_CHAPTERS");
    });

    it("returns 400 when chapter_ids include a soft-deleted chapter", async () => {
      const { projectSlug, secondChapterId } = await createProjectWithChapters(t.app);

      // Soft-delete the second chapter
      await request(t.app).delete(`/api/chapters/${secondChapterId}`);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html", chapter_ids: [secondChapterId] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("EXPORT_INVALID_CHAPTERS");
    });
  });

  describe("title-page-only export", () => {
    it("exports title page only when project has no chapters", async () => {
      const { projectSlug, firstChapterId, secondChapterId } = await createProjectWithChapters(
        t.app,
      );

      // Delete all chapters
      await request(t.app).delete(`/api/chapters/${firstChapterId}`);
      await request(t.app).delete(`/api/chapters/${secondChapterId}`);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("My Novel");
      expect(res.text).not.toContain("Chapter One");
      expect(res.text).not.toContain("Chapter Two");
    });
  });

  describe("error handling", () => {
    it("returns 400 for invalid format", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "pdf" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 for non-existent project", async () => {
      const res = await request(t.app)
        .post("/api/projects/nonexistent-slug/export")
        .send({ format: "html" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for soft-deleted project", async () => {
      const { projectSlug } = await createProjectWithChapters(t.app);
      await request(t.app).delete(`/api/projects/${projectSlug}`);

      const res = await request(t.app)
        .post(`/api/projects/${projectSlug}/export`)
        .send({ format: "html" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
