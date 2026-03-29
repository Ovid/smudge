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

    const chapters = await t.db("chapters")
      .where({ project_id: res.body.id })
      .select("*");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Untitled Chapter");
    expect(chapters[0].sort_order).toBe(0);
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(t.app)
      .post("/api/projects")
      .send({ mode: "fiction" });

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
