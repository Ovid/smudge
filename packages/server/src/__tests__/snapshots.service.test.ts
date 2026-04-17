import { describe, it, expect, afterEach, vi } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import { setVelocityService, resetVelocityService } from "../velocity/velocity.injectable";

const t = setupTestDb();

afterEach(() => {
  resetVelocityService();
  vi.restoreAllMocks();
});

// Stub velocity so best-effort calls don't blow up
function stubVelocity() {
  setVelocityService({
    recordSave: async () => {},
    updateDailySnapshot: async () => {},
  });
}

const DOC_JSON = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
};

const DOC_JSON_ALT = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "goodbye world" }] }],
};

const EMPTY_DOC = { type: "doc", content: [] };

async function createProjectAndChapter(
  overrides: { content?: string; deleted_at?: string | null } = {},
) {
  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: `Test Project ${projectId.slice(0, 8)}`,
    slug: `test-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title: "Test Chapter",
    content: overrides.content ?? JSON.stringify(DOC_JSON),
    sort_order: 0,
    word_count: 2,
    status: "outline",
    created_at: now,
    updated_at: now,
    deleted_at: overrides.deleted_at ?? null,
  });
  return { projectId, chapterId };
}

describe("snapshots.service", () => {
  describe("createSnapshot()", () => {
    it("creates a manual snapshot from current chapter content", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot } = await import("../snapshots/snapshots.service");

      const result = await createSnapshot(chapterId, "My Snapshot");

      expect(result).not.toBeNull();
      expect(result).not.toBe("duplicate");
      const snap = result as Exclude<typeof result, null | "duplicate">;
      expect(snap.chapter_id).toBe(chapterId);
      expect(snap.label).toBe("My Snapshot");
      expect(snap.content).toBe(JSON.stringify(DOC_JSON));
      expect(snap.word_count).toBe(2);
      expect(snap.is_auto).toBe(false);
      expect(snap.id).toBeDefined();
      expect(snap.created_at).toBeDefined();
    });

    it("returns null if chapter not found", async () => {
      const { createSnapshot } = await import("../snapshots/snapshots.service");
      const result = await createSnapshot(uuid(), "My Snapshot");
      expect(result).toBeNull();
    });

    it("returns null if chapter is soft-deleted", async () => {
      const { chapterId } = await createProjectAndChapter({
        deleted_at: new Date().toISOString(),
      });
      const { createSnapshot } = await import("../snapshots/snapshots.service");

      const result = await createSnapshot(chapterId, "My Snapshot");
      expect(result).toBeNull();
    });

    it("returns 'duplicate' if content hash matches latest snapshot (manual)", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot } = await import("../snapshots/snapshots.service");

      // First snapshot succeeds
      const first = await createSnapshot(chapterId, "First");
      expect(first).not.toBeNull();
      expect(first).not.toBe("duplicate");

      // Second snapshot with same content returns "duplicate"
      const second = await createSnapshot(chapterId, "Second");
      expect(second).toBe("duplicate");
    });

    it("creates auto-snapshot even if content matches latest (no dedup for auto)", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot } = await import("../snapshots/snapshots.service");

      // First manual snapshot
      const first = await createSnapshot(chapterId, "First");
      expect(first).not.toBeNull();
      expect(first).not.toBe("duplicate");

      // Auto snapshot with same content should still create
      const auto = await createSnapshot(chapterId, null, true);
      expect(auto).not.toBeNull();
      expect(auto).not.toBe("duplicate");
      const snap = auto as Exclude<typeof auto, null | "duplicate">;
      expect(snap.is_auto).toBe(true);
      expect(snap.chapter_id).toBe(chapterId);
    });

    it("trims whitespace from label", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot } = await import("../snapshots/snapshots.service");

      const result = await createSnapshot(chapterId, "  Padded Label  ");
      const snap = result as Exclude<typeof result, null | "duplicate">;
      expect(snap.label).toBe("Padded Label");
    });

    it("stores null label when empty string provided", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot } = await import("../snapshots/snapshots.service");

      const result = await createSnapshot(chapterId, "");
      const snap = result as Exclude<typeof result, null | "duplicate">;
      expect(snap.label).toBeNull();
    });
  });

  describe("listSnapshots()", () => {
    it("returns list for chapter, newest first, no content", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, listSnapshots } = await import("../snapshots/snapshots.service");

      // Create two snapshots with different content so dedup doesn't kick in
      await createSnapshot(chapterId, "First");
      // Change the chapter content so the second snapshot isn't a duplicate
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(DOC_JSON_ALT) });
      await createSnapshot(chapterId, "Second");

      const result = await listSnapshots(chapterId);
      expect(result).not.toBeNull();
      const list = result as NonNullable<typeof result>;
      expect(list).toHaveLength(2);
      // Newest first
      expect(list[0]!.label).toBe("Second");
      expect(list[1]!.label).toBe("First");
      // No content field
      expect("content" in list[0]!).toBe(false);
    });

    it("returns null if chapter not found", async () => {
      const { listSnapshots } = await import("../snapshots/snapshots.service");
      const result = await listSnapshots(uuid());
      expect(result).toBeNull();
    });
  });

  describe("getSnapshot()", () => {
    it("returns full snapshot with content", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, getSnapshot } = await import("../snapshots/snapshots.service");

      const created = (await createSnapshot(chapterId, "Test")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      const result = await getSnapshot(created.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.content).toBe(JSON.stringify(DOC_JSON));
      expect(result!.label).toBe("Test");
    });

    it("returns null if not found", async () => {
      const { getSnapshot } = await import("../snapshots/snapshots.service");
      const result = await getSnapshot(uuid());
      expect(result).toBeNull();
    });
  });

  describe("deleteSnapshot()", () => {
    it("returns true on success", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, deleteSnapshot } = await import("../snapshots/snapshots.service");

      const created = (await createSnapshot(chapterId, "To Delete")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      const result = await deleteSnapshot(created.id);
      expect(result).toBe(true);
    });

    it("returns false if not found", async () => {
      const { deleteSnapshot } = await import("../snapshots/snapshots.service");
      const result = await deleteSnapshot(uuid());
      expect(result).toBe(false);
    });
  });

  describe("restoreSnapshot()", () => {
    it("replaces chapter content, creates auto backup snapshot, recalculates word count", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot, listSnapshots } =
        await import("../snapshots/snapshots.service");

      // Create a snapshot of the original content
      const snap = (await createSnapshot(chapterId, "Original")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      // Change chapter content
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({
          content: JSON.stringify(DOC_JSON_ALT),
          word_count: 2,
        });

      // Restore
      const result = await restoreSnapshot(snap.id);
      if (result === null || result === "corrupt_snapshot") {
        throw new Error("expected restoreSnapshot to succeed");
      }
      expect(result.chapter).toBeDefined();

      // Verify chapter content was restored
      const chapter = await t.db("chapters").where({ id: chapterId }).first();
      expect(chapter.content).toBe(JSON.stringify(DOC_JSON));

      // Verify an auto "before restore" snapshot was created
      const snapshots = await listSnapshots(chapterId);
      expect(snapshots).not.toBeNull();
      const autoSnap = snapshots!.find((s) => s.is_auto && s.label?.startsWith("Before restore"));
      expect(autoSnap).toBeDefined();
    });

    it("adjusts image reference counts when restoring", async () => {
      stubVelocity();
      const imageId = uuid();
      const { chapterId, projectId } = await createProjectAndChapter({
        content: JSON.stringify(EMPTY_DOC),
      });

      // Insert an image record
      await t.db("images").insert({
        id: imageId,
        project_id: projectId,
        filename: "test.png",
        mime_type: "image/png",
        size_bytes: 100,
        reference_count: 0,
        created_at: new Date().toISOString(),
      });

      const { createSnapshot, restoreSnapshot } = await import("../snapshots/snapshots.service");

      // Snapshot current (empty) content
      const snap = (await createSnapshot(chapterId, "Empty")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      // Update chapter to have an image reference
      const contentWithImage = {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: `/api/images/${imageId}` },
          },
        ],
      };
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(contentWithImage) });
      await t.db("images").where({ id: imageId }).update({ reference_count: 1 });

      // Restore to empty doc — should decrement image ref count
      await restoreSnapshot(snap.id);

      const image = await t.db("images").where({ id: imageId }).first();
      expect(image.reference_count).toBe(0);
    });

    it("returns null if snapshot not found", async () => {
      const { restoreSnapshot } = await import("../snapshots/snapshots.service");
      const result = await restoreSnapshot(uuid());
      expect(result).toBeNull();
    });

    it("uses snapshot label in auto-backup label when present", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot, listSnapshots } =
        await import("../snapshots/snapshots.service");

      // Create a snapshot WITH a label
      const snap = (await createSnapshot(chapterId, "My Named Snapshot")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      // Change content so restore does something
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(DOC_JSON_ALT), word_count: 2 });

      await restoreSnapshot(snap.id);

      // Check the auto-backup snapshot label includes the named label
      const snapshots = await listSnapshots(chapterId);
      const autoSnap = snapshots!.find((s) => s.is_auto && s.label?.includes("My Named Snapshot"));
      expect(autoSnap).toBeDefined();
      expect(autoSnap!.label).toBe("Before restore to 'My Named Snapshot'");
    });

    it("uses snapshot created_at in auto-backup label when no label is set", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot, listSnapshots } =
        await import("../snapshots/snapshots.service");

      // Create a snapshot WITHOUT a label
      const snap = (await createSnapshot(chapterId, null)) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      // Change content so restore does something
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(DOC_JSON_ALT), word_count: 2 });

      await restoreSnapshot(snap.id);

      const snapshots = await listSnapshots(chapterId);
      const autoSnap = snapshots!.find(
        (s) => s.is_auto && s.label?.startsWith("Before restore to snapshot from"),
      );
      expect(autoSnap).toBeDefined();
    });

    it("refuses to restore a corrupt snapshot and leaves chapter untouched", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot } = await import("../snapshots/snapshots.service");

      // Create a normal snapshot first
      const snap = (await createSnapshot(chapterId, "Normal")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      // Corrupt the snapshot's content directly in the DB
      await t
        .db("chapter_snapshots")
        .where({ id: snap.id })
        .update({ content: "{corrupt json!!!" });

      // Change chapter content; restore must leave this untouched
      const intactContent = JSON.stringify(DOC_JSON_ALT);
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: intactContent, word_count: 2 });

      const result = await restoreSnapshot(snap.id);
      expect(result).toBe("corrupt_snapshot");

      // The chapter content must be unchanged from before the failed restore
      const chapter = await t.db("chapters").where({ id: chapterId }).first();
      expect(chapter.content).toBe(intactContent);
      expect(chapter.word_count).toBe(2);
    });

    it("returns null if chapter not found (snapshot's chapter was purged)", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot } = await import("../snapshots/snapshots.service");

      const snap = (await createSnapshot(chapterId, "Test")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      // Hard-delete the chapter (simulate purge)
      await t.db.raw("PRAGMA foreign_keys = OFF");
      await t.db("chapter_snapshots").where({ chapter_id: chapterId }).del();
      await t.db("chapters").where({ id: chapterId }).del();
      await t.db.raw("PRAGMA foreign_keys = ON");

      // Re-insert snapshot so findSnapshotById finds it (FK off because chapter is gone)
      await t.db.raw("PRAGMA foreign_keys = OFF");
      await t.db("chapter_snapshots").insert({
        id: snap.id,
        chapter_id: chapterId,
        label: "Test",
        content: JSON.stringify(DOC_JSON),
        word_count: 2,
        is_auto: 0,
        created_at: new Date().toISOString(),
      });
      await t.db.raw("PRAGMA foreign_keys = ON");

      const result = await restoreSnapshot(snap.id);
      expect(result).toBeNull();
    });
  });
});
