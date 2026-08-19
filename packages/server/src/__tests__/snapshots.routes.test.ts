import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { logger } from "../logger";
import { LABEL_MAX_UNITS, SNAPSHOT_ERROR_CODES } from "@smudge/shared";

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
      expect(res.body.status).toBe("created");
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
      expect(res.body.status).toBe("created");
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
      expect(second.body.status).toBe("duplicate");
      // F-26 (architecture report 2026-08-11): this asserted `message` was
      // DEFINED — it pinned the server shipping user-facing English on a
      // success response, which the steering file forbids for the sibling
      // success contracts ("the client owns the toast, the server ships no
      // success copy"). The client already renders its own
      // STRINGS.snapshots.duplicateSkipped and ignored this field, so it was
      // dead weight that invited a future caller to display it. Inverted.
      expect(second.body.message).toBeUndefined();
    });

    // Safety net for F-34 and F-26 (architecture report 2026-08-11).
    //
    // F-34 adds the label cap's three missing treatments (input maxLength, a
    // discriminating server code, scope copy) to match the outtake sibling.
    // These pin what must NOT change while it does: the cap still rejects, and
    // it still rejects with 400 rather than moving onto a new status.
    //
    // F-26 drops the server-authored `message` from the duplicate 200. These
    // pin the parts of that response the client actually branches on, so the
    // removal cannot quietly take the status discriminator with it.
    it("rejects an over-cap label with 400 (F-34 safety net)", async () => {
      const { chapterId } = await createTestProject();

      const res = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "x".repeat(LABEL_MAX_UNITS + 1) });

      expect(res.status).toBe(400);
    });

    it("accepts a label exactly at the cap (F-34 safety net)", async () => {
      const { chapterId } = await createTestProject();

      const res = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "x".repeat(LABEL_MAX_UNITS) });

      expect(res.status).toBe(201);
      expect(res.body.snapshot.label).toHaveLength(LABEL_MAX_UNITS);
    });

    it("keeps the duplicate response's status discriminator at 200 (F-26 safety net)", async () => {
      const { chapterId } = await createTestProject();

      await request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({});
      const second = await request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({});

      expect(second.status).toBe(200);
      expect(second.body.status).toBe("duplicate");
      // The discriminator is the whole contract the client branches on; a
      // created response must stay distinguishable from a skipped one.
      expect(second.body.snapshot).toBeUndefined();
    });

    // F-34: the cap failure must be distinguishable from every other 400 this
    // endpoint emits. Mirrors the outtake precedent (S8) exactly, including the
    // negative cases — the client keys copy on the code, so a non-cap 400 that
    // carried it would name a cause that was not the cause.
    describe("400 codes discriminate the label cap from every other failure (F-34)", () => {
      it("labels an over-cap label with SNAPSHOT_LABEL_TOO_LONG", async () => {
        const { chapterId } = await createTestProject();

        const res = await request(t.app)
          .post(`/api/chapters/${chapterId}/snapshots`)
          .send({ label: "x".repeat(LABEL_MAX_UNITS + 1) });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG);
      });

      it.each([
        [
          "a bad uuid param",
          () => request(t.app).post(`/api/chapters/not-a-uuid/snapshots`).send({ label: "x" }),
        ],
        [
          "an unknown key rejected by .strict()",
          async () => {
            const { chapterId } = await createTestProject();
            return request(t.app)
              .post(`/api/chapters/${chapterId}/snapshots`)
              .send({ label: "x", nope: 1 });
          },
        ],
        [
          "a non-string label",
          async () => {
            const { chapterId } = await createTestProject();
            return request(t.app).post(`/api/chapters/${chapterId}/snapshots`).send({ label: 42 });
          },
        ],
      ])("does NOT label %s as a cap failure", async (_name, send) => {
        const res = await send();
        expect(res.status).toBe(400);
        expect(res.body.error.code).not.toBe(SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG);
      });
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

    it("puts dropped_image_count on the wire, snake_cased, only when non-zero (S6)", async () => {
      // S6 (agentic review 2026-08-17): the count was asserted only at the
      // service level, above `res.json`. The route spreads it onto the chapter
      // under a hand-written snake_case key that the client reads by the same
      // literal — a rename at either end had nothing going red, and the
      // "omitted when 0" half (whose ABSENCE is the client's "content is
      // exactly what was saved" signal) was equally unpinned.
      // The drop is a deliberate anomaly the service logs at warn level;
      // assert it rather than letting it noise up the suite.
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const { chapterId } = await createTestProject();

      const createRes = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "had-an-image" });
      const snapshotId = createRes.body.snapshot.id;

      // The ordinary restore says nothing about images.
      const clean = await request(t.app).post(`/api/snapshots/${snapshotId}/restore`);
      expect(clean.status).toBe(200);
      expect(clean.body).not.toHaveProperty("dropped_image_count");

      // Rewrite the snapshot to hold prose plus an image that no longer exists.
      await t
        .db("chapter_snapshots")
        .where({ id: snapshotId })
        .update({
          content: JSON.stringify({
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "the words survive" }] },
              {
                type: "image",
                attrs: { src: "/api/images/00000000-0000-0000-0000-0000000000aa" },
              },
            ],
          }),
        });

      const res = await request(t.app).post(`/api/snapshots/${snapshotId}/restore`);

      expect(res.status).toBe(200);
      expect(res.body.dropped_image_count).toBe(1);
      // Still assignable to Chapter — the field is spread, not nested.
      expect(res.body.id).toBe(chapterId);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dropped_image_ids: ["00000000-0000-0000-0000-0000000000aa"],
        }),
        expect.any(String),
      );
      warnSpy.mockRestore();
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
      expect(res.body.error.message).toBe("Snapshot content is corrupt and cannot be restored.");

      // Chapter must remain unchanged.
      const chapter = await t.db("chapters").where({ id: chapterId }).first();
      const parsed = JSON.parse(chapter.content);
      expect(parsed.content[0].content[0].text).toBe("Hello world");
    });

    it("returns 409 CROSS_PROJECT_IMAGE_REF when snapshot references a foreign image", async () => {
      // CLAUDE.md: 409 is the status for a well-formed request that
      // violates a resource-state constraint the client needs to resolve
      // (move/re-upload the image, or pick a different snapshot). The
      // CORRUPT_SNAPSHOT path stays at 400 — that is a validation error.
      const { chapterId } = await createTestProject();

      // Seed a foreign project + image that doesn't belong to our project.
      const foreignProjectId = "00000000-0000-0000-0000-000000000fff";
      const foreignImageId = "00000000-0000-0000-0000-000000000eee";
      const now = new Date().toISOString();
      await t.db("projects").insert({
        id: foreignProjectId,
        title: "Foreign",
        slug: "foreign",
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      await t.db("images").insert({
        id: foreignImageId,
        project_id: foreignProjectId,
        filename: "x.png",
        mime_type: "image/png",
        size_bytes: 1,
        reference_count: 1,
        created_at: now,
      });

      // Snapshot our chapter, then rewrite its content to point at the
      // foreign image — the restore path must refuse to apply it.
      const createRes = await request(t.app)
        .post(`/api/chapters/${chapterId}/snapshots`)
        .send({ label: "foreign-ref" });
      const snapshotId = createRes.body.snapshot.id;
      const crossProjectContent = JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: `/api/images/${foreignImageId}` } }],
      });
      await t
        .db("chapter_snapshots")
        .where({ id: snapshotId })
        .update({ content: crossProjectContent });

      const res = await request(t.app).post(`/api/snapshots/${snapshotId}/restore`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CROSS_PROJECT_IMAGE_REF");
      expect(res.body.error.message).toBe(
        "Snapshot references an image from a different project and cannot be restored.",
      );
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
