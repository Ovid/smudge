import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("POST /api/projects", () => {
  it("creates a project and returns 201 with project data", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
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
    expect(chapters[0].title).toBe("Untitled Chapter");
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

describe("PATCH /api/projects/:id", () => {
  it("renames a project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Old Name", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.id}`)
      .send({ title: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Name");
  });

  it("trims whitespace from title", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.id}`)
      .send({ title: "  Trimmed  " });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Trimmed");
  });

  it("returns 400 when title is missing", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app).patch(`/api/projects/${createRes.body.id}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when title is whitespace-only", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Book", mode: "fiction" });

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.id}`)
      .send({ title: "   " });

    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).patch("/api/projects/nonexistent-id").send({ title: "Nope" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for soft-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Deleted", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.id}`);

    const res = await request(t.app)
      .patch(`/api/projects/${createRes.body.id}`)
      .send({ title: "Nope" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id", () => {
  it("returns project with chapters", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    const res = await request(t.app).get(`/api/projects/${createRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("My Novel");
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].title).toBe("Untitled Chapter");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent-id");
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
    const res = await request(t.app).get(`/api/projects/${createRes.body.id}`);
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
    const res = await request(t.app).get(`/api/projects/${projectId}`);
    expect(res.body.chapters).toHaveLength(2);
    expect(res.body.chapters[0].title).toBe("Untitled Chapter");
    expect(res.body.chapters[1].title).toBe("Chapter Two");
  });
});

describe("DELETE /api/projects/:id", () => {
  it("soft-deletes a project and returns 200", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    const res = await request(t.app).delete(`/api/projects/${createRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Project moved to trash.");
  });

  it("sets deleted_at on the project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.id}`);
    const project = await t.db("projects").where({ id: createRes.body.id }).first();
    expect(project.deleted_at).not.toBeNull();
  });

  it("soft-deleted project no longer appears in GET /api/projects", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.id}`);
    const listRes = await request(t.app).get("/api/projects");
    expect(listRes.body).toHaveLength(0);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).delete("/api/projects/nonexistent-id");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for already-deleted project", async () => {
    const createRes = await request(t.app)
      .post("/api/projects")
      .send({ title: "Doomed", mode: "fiction" });
    await request(t.app).delete(`/api/projects/${createRes.body.id}`);
    const res = await request(t.app).delete(`/api/projects/${createRes.body.id}`);
    expect(res.status).toBe(404);
  });
});
