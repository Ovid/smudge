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
    // F-9: success is 204 No Content with an empty body (client owns the toast).
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe("");

    const row = await t.db("settings").where({ key: "timezone" }).first();
    expect(row.value).toBe("America/New_York");
  });

  it("updates existing settings", async () => {
    await t.db("settings").insert({ key: "timezone", value: "UTC" });
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "timezone", value: "Europe/London" }] });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

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

  // Review 67c00204 OOSS1. `SETTING_VALIDATORS[key]` walked Object.prototype,
  // so a builtin method name resolved to an inherited function instead of
  // falling through to "Unknown setting". Two arms, both wrong: `toString`
  // and `constructor` returned a truthy validator whose call result was also
  // truthy, so a junk row COMMITTED with 204 (and there is no DELETE endpoint
  // to remove it); `hasOwnProperty`, `valueOf` and friends threw a TypeError
  // inside the handler, which globalErrorHandler clamps to 500 — a server
  // error for a well-formed client body the endpoint intends to reject.
  //
  // `__proto__` is the third arm and only appears once the lookup is fixed:
  // it becomes an unknown key, and `errors["__proto__"] = …` on a plain
  // object literal is a silent no-op, so the error vanishes and the request
  // falls through to the upsert. The errors bag is null-prototype for that.
  it.each(["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf"])(
    "rejects %s as an unknown setting key rather than committing it or 500ing",
    async (key) => {
      const res = await request(t.app)
        .patch("/api/settings")
        .send({ settings: [{ key, value: "UTC" }] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toContain("Unknown setting");

      const rows = await t.db("settings").select("key");
      expect(rows).toEqual([]);
    },
  );

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
