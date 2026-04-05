import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import { getAll, update } from "../settings/settings.service";

setupTestDb();

describe("settings.service", () => {
  describe("getAll()", () => {
    it("returns empty object initially", async () => {
      const result = await getAll();
      expect(result).toEqual({});
    });
  });

  describe("update()", () => {
    it("saves valid settings", async () => {
      const result = await update([{ key: "timezone", value: "America/New_York" }]);
      expect(result).toBeNull();

      const all = await getAll();
      expect(all.timezone).toBe("America/New_York");
    });

    it("rejects unknown setting key", async () => {
      const result = await update([{ key: "unknown_key", value: "anything" }]);
      expect(result).not.toBeNull();
      expect(result!.errors).toHaveProperty("unknown_key");
      expect(result!.errors.unknown_key).toContain("Unknown setting");
    });

    it("rejects invalid timezone value", async () => {
      const result = await update([{ key: "timezone", value: "Not/A/Timezone" }]);
      expect(result).not.toBeNull();
      expect(result!.errors).toHaveProperty("timezone");
      expect(result!.errors.timezone).toContain("Invalid value");
    });
  });
});
