import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

// Safety net for architecture flaw F-3 (server error taxonomy refactor).
//
// The existing route integration tests pin HTTP status + `error.code`
// for every failure path, but they do NOT pin the human-readable
// `error.message`. F-3 introduces an `AppError` taxonomy and moves the
// message strings out of the inline `res.status().json()` envelopes
// (the same "Project not found." literal is duplicated 7× in
// projects.routes.ts alone) into the taxonomy. This file pins the full
// envelope — status + code + message — for the static-message failure
// paths, so the refactor cannot silently drift a message string.
//
// VALIDATION_ERROR / INVALID_REGEX messages are intentionally NOT pinned
// here: they are derived dynamically (Zod issue text, RegExp engine
// text) and pass through the taxonomy unchanged, so their `code` (pinned
// elsewhere) is the stable contract, not their text.
//
// A valid-form UUID that does not exist in the DB exercises the
// not-found paths without tripping the upstream UUID-format guard.
const ABSENT_UUID = "00000000-0000-4000-8000-000000000000";

describe("error envelope contract (F-3 safety net)", () => {
  const t = setupTestDb();

  async function createProject(title: string) {
    const res = await request(t.app).post("/api/projects").send({ title, mode: "fiction" });
    expect(res.status).toBe(201);
    return res.body as { slug: string; id: string };
  }

  it("GET /api/projects/:slug — 404 NOT_FOUND 'Project not found.'", async () => {
    const res = await request(t.app).get("/api/projects/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Project not found.");
  });

  it("GET /api/chapters/:id — 404 NOT_FOUND 'Chapter not found.'", async () => {
    const res = await request(t.app).get(`/api/chapters/${ABSENT_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Chapter not found.");
  });

  it("GET /api/images/:id — 404 NOT_FOUND 'Image not found.'", async () => {
    const res = await request(t.app).get(`/api/images/${ABSENT_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Image not found.");
  });

  it("GET /api/snapshots/:id — 404 NOT_FOUND 'Snapshot not found.'", async () => {
    const res = await request(t.app).get(`/api/snapshots/${ABSENT_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Snapshot not found.");
  });

  it("POST /api/chapters/:id/restore — 404 NOT_FOUND 'Deleted chapter not found.'", async () => {
    const res = await request(t.app).post(`/api/chapters/${ABSENT_UUID}/restore`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Deleted chapter not found.");
  });

  it("POST /api/projects — 400 PROJECT_TITLE_EXISTS on duplicate title", async () => {
    await createProject("Duplicate Title Project");
    const res = await request(t.app)
      .post("/api/projects")
      .send({ title: "Duplicate Title Project", mode: "fiction" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROJECT_TITLE_EXISTS");
    expect(res.body.error.message).toBe("A project with that title already exists");
  });
});

describe("no endpoint emits a status outside the allowlist (I4)", () => {
  const t = setupTestDb();

  // The real leak found by the dedup review: express.json() rejects an
  // unsupported charset or Content-Encoding with body-parser's
  // UnsupportedMediaTypeError, whose status 415 flowed straight through the
  // unclamped handler on every body-accepting endpoint.
  it.each([
    ["an unsupported charset", "application/json; charset=iso-8859-1", undefined],
    ["an unsupported Content-Encoding", "application/json", "br"],
  ])("returns 400, not 415, for %s", async (_label, contentType, encoding) => {
    const req = request(t.app)
      .patch(`/api/chapters/${ABSENT_UUID}`)
      .set("Content-Type", contentType);
    if (encoding) req.set("Content-Encoding", encoding);
    const res = await req.send("{}");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
