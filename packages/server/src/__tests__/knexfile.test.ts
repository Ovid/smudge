import { describe, it, expect } from "vitest";
import { createKnexConfig, createTestKnexConfig } from "../db/knexfile";

describe("knexfile", () => {
  describe("createKnexConfig", () => {
    it("returns config with better-sqlite3 client", () => {
      const config = createKnexConfig();
      expect(config.client).toBe("better-sqlite3");
    });

    it("uses default db path when none provided", () => {
      const config = createKnexConfig();
      const conn = config.connection as { filename: string };
      expect(conn.filename).toContain("smudge.db");
    });

    it("uses custom db path when provided", () => {
      const config = createKnexConfig("/tmp/test.db");
      const conn = config.connection as { filename: string };
      expect(conn.filename).toBe("/tmp/test.db");
    });

    it("sets useNullAsDefault", () => {
      const config = createKnexConfig();
      expect(config.useNullAsDefault).toBe(true);
    });

    it("configures migrations to load .js files", () => {
      const config = createKnexConfig();
      expect(config.migrations?.loadExtensions).toEqual([".js"]);
    });
  });

  describe("createTestKnexConfig", () => {
    it("uses in-memory SQLite", () => {
      const config = createTestKnexConfig();
      const conn = config.connection as { filename: string };
      expect(conn.filename).toBe(":memory:");
    });

    it("uses better-sqlite3 client", () => {
      const config = createTestKnexConfig();
      expect(config.client).toBe("better-sqlite3");
    });
  });
});
