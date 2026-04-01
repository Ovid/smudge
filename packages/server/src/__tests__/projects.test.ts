import { describe, it, expect } from "vitest";
import request from "supertest";
import { UNTITLED_CHAPTER } from "@smudge/shared";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("POST /api/projects", () => {
  it("creates a project and returns 201 with slug", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.slug).toBe("my-novel");
    expect(res.body.title).toBe("My Novel");
    expect(res.body.mode).toBe("fiction");
    expect(res.body.created_at).toBeDefined();
    expect(res.body.updated_at).toBeDefined();
  });

  it("auto-creates a first chapter", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(201);

    const chapters = await t.db("chapters").where({ project_id: res.body.id }).select("*");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe(UNTITLED_CHAPTER);
    expect(chapters[0].sort_order).toBe(0);
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(t.app).post("/api/projects").send({ mode: "fiction" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when mode is invalid", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "poetry" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("trims whitespace from title", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "  My Novel  ", mode: "fiction" });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("My Novel");
    expect(res.body.slug).toBe("my-novel");
  });

  it("returns 400 when title duplicates an existing project", async () => {
    await request(t.app).post("/api/projects").send({ title: "My Novel", mode: "fiction" });

    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROJECT_TITLE_EXISTS");
  });

  it("allows reuse of a soft-deleted project title", async () => {
    const first = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${first.body.slug}`);

    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("my-novel");
  });
});

describe("GET /api/projects", () => {
  it("returns empty array when no projects exist", async () => {
    const res = await request(t.app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all non-deleted projects sorted by updated_at desc", async () => {
    await request(t.app).post("/api/projects").send({ title: "First", mode: "fiction" });
    await request(t.app).post("/api/projects").send({ title: "Second", mode: "nonfiction" });

    const res = await request(t.app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe("Second");
    expect(res.body[1].title).toBe("First");
    expect(res.body[0].total_word_count).toBe(0);
  });

  it("returns projects with slug field", async () => {
    await request(t.app).post("/api/projects").send({ title: "First", mode: "fiction" });

    const res = await request(t.app).get("/api/projects");
    expect(res.body[0].slug).toBe("first");
  });

  it("excludes soft-deleted projects", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Deleted", mode: "fiction" });
    await t
      .db("projects")
      .where({ id: createRes.body.id })
      .update({ deleted_at: new Date().toISOString() });

    const res = await request(t.app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("PATCH /api/projects/:slug", () => {
  it("renames a project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Old Name", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Name");
  });

  it("returns updated slug when title changes", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Old Name", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("new-name");
  });

  it("trims whitespace from title", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "  Trimmed  " });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Trimmed");
  });

  it("returns 400 when title is missing", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app).patch(`/api/projects/${createRes.body.slug}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when title is whitespace-only", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "   " });

    expect(res.status).toBe(400);
  });

  it("returns 400 when renaming to a duplicate title", async () => {
    await request(t.app).post("/api/projects").send({ title: "First", mode: "fiction" });
    const second = await request(t.app)
      .post("/api/projects")
      .send({ title: "Second", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${second.body.slug}`)
      .send({ title: "First" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROJECT_TITLE_EXISTS");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app)
      .patch("/api/projects/nonexistent-slug")
      .send({ title: "Nope" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for soft-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Deleted", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.slug}`)
      .send({ title: "Nope" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:slug", () => {
  it("returns project with chapters", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    const res = await request(t.app).get(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("My Novel");
    expect(res.body.slug).toBe("my-novel");
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].title).toBe(UNTITLED_CHAPTER);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent-slug");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for soft-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Deleted", mode: "fiction" });
    await t
      .db("projects")
      .where({ id: createRes.body.id })
      .update({ deleted_at: new Date().toISOString() });

    const res = await request(t.app).get(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(404);
  });

  it("orders chapters by sort_order", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    const projectId = createRes.body.id;
    const now = new Date().toISOString();
    await t.db("chapters").insert({
      id: "ch-2",
      project_id: projectId,
      title: "Chapter Two",
      sort_order: 1,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });

    const res = await request(t.app).get(`/api/projects/${createRes.body.slug}`);
    expect(res.body.chapters).toHaveLength(2);
    expect(res.body.chapters[0].title).toBe(UNTITLED_CHAPTER);
    expect(res.body.chapters[1].title).toBe("Chapter Two");
  });
});

describe("PUT /api/projects/:slug/chapters/order", () => {
  it("reorders chapters by provided ID array", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    await request(t.app).post(`/api/projects/${projectSlug}/chapters`);
    await request(t.app).post(`/api/projects/${projectSlug}/chapters`);

    const getRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    const [ch1Id, ch2Id, ch3Id] = getRes.body.chapters.map((c: { id: string }) => c.id);

    const res = await request(t.app)
      .put(`/api/projects/${projectSlug}/chapters/order`)
      .send({ chapter_ids: [ch3Id, ch2Id, ch1Id] });

    expect(res.status).toBe(200);

    const updated = await request(t.app).get(`/api/projects/${projectSlug}`);
    expect(updated.body.chapters.map((c: { id: string }) => c.id)).toEqual([ch3Id, ch2Id, ch1Id]);
  });

  it("returns 400 if chapter IDs don't match", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    const res = await request(t.app)
      .put(`/api/projects/${projectSlug}/chapters/order`)
      .send({ chapter_ids: ["wrong-id"] });

    expect(res.status).toBe(400);
  });

  it("returns REORDER_MISMATCH when IDs have correct count but wrong values", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    // Project auto-creates one chapter; send one ID but the wrong one
    const res = await request(t.app)
      .put(`/api/projects/${projectSlug}/chapters/order`)
      .send({ chapter_ids: ["00000000-0000-0000-0000-000000000000"] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("REORDER_MISMATCH");
  });

  it("returns 400 if chapter_ids is missing or not an array", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    const res = await request(t.app).put(`/api/projects/${projectSlug}/chapters/order`).send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app)
      .put("/api/projects/nonexistent-slug/chapters/order")
      .send({ chapter_ids: [] });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:slug/trash", () => {
  it("returns soft-deleted chapters for a project", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    const getRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    const chapterId = getRes.body.chapters[0].id;

    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).get(`/api/projects/${projectSlug}/trash`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(chapterId);
    expect(res.body[0].deleted_at).toBeTruthy();
  });

  it("returns empty array when no trashed chapters", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;

    const res = await request(t.app).get(`/api/projects/${projectSlug}/trash`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent-slug/trash");

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:slug", () => {
  it("soft-deletes a project and returns 200", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });

    const res = await request(t.app).delete(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Project moved to trash.");
  });

  it("sets deleted_at on the project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const project = await t.db("projects").where({ id: createRes.body.id }).first();
    expect(project.deleted_at).not.toBeNull();
  });

  it("soft-deleted project no longer appears in GET /api/projects", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const listRes = await request(t.app).get("/api/projects");
    expect(listRes.body).toHaveLength(0);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).delete("/api/projects/nonexistent-slug");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for already-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.slug}`);

    const res = await request(t.app).delete(`/api/projects/${createRes.body.slug}`);
    expect(res.status).toBe(404);
  });

  it("soft-deletes all chapters when project is deleted", async () => {
    const projectRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Test", mode: "fiction" });
    const projectSlug = projectRes.body.slug;
    const projectId = projectRes.body.id;

    await request(t.app).post(`/api/projects/${projectSlug}/chapters`);

    await request(t.app).delete(`/api/projects/${projectSlug}`);

    const chapters = await t.db("chapters").where({ project_id: projectId });
    expect(chapters.every((c: { deleted_at: string | null }) => c.deleted_at !== null)).toBe(true);
  });
});
