import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

const DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
};

const BAD_UUID = "not-a-uuid";
const UNKNOWN_UUID = "00000000-0000-0000-0000-000000000000";

async function createProject(): Promise<string> {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: `Test Project ${Date.now()}-${Math.random()}`, mode: "fiction" });
  return res.body.id;
}

describe("outtakes routes", () => {
  describe("POST /api/projects/:id/outtakes", () => {
    it("returns 201 with the created outtake", async () => {
      const projectId = await createProject();
      const res = await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: DOC, label: "Cut scene" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.project_id).toBe(projectId);
      expect(res.body.label).toBe("Cut scene");
      expect(JSON.stringify(res.body.content)).toContain("Hello world");
    });

    it("returns 400 for an invalid body", async () => {
      const projectId = await createProject();
      const res = await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: 42 });
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown project", async () => {
      const res = await request(t.app)
        .post(`/api/projects/${UNKNOWN_UUID}/outtakes`)
        .send({ content: DOC });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for a bad-uuid project param", async () => {
      const res = await request(t.app)
        .post(`/api/projects/${BAD_UUID}/outtakes`)
        .send({ content: DOC });
      expect(res.status).toBe(400);
    });

    // Oversize bodies yield 413 via the shared express.json limit (covered at that layer), so not re-tested here.
  });

  describe("GET /api/projects/:id/outtakes", () => {
    it("lists outtakes newest-first", async () => {
      const projectId = await createProject();
      await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: DOC, label: "first" });
      await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: DOC, label: "second" });

      const res = await request(t.app).get(`/api/projects/${projectId}/outtakes`);
      expect(res.status).toBe(200);
      expect(res.body.map((o: { label: string }) => o.label)).toEqual(["second", "first"]);
    });

    it("returns 404 for an unknown project", async () => {
      const res = await request(t.app).get(`/api/projects/${UNKNOWN_UUID}/outtakes`);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/outtakes/:id", () => {
    it("updates the label (200)", async () => {
      const projectId = await createProject();
      const created = await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: DOC, label: "old" });

      const res = await request(t.app)
        .patch(`/api/outtakes/${created.body.id}`)
        .send({ label: "new" });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe("new");
    });

    it("returns 404 for an unknown id", async () => {
      const res = await request(t.app).patch(`/api/outtakes/${UNKNOWN_UUID}`).send({ label: "x" });
      expect(res.status).toBe(404);
    });

    it("returns 400 for a bad body", async () => {
      const projectId = await createProject();
      const created = await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: DOC });
      const res = await request(t.app)
        .patch(`/api/outtakes/${created.body.id}`)
        .send({ label: 42 });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a bad-uuid outtake param", async () => {
      const res = await request(t.app).patch(`/api/outtakes/${BAD_UUID}`).send({ label: "x" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/outtakes/:id", () => {
    it("returns 204 and the outtake no longer lists", async () => {
      const projectId = await createProject();
      const created = await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: DOC });

      const del = await request(t.app).delete(`/api/outtakes/${created.body.id}`);
      expect(del.status).toBe(204);

      const list = await request(t.app).get(`/api/projects/${projectId}/outtakes`);
      expect(list.body).toEqual([]);
    });

    it("returns 404 for an unknown id", async () => {
      const res = await request(t.app).delete(`/api/outtakes/${UNKNOWN_UUID}`);
      expect(res.status).toBe(404);
    });

    it("returns 400 for a bad-uuid outtake param", async () => {
      const res = await request(t.app).delete(`/api/outtakes/${BAD_UUID}`);
      expect(res.status).toBe(400);
    });
  });
});
