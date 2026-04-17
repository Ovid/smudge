import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

async function createTestProject(): Promise<{ projectId: string; chapterId: string }> {
  const projRes = await request(t.app)
    .post("/api/projects")
    .send({ title: `Test Project ${Date.now()}`, mode: "fiction" });
  const projectId = projRes.body.id;
  const projectSlug = projRes.body.slug;

  // Get the auto-created first chapter via slug
  const projDetail = await request(t.app).get(`/api/projects/${projectSlug}`);
  const chapterId = projDetail.body.chapters[0].id;

  // Give the chapter some content so snapshots have something to capture
  await request(t.app)
    .patch(`/api/chapters/${chapterId}`)
    .send({
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
      },
    });

  return { projectId, chapterId };
}

describe("snapshot routes", () => {
  describe("POST /api/chapters/:id/snapshots", () => {
    it("returns 201 with snapshot when no label provided", async () => {
      const { chapterId } = await createTestProject();

      const res = await request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({});

      expect(res.status).toBe(201);
      expect(res.body.duplicate).toBe(false);
      const snap = res.body.snapshot;
      expect(snap.id).toBeDefined();
      expect(snap.chapter_id).toBe(chapterId);
      expect(snap.label).toBeNull();
      expect(snap.content).toBeDefined();
      expect(snap.word_count).toBe(2);
      expect(snap.is_auto).toBe(false);
      expect(snap.created_at).toBeDefined();
    });

    it("returns 201 with label when provided", async () => {
      const { chapterId } = await createTestProject();

      const res = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "Draft 1" });

      expect(res.status).toBe(201);
      expect(res.body.duplicate).toBe(false);
      expect(res.body.snapshot.label).toBe("Draft 1");
    });

    it("returns 404 for non-existent chapter", async () => {
      const res = await request(t.app)
        .post("/api/chapters/00000000-0000-0000-0000-000000000000/snapshots")
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 200 for duplicate content", async () => {
      const { chapterId } = await createTestProject();

      // First snapshot
      const first = await request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({});
      expect(first.status).toBe(201);

      // Second snapshot with same content
      const second = await request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({});
      expect(second.status).toBe(200);
      expect(second.body.duplicate).toBe(true);
      expect(second.body.message).toBeDefined();
    });

    it("returns 400 when the body fails schema validation", async () => {
      const { chapterId } = await createTestProject();

      const res = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: 42 }); // label must be a string

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when chapter id is not a UUID", async () => {
      const res = await request(t.app).post(`/api/chapters/not-a-uuid/snapshots`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/chapters/:id/snapshots", () => {
    it("returns 200 with list, content excluded", async () => {
      const { chapterId } = await createTestProject();

      // Create a snapshot first
      await request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({ label: "v1" });

      const res = await request(t.app).get(`/api/chapters/${chapterId}/snapshots`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBeDefined();
      expect(res.body[0].label).toBe("v1");
      expect(res.body[0]).not.toHaveProperty("content");
    });

    it("returns 404 for non-existent chapter", async () => {
      const res = await request(t.app).get(
        "/api/chapters/00000000-0000-0000-0000-000000000000/snapshots",
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /api/snapshots/:id", () => {
    it("returns 200 with full content", async () => {
      const { chapterId } = await createTestProject();

      const createRes = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "full" });
      const snapshotId = createRes.body.snapshot.id;

      const res = await request(t.app).get(`/api/snapshots/${snapshotId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(snapshotId);
      expect(res.body.content).toBeDefined();
      expect(res.body.label).toBe("full");
    });

    it("returns 404 for non-existent snapshot", async () => {
      const res = await request(t.app).get("/api/snapshots/00000000-0000-0000-0000-000000000000");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("DELETE /api/snapshots/:id", () => {
    it("returns 204 on success", async () => {
      const { chapterId } = await createTestProject();

      const createRes = await request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({});
      const snapshotId = createRes.body.snapshot.id;

      const res = await request(t.app).delete(`/api/snapshots/${snapshotId}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const getRes = await request(t.app).get(`/api/snapshots/${snapshotId}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for non-existent snapshot", async () => {
      const res = await request(t.app).delete(
        "/api/snapshots/00000000-0000-0000-0000-000000000000",
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /api/snapshots/:id/restore", () => {
    it("returns 200 with chapter, content replaced and auto-snapshot created", async () => {
      const { chapterId } = await createTestProject();

      // Create a snapshot of current content
      const createRes = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "before edit" });
      const snapshotId = createRes.body.snapshot.id;

      // Change the chapter content
      await request(t.app)
        .patch(`/api/chapters/${chapterId}`)
        .send({
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Changed content entirely" }] },
            ],
          },
        });

      // Restore to the snapshot
      const res = await request(t.app).post(`/api/snapshots/${snapshotId}/restore`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(chapterId);
      expect(res.body.word_count).toBe(2); // "Hello world"

      // Verify auto-snapshot was created (should have 2 snapshots now: manual + auto-restore)
      const listRes = await request(t.app).get(`/api/chapters/${chapterId}/snapshots`);
      expect(listRes.body.length).toBe(2);
      const autoSnapshot = listRes.body.find((s: { is_auto: boolean }) => s.is_auto);
      expect(autoSnapshot).toBeDefined();
      expect(autoSnapshot.label).toContain("Before restore");
    });

    it("returns 404 for non-existent snapshot", async () => {
      const res = await request(t.app).post(
        "/api/snapshots/00000000-0000-0000-0000-000000000000/restore",
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for non-UUID snapshot id on restore", async () => {
      const res = await request(t.app).post("/api/snapshots/not-a-uuid/restore");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when the snapshot content is corrupt", async () => {
      const { chapterId } = await createTestProject();

      // Insert a snapshot with intentionally-corrupt content via the raw db.
      const createRes = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "corrupt-me" });
      const snapshotId = createRes.body.snapshot.id;
      await t
        .db("chapter_snapshots")
        .where({ id: snapshotId })
        .update({ content: "{corrupt json!!" });

      const res = await request(t.app).post(`/api/snapshots/${snapshotId}/restore`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CORRUPT_SNAPSHOT");

      // Chapter must remain unchanged.
      const chapter = await t.db("chapters").where({ id: chapterId }).first();
      const parsed = JSON.parse(chapter.content);
      expect(parsed.content[0].content[0].text).toBe("Hello world");
    });

    it("returns 400 for non-UUID snapshot id on GET", async () => {
      const res = await request(t.app).get("/api/snapshots/not-a-uuid");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for non-UUID snapshot id on DELETE", async () => {
      const res = await request(t.app).delete("/api/snapshots/not-a-uuid");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
