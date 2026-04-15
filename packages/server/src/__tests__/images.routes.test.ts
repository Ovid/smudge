import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const t = setupTestDb();

let tmpDir: string;
let originalDataDir: string | undefined;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "smudge-routes-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
});

afterAll(async () => {
  if (originalDataDir !== undefined) {
    process.env.DATA_DIR = originalDataDir;
  } else {
    delete process.env.DATA_DIR;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

async function createTestProject(): Promise<string> {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: `Test Project ${Date.now()}`, mode: "fiction" });
  return res.body.id;
}

async function uploadTestImage(projectId: string): Promise<string> {
  const res = await request(t.app)
    .post(`/api/projects/${projectId}/images`)
    .attach("file", TEST_PNG, { filename: "test.png", contentType: "image/png" });
  return res.body.id;
}

describe("POST /api/projects/:projectId/images", () => {
  it("uploads a valid PNG and returns 201 with image record", async () => {
    const projectId = await createTestProject();

    const res = await request(t.app)
      .post(`/api/projects/${projectId}/images`)
      .attach("file", TEST_PNG, { filename: "test.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.project_id).toBe(projectId);
    expect(res.body.filename).toBe("test.png");
    expect(res.body.mime_type).toBe("image/png");
    expect(res.body.size_bytes).toBe(TEST_PNG.length);
    expect(res.body.created_at).toBeDefined();
  });

  it("returns 400 for invalid MIME type", async () => {
    const projectId = await createTestProject();

    const res = await request(t.app)
      .post(`/api/projects/${projectId}/images`)
      .attach("file", Buffer.from("hello world"), {
        filename: "test.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when no file is provided", async () => {
    const projectId = await createTestProject();

    const res = await request(t.app)
      .post(`/api/projects/${projectId}/images`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app)
      .post("/api/projects/00000000-0000-0000-0000-000000000000/images")
      .attach("file", TEST_PNG, { filename: "test.png", contentType: "image/png" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 413 for oversized file", async () => {
    const projectId = await createTestProject();
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024);

    const res = await request(t.app)
      .post(`/api/projects/${projectId}/images`)
      .attach("file", bigBuffer, { filename: "big.png", contentType: "image/png" });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("GET /api/projects/:projectId/images", () => {
  it("lists images for a project", async () => {
    const projectId = await createTestProject();
    await uploadTestImage(projectId);

    const res = await request(t.app).get(`/api/projects/${projectId}/images`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].project_id).toBe(projectId);
  });

  it("returns empty array for project with no images", async () => {
    const projectId = await createTestProject();

    const res = await request(t.app).get(`/api/projects/${projectId}/images`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /api/images/:id", () => {
  it("serves image file with correct Content-Type and Cache-Control", async () => {
    const projectId = await createTestProject();
    const imageId = await uploadTestImage(projectId);

    const res = await request(t.app).get(`/api/images/${imageId}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.body).toBeInstanceOf(Buffer);
  });

  it("returns 404 for non-existent image", async () => {
    const res = await request(t.app).get(
      "/api/images/00000000-0000-0000-0000-000000000000",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /api/images/:id/references", () => {
  it("returns chapter list for image references", async () => {
    const projectId = await createTestProject();
    const imageId = await uploadTestImage(projectId);

    const res = await request(t.app).get(`/api/images/${imageId}/references`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.chapters)).toBe(true);
  });

  it("returns 404 for non-existent image", async () => {
    const res = await request(t.app).get(
      "/api/images/00000000-0000-0000-0000-000000000000/references",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("PATCH /api/images/:id", () => {
  it("updates metadata and returns 200", async () => {
    const projectId = await createTestProject();
    const imageId = await uploadTestImage(projectId);

    const res = await request(t.app)
      .patch(`/api/images/${imageId}`)
      .send({ alt_text: "A test image", caption: "Test caption" });

    expect(res.status).toBe(200);
    expect(res.body.alt_text).toBe("A test image");
    expect(res.body.caption).toBe("Test caption");
  });

  it("returns 400 for empty body", async () => {
    const projectId = await createTestProject();
    const imageId = await uploadTestImage(projectId);

    const res = await request(t.app).patch(`/api/images/${imageId}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for non-existent image", async () => {
    const res = await request(t.app)
      .patch("/api/images/00000000-0000-0000-0000-000000000000")
      .send({ alt_text: "test" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/images/:id", () => {
  it("deletes an unreferenced image and returns 200", async () => {
    const projectId = await createTestProject();
    const imageId = await uploadTestImage(projectId);

    const res = await request(t.app).delete(`/api/images/${imageId}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it("returns 409 when image is referenced by a chapter", async () => {
    const projectId = await createTestProject();
    const imageId = await uploadTestImage(projectId);

    // Get the auto-created chapter via the project's slug
    const projectsRes = await request(t.app).get("/api/projects");
    const project = projectsRes.body.find(
      (p: { id: string }) => p.id === projectId,
    );
    const projectRes = await request(t.app).get(`/api/projects/${project.slug}`);
    const chapterId = projectRes.body.chapters[0].id;

    const contentWithImage = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: `/api/images/${imageId}` },
        },
      ],
    };

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: contentWithImage });

    const res = await request(t.app).delete(`/api/images/${imageId}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IMAGE_IN_USE");
    expect(Array.isArray(res.body.error.chapters)).toBe(true);
    expect(res.body.error.chapters.length).toBeGreaterThan(0);
  });

  it("returns 404 for non-existent image", async () => {
    const res = await request(t.app).delete(
      "/api/images/00000000-0000-0000-0000-000000000000",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
