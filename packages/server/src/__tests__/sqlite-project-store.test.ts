import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { setupTestDb } from "./test-helpers";
import { SqliteProjectStore } from "../stores/sqlite-project-store";
import type { CreateProjectRow } from "../projects/projects.types";
import type { CreateChapterRow } from "../chapters/chapters.types";

function makeProject(overrides: Partial<CreateProjectRow> = {}): CreateProjectRow {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: `Project ${randomUUID().slice(0, 8)}`,
    slug: `project-${randomUUID().slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeChapter(
  projectId: string,
  overrides: Partial<CreateChapterRow> = {},
): CreateChapterRow {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    project_id: projectId,
    title: `Chapter ${randomUUID().slice(0, 8)}`,
    content: JSON.stringify({ type: "doc", content: [] }),
    sort_order: 0,
    word_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("SqliteProjectStore", () => {
  const ctx = setupTestDb();

  function createStore() {
    return new SqliteProjectStore(ctx.db);
  }

  // --- Project delegation ---

  describe("project delegation", () => {
    it("insert + findProjectById round-trip", async () => {
      const store = createStore();
      const data = makeProject();
      const inserted = await store.insertProject(data);
      expect(inserted.id).toBe(data.id);
      expect(inserted.title).toBe(data.title);

      const found = await store.findProjectById(data.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(data.id);
    });

    it("findProjectById returns null for missing id", async () => {
      const store = createStore();
      const found = await store.findProjectById(randomUUID());
      expect(found).toBeNull();
    });

    it("listProjects returns inserted projects", async () => {
      const store = createStore();
      const p1 = makeProject();
      const p2 = makeProject();
      await store.insertProject(p1);
      await store.insertProject(p2);

      const list = await store.listProjects();
      expect(list.length).toBe(2);
      const ids = list.map((p) => p.id);
      expect(ids).toContain(p1.id);
      expect(ids).toContain(p2.id);
    });

    it("softDeleteProject hides from findProjectById", async () => {
      const store = createStore();
      const data = makeProject();
      await store.insertProject(data);
      await store.softDeleteProject(data.id, new Date().toISOString());

      const found = await store.findProjectById(data.id);
      expect(found).toBeNull();
    });

    it("findProjectByIdIncludingDeleted returns soft-deleted projects", async () => {
      const store = createStore();
      const data = makeProject();
      await store.insertProject(data);
      await store.softDeleteProject(data.id, new Date().toISOString());

      const found = await store.findProjectByIdIncludingDeleted(data.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(data.id);
      expect(found!.deleted_at).not.toBeNull();
    });

    it("resolveUniqueSlug returns base slug when available", async () => {
      const store = createStore();
      const slug = await store.resolveUniqueSlug("fresh-slug");
      expect(slug).toBe("fresh-slug");
    });

    it("resolveUniqueSlug appends suffix when base slug is taken", async () => {
      const store = createStore();
      await store.insertProject(makeProject({ slug: "taken-slug" }));
      const slug = await store.resolveUniqueSlug("taken-slug");
      expect(slug).toBe("taken-slug-2");
    });

    it("findProjectBySlug delegates correctly", async () => {
      const store = createStore();
      const data = makeProject();
      await store.insertProject(data);

      const found = await store.findProjectBySlug(data.slug);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(data.id);
    });

    it("findProjectByTitle delegates correctly", async () => {
      const store = createStore();
      const data = makeProject();
      await store.insertProject(data);

      const found = await store.findProjectByTitle(data.title);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(data.id);
    });

    it("updateProject delegates correctly", async () => {
      const store = createStore();
      const data = makeProject();
      await store.insertProject(data);

      const updated = await store.updateProject(data.id, {
        title: "New Title",
        updated_at: new Date().toISOString(),
      });
      expect(updated.title).toBe("New Title");
    });

    it("updateProjectTimestamp delegates correctly", async () => {
      const store = createStore();
      const data = makeProject();
      await store.insertProject(data);

      const newTimestamp = new Date(Date.now() + 10_000).toISOString();
      await store.updateProjectTimestamp(data.id, newTimestamp);
      const after = (await store.findProjectById(data.id))!.updated_at;
      expect(after).toBe(newTimestamp);
    });
  });

  // --- Chapter delegation ---

  describe("chapter delegation", () => {
    it("insert + findChapterById round-trip", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);

      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);

      const found = await store.findChapterById(ch.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(ch.id);
      expect(found!.title).toBe(ch.title);
    });

    it("listChaptersByProject returns chapters in sort order", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);

      const ch1 = makeChapter(proj.id, { sort_order: 1, title: "First" });
      const ch2 = makeChapter(proj.id, { sort_order: 0, title: "Second" });
      await store.insertChapter(ch1);
      await store.insertChapter(ch2);

      const chapters = await store.listChaptersByProject(proj.id);
      expect(chapters).toHaveLength(2);
      expect(chapters[0]!.title).toBe("Second");
      expect(chapters[1]!.title).toBe("First");
    });

    it("sumChapterWordCountByProject aggregates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);

      await store.insertChapter(makeChapter(proj.id, { word_count: 100 }));
      await store.insertChapter(makeChapter(proj.id, { word_count: 250 }));

      const total = await store.sumChapterWordCountByProject(proj.id);
      expect(total).toBe(350);
    });

    it("getMaxChapterSortOrder returns -1 for empty project", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);

      const max = await store.getMaxChapterSortOrder(proj.id);
      expect(max).toBe(-1);
    });

    it("softDeleteChapter hides from findChapterById", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);

      await store.softDeleteChapter(ch.id, new Date().toISOString());
      const found = await store.findChapterById(ch.id);
      expect(found).toBeNull();
    });

    it("findDeletedChapterById returns soft-deleted chapter", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);

      await store.softDeleteChapter(ch.id, new Date().toISOString());
      const found = await store.findDeletedChapterById(ch.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(ch.id);
    });

    it("restoreChapter makes chapter visible again and returns 1", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id, { sort_order: 0 });
      await store.insertChapter(ch);

      await store.softDeleteChapter(ch.id, new Date().toISOString());
      const restored = await store.restoreChapter(ch.id, 5, new Date().toISOString());

      expect(restored).toBe(1);

      const found = await store.findChapterById(ch.id);
      expect(found).not.toBeNull();
      expect(found!.sort_order).toBe(5);
    });

    it("restoreChapter returns 0 for non-existent chapter", async () => {
      const store = createStore();
      const restored = await store.restoreChapter(randomUUID(), 0, new Date().toISOString());
      expect(restored).toBe(0);
    });

    it("updateChapter delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);

      const rowsUpdated = await store.updateChapter(ch.id, {
        title: "Updated",
        updated_at: new Date().toISOString(),
      });
      expect(rowsUpdated).toBe(1);

      const found = await store.findChapterById(ch.id);
      expect(found!.title).toBe("Updated");
    });

    it("updateChapterSortOrders delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch1 = makeChapter(proj.id, { sort_order: 0 });
      const ch2 = makeChapter(proj.id, { sort_order: 1 });
      await store.insertChapter(ch1);
      await store.insertChapter(ch2);

      await store.updateChapterSortOrders([
        { id: ch1.id, sort_order: 1 },
        { id: ch2.id, sort_order: 0 },
      ]);

      const chapters = await store.listChaptersByProject(proj.id);
      expect(chapters[0]!.id).toBe(ch2.id);
      expect(chapters[1]!.id).toBe(ch1.id);
    });

    it("listChapterMetadataByProject delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id, { word_count: 42 });
      await store.insertChapter(ch);

      const metadata = await store.listChapterMetadataByProject(proj.id);
      expect(metadata).toHaveLength(1);
      expect(metadata[0]!.word_count).toBe(42);
    });

    it("listDeletedChaptersByProject delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);
      await store.softDeleteChapter(ch.id, new Date().toISOString());

      const deleted = await store.listDeletedChaptersByProject(proj.id);
      expect(deleted).toHaveLength(1);
      expect(deleted[0]!.id).toBe(ch.id);
    });

    it("listChapterIdsByProject delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);

      const ids = await store.listChapterIdsByProject(proj.id);
      expect(ids).toContain(ch.id);
    });

    it("listChapterIdTitleStatusByProject delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);

      const items = await store.listChapterIdTitleStatusByProject(proj.id);
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(ch.id);
      expect(items[0]!.title).toBe(ch.title);
    });

    it("softDeleteChaptersByProject delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      await store.insertChapter(makeChapter(proj.id));
      await store.insertChapter(makeChapter(proj.id));

      await store.softDeleteChaptersByProject(proj.id, new Date().toISOString());
      const chapters = await store.listChaptersByProject(proj.id);
      expect(chapters.length).toBe(0);
    });

    it("findChapterByIdRaw delegates correctly", async () => {
      const store = createStore();
      const proj = makeProject();
      await store.insertProject(proj);
      const ch = makeChapter(proj.id);
      await store.insertChapter(ch);

      const raw = await store.findChapterByIdRaw(ch.id);
      expect(raw).not.toBeNull();
      expect(raw!.id).toBe(ch.id);
      // Raw row keeps content as string
      expect(typeof raw!.content).toBe("string");
    });
  });

  // --- Chapter status delegation ---

  describe("chapter status delegation", () => {
    it("listStatuses returns seeded statuses", async () => {
      const store = createStore();
      const statuses = await store.listStatuses();
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses[0]!).toHaveProperty("status");
      expect(statuses[0]!).toHaveProperty("label");
      expect(statuses[0]!).toHaveProperty("sort_order");
    });

    it("findStatusByStatus returns matching status", async () => {
      const store = createStore();
      const statuses = await store.listStatuses();
      const first = statuses[0]!;

      const found = await store.findStatusByStatus(first.status);
      expect(found).toBeDefined();
      expect(found!.status).toBe(first.status);
      expect(found!.label).toBe(first.label);
    });

    it("findStatusByStatus returns undefined for unknown status", async () => {
      const store = createStore();
      const found = await store.findStatusByStatus("nonexistent-status");
      expect(found).toBeUndefined();
    });

    it("getStatusLabel returns label for known status", async () => {
      const store = createStore();
      const statuses = await store.listStatuses();
      const first = statuses[0]!;

      const label = await store.getStatusLabel(first.status);
      expect(label).toBe(first.label);
    });

    it("getStatusLabelMap returns all status-label pairs", async () => {
      const store = createStore();
      const map = await store.getStatusLabelMap();
      expect(typeof map).toBe("object");
      const keys = Object.keys(map);
      expect(keys.length).toBeGreaterThan(0);

      const statuses = await store.listStatuses();
      for (const s of statuses) {
        expect(map[s.status]).toBe(s.label);
      }
    });
  });

  // --- Transaction support ---

  describe("transaction support", () => {
    it("commits on success", async () => {
      const store = createStore();
      const data = makeProject();

      await store.transaction(async (txStore) => {
        await txStore.insertProject(data);
      });

      const found = await store.findProjectById(data.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(data.id);
    });

    it("rolls back on error", async () => {
      const store = createStore();
      const data = makeProject();

      await expect(
        store.transaction(async (txStore) => {
          await txStore.insertProject(data);
          throw new Error("Deliberate rollback");
        }),
      ).rejects.toThrow("Deliberate rollback");

      const found = await store.findProjectById(data.id);
      expect(found).toBeNull();
    });

    it("provides raw trx as second argument", async () => {
      const store = createStore();

      await store.transaction(async (_txStore, trx) => {
        expect(trx).toBeDefined();
        // Can use trx directly for raw queries
        const result = await trx.raw("SELECT 1 as val");
        expect(result[0].val).toBe(1);
      });
    });

    it("throws when calling transaction() on a transaction-scoped store", async () => {
      const store = createStore();

      await store.transaction(async (txStore) => {
        await expect(
          txStore.transaction(async () => {
            // Should never reach here
          }),
        ).rejects.toThrow("Nested transactions are not supported");
      });
    });
  });
});
