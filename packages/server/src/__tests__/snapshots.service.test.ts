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

    it("sanitizes and caps the auto-backup label to 500 chars", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { restoreSnapshot, listSnapshots } = await import("../snapshots/snapshots.service");

      // Insert a snapshot directly with an unsanitized/very-long label so we
      // can verify the restore auto-label pipeline scrubs it. CreateSnapshotSchema
      // would reject this on the manual path, but legacy rows or a future
      // writer might produce one.
      const badLabel = "Legacy\u202Espoof\u0000zwsp\u200B" + "x".repeat(520);
      await t.db("chapter_snapshots").insert({
        id: uuid(),
        chapter_id: chapterId,
        label: badLabel,
        content: JSON.stringify({ type: "doc", content: [] }),
        word_count: 0,
        is_auto: 0,
        created_at: new Date().toISOString(),
      });
      const [snap] = await t.db("chapter_snapshots").where({ chapter_id: chapterId });

      // Change content so restore does something
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(DOC_JSON_ALT), word_count: 2 });

      await restoreSnapshot(snap.id);

      const snapshots = await listSnapshots(chapterId);
      const autoSnap = snapshots!.find((s) => s.is_auto && s.label?.startsWith("Before restore"));
      expect(autoSnap).toBeDefined();
      expect(autoSnap!.label).not.toContain("\u202E");
      expect(autoSnap!.label).not.toContain("\u0000");
      expect(autoSnap!.label).not.toContain("\u200B");
      expect(autoSnap!.label!.length).toBeLessThanOrEqual(500);
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

    it("refuses to restore non-TipTap-doc JSON (parses but is not a doc)", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot } = await import("../snapshots/snapshots.service");

      const snap = (await createSnapshot(chapterId, "Normal")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      // Replace snapshot content with valid JSON that is NOT a TipTap doc.
      // Each of these would JSON.parse cleanly but render as nothing in TipTap.
      // The last entry is a doc whose content array contains a non-object —
      // previously the ad-hoc Array.isArray check would accept it; now the
      // TipTapDocSchema-backed check rejects it.
      const invalidShapes = [
        '{"foo":1}',
        "[]",
        "42",
        '{"type":"doc"}',
        '{"type":"doc","content":[42]}',
      ];
      const intactContent = JSON.stringify(DOC_JSON_ALT);

      for (const shape of invalidShapes) {
        await t.db("chapter_snapshots").where({ id: snap.id }).update({ content: shape });
        await t
          .db("chapters")
          .where({ id: chapterId })
          .update({ content: intactContent, word_count: 2 });

        const result = await restoreSnapshot(snap.id);
        expect(result).toBe("corrupt_snapshot");

        const chapter = await t.db("chapters").where({ id: chapterId }).first();
        expect(chapter.content).toBe(intactContent);
        expect(chapter.word_count).toBe(2);
      }
    });

    it("refuses to restore when snapshot content references an image from another project", async () => {
      stubVelocity();
      const { chapterId, projectId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot } = await import("../snapshots/snapshots.service");

      // Create an image belonging to a DIFFERENT project
      const otherProjectId = uuid();
      const otherImageId = uuid();
      const now = new Date().toISOString();
      await t.db("projects").insert({
        id: otherProjectId,
        title: "Other Project",
        slug: `other-${otherProjectId.slice(0, 8)}`,
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      await t.db("images").insert({
        id: otherImageId,
        project_id: otherProjectId,
        filename: "x.png",
        mime_type: "image/png",
        size_bytes: 1,
        reference_count: 1,
        created_at: now,
      });

      // Create a snapshot on OUR chapter with content that references the
      // other project's image id.
      const snap = (await createSnapshot(chapterId, "has-foreign-img")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;
      const crossProjectContent = JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: `/api/images/${otherImageId}` } }],
      });
      await t
        .db("chapter_snapshots")
        .where({ id: snap.id })
        .update({ content: crossProjectContent });

      // Pre-restore chapter content — must remain intact after the rejection
      const intact = JSON.stringify(DOC_JSON_ALT);
      await t.db("chapters").where({ id: chapterId }).update({ content: intact, word_count: 2 });

      const result = await restoreSnapshot(snap.id);
      expect(result).toBe("corrupt_snapshot");

      const chapter = await t.db("chapters").where({ id: chapterId }).first();
      expect(chapter.content).toBe(intact);
      // Foreign image's ref_count must not have been touched
      const otherImage = await t.db("images").where({ id: otherImageId }).first();
      expect(otherImage.reference_count).toBe(1);
      // Sanity: our project isn't used here, just prove ids differ
      expect(projectId).not.toBe(otherProjectId);
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

    it("succeeds even when velocity recordSave throws (best-effort)", async () => {
      const { logger } = await import("../logger");
      const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      setVelocityService({
        recordSave: async () => {
          throw new Error("velocity broken");
        },
        updateDailySnapshot: async () => {
          throw new Error("velocity broken");
        },
      });

      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot } = await import("../snapshots/snapshots.service");
      const snap = (await createSnapshot(chapterId, "pre-velocity-fail")) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(DOC_JSON_ALT), word_count: 2 });

      const result = await restoreSnapshot(snap.id);
      expect(result).not.toBeNull();
      expect(result).not.toBe("corrupt_snapshot");
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: expect.any(String) }),
        "Velocity recordSave failed after restore (best-effort)",
      );
      logSpy.mockRestore();
    });

    it("auto-restore snapshot label never splits a surrogate pair for emoji-heavy labels", async () => {
      stubVelocity();
      const { chapterId } = await createProjectAndChapter();
      const { createSnapshot, restoreSnapshot } = await import("../snapshots/snapshots.service");

      // 500 complex emoji ≈ 1000+ UTF-16 code units; a naive .slice(0,500) on
      // the sanitized label would land inside a surrogate pair.
      const emojiLabel = "👨‍👩‍👧‍👦".repeat(200);
      const snap = (await createSnapshot(chapterId, emojiLabel)) as Exclude<
        Awaited<ReturnType<typeof createSnapshot>>,
        null | "duplicate"
      >;

      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(DOC_JSON_ALT), word_count: 2 });

      const result = await restoreSnapshot(snap.id);
      expect(result).not.toBeNull();
      expect(result).not.toBe("corrupt_snapshot");

      // Find the auto-pre-restore snapshot and assert its label is UTF-16-safe
      const autos = (await t
        .db("chapter_snapshots")
        .where({ chapter_id: chapterId, is_auto: true })
        .orderBy("created_at", "desc")
        .select("label")) as Array<{ label: string | null }>;
      expect(autos.length).toBeGreaterThan(0);
      const label = autos[0].label ?? "";
      // No lone surrogate: every high surrogate must be followed by a low
      // surrogate, and vice versa.
      for (let i = 0; i < label.length; i++) {
        const code = label.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = label.charCodeAt(i + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
          i++;
        } else {
          expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
        }
      }
      // Grapheme-safe clamp should not exceed the 500-grapheme budget, and in
      // code units should be ≤ 500 × 4 (rough upper bound for ZWJ sequences).
      expect(label.length).toBeLessThanOrEqual(500 * 4);
    });
  });
});
