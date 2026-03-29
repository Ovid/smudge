import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import { resolveUniqueSlug } from "../routes/resolve-slug";

const t = setupTestDb();

describe("resolveUniqueSlug", () => {
  it("returns the base slug when no collision", async () => {
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel");
  });

  it("appends -2 on first collision", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel-2");
  });

  it("appends -3 when -2 is also taken", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    await t.db("projects").insert({
      id: "p2",
      title: "My Novel 2",
      slug: "my-novel-2",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel-3");
  });

  it("ignores soft-deleted projects for collision", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
      deleted_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel");
    expect(slug).toBe("my-novel");
  });

  it("excludes a specific project id when provided", async () => {
    const now = new Date().toISOString();
    await t.db("projects").insert({
      id: "p1",
      title: "My Novel",
      slug: "my-novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    const slug = await resolveUniqueSlug(t.db, "my-novel", "p1");
    expect(slug).toBe("my-novel");
  });

  it("throws when all 100 suffixes are exhausted", async () => {
    const now = new Date().toISOString();

    // Insert 100 projects: "my-novel", "my-novel-2", ..., "my-novel-100"
    for (let i = 1; i <= 100; i++) {
      const slug = i === 1 ? "my-novel" : `my-novel-${i}`;
      await t.db("projects").insert({
        id: `p${i}`,
        title: `My Novel ${i}`,
        slug,
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
    }

    await expect(resolveUniqueSlug(t.db, "my-novel")).rejects.toThrow(
      'Cannot generate unique slug for "my-novel" after 100 attempts',
    );
  });
});
