import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("GET /api/chapter-statuses", () => {
  it("returns all statuses in sort_order", async () => {
    const res = await request(t.app).get("/api/chapter-statuses");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body[0].status).toBe("outline");
    expect(res.body[0].label).toBe("Outline");
    expect(res.body[0].sort_order).toBe(1);
    expect(res.body[1].status).toBe("rough_draft");
    expect(res.body[2].status).toBe("revised");
    expect(res.body[3].status).toBe("edited");
    expect(res.body[4].status).toBe("final");
  });
});
