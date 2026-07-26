import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { logger } from "../logger";

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

    it("does not 500 on a body TipTapDocSchema accepts but the walker cannot", async () => {
      // TipTapDocSchema constrains top-level elements only, so nested null and
      // primitive children pass validation and reach stripImageNodes. An
      // unguarded walk threw there, surfacing as 500 INTERNAL_ERROR — a status
      // the API contract does not allow for a malformed body.
      const projectId = await createProject();
      const res = await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [null, 42] }],
          },
        });
      expect(res.status).toBe(201);
    });

    it("returns 400 for an array-wrapped child rather than accepting it", async () => {
      // I2 (dedup review 2026-07-26): validateTipTapDepth — the depth cap's
      // sole enforcement point, reached via TipTapDocSchema's .refine — used to
      // return true for an array node, so this body was ACCEPTED and the
      // array-wrapped image merely stripped by the walker. That same hole made
      // MAX_TIPTAP_DEPTH bypassable by nesting through `content: [[...]]`.
      // An array is not a valid TipTap node in any position, so it is now
      // rejected at the boundary — a strictly better outcome than accept-and-
      // strip, and still a 400 rather than the 500 this case originally fixed.
      const projectId = await createProject();
      const res = await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [[{ type: "image", attrs: { src: "/x" } }]] },
            ],
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
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

    it("returns 413 for an oversize body", async () => {
      // S12: the shared express.json limit is covered at that layer, but the
      // client ships an outtake.create-specific 413 string whose only
      // justification is that THIS route really does 413. Prove it end to end.
      const projectId = await createProject();
      const huge = "x".repeat(6 * 1024 * 1024); // over the 5mb express.json limit
      // The global handler logs this through req.log (a per-request child), so
      // silencing the parent before the request is what keeps the suite quiet.
      const prevLevel = logger.level;
      logger.level = "silent";
      try {
        const res = await request(t.app)
          .post(`/api/projects/${projectId}/outtakes`)
          .send({ content: { type: "doc", content: [{ type: "text", text: huge }] } });
        expect(res.status).toBe(413);
        expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
      } finally {
        logger.level = prevLevel;
      }
    });
  });

  describe("GET /api/projects/:id/outtakes", () => {
    it("lists outtakes newest-first", async () => {
      const projectId = await createProject();
      await request(t.app)
        .post(`/api/projects/${projectId}/outtakes`)
        .send({ content: DOC, label: "first" });
      // S4: distinct created_at so "newest-first" is unambiguous. Two POSTs in
      // the same millisecond fall back to the id DESC tiebreak (a random
      // UUIDv4), which orders them at random. Same gap as the service test.
      await new Promise((r) => setTimeout(r, 5));
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
