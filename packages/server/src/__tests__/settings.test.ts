import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("GET /api/settings", () => {
  it("returns empty object when no settings exist", async () => {
    const res = await request(t.app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("returns all settings as key-value pairs", async () => {
    await t.db("settings").insert({ key: "timezone", value: "America/New_York" });
    const res = await request(t.app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ timezone: "America/New_York" });
  });
});

describe("PATCH /api/settings", () => {
  it("creates new settings", async () => {
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "timezone", value: "America/New_York" }] });
    expect(res.status).toBe(200);

    const row = await t.db("settings").where({ key: "timezone" }).first();
    expect(row.value).toBe("America/New_York");
  });

  it("updates existing settings", async () => {
    await t.db("settings").insert({ key: "timezone", value: "UTC" });
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "timezone", value: "Europe/London" }] });
    expect(res.status).toBe(200);

    const row = await t.db("settings").where({ key: "timezone" }).first();
    expect(row.value).toBe("Europe/London");
  });

  it("validates timezone values", async () => {
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "timezone", value: "Not/A/Timezone" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid body structure", async () => {
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "", value: "foo" }] });
    expect(res.status).toBe(400);
  });

  it("applies no changes if any setting is invalid (atomic)", async () => {
    await t.db("settings").insert({ key: "timezone", value: "UTC" });
    const res = await request(t.app)
      .patch("/api/settings")
      .send({
        settings: [
          { key: "timezone", value: "America/Chicago" },
          { key: "timezone", value: "Bad/Zone" },
        ],
      });
    expect(res.status).toBe(400);

    const row = await t.db("settings").where({ key: "timezone" }).first();
    expect(row.value).toBe("UTC");
  });
});
