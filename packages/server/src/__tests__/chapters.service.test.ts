import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID as uuid } from "node:crypto";
import { setupTestDb } from "./test-helpers";
import { setVelocityService, resetVelocityService } from "../velocity/velocity.injectable";
import { getProjectStore } from "../stores/project-store.injectable";
import { logger } from "../logger";
import {
  updateChapter,
  deleteChapter,
  restoreChapter,
  getChapter,
} from "../chapters/chapters.service";

const t = setupTestDb();

afterEach(() => {
  resetVelocityService();
});

const DOC_JSON = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
};

async function createProjectAndChapter() {
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
    content: JSON.stringify(DOC_JSON),
    sort_order: 0,
    word_count: 1,
    status: "outline",
    created_at: now,
    updated_at: now,
  });
  return { projectId, chapterId };
}

describe("chapters.service", () => {
  describe("updateChapter()", () => {
    it("succeeds even when velocity updateDailySnapshot throws", async () => {
      const { chapterId } = await createProjectAndChapter();
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

      try {
        setVelocityService({
          updateDailySnapshot: async () => {
            throw new Error("velocity broken");
          },
        });

        const result = await updateChapter(chapterId, {
          content: DOC_JSON,
        });

        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result).toHaveProperty("chapter");
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            project_id: expect.any(String),
            chapter_id: chapterId,
          }),
          "Velocity updateDailySnapshot failed after save (best-effort)",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("returns null for a non-existent chapter", async () => {
      const result = await updateChapter(uuid(), { title: "New Title" });
      expect(result).toBeNull();
    });

    it("falls back to status as the label when enrichment fails after a successful save", async () => {
      const { chapterId } = await createProjectAndChapter();
      // The save commits, but the post-save status-label lookup fails. The
      // client must still see a successful save (status used as the label),
      // not a false 500.
      const store = getProjectStore();
      const labelSpy = vi
        .spyOn(store, "getStatusLabel")
        .mockRejectedValue(new Error("status label lookup down"));
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      try {
        const result = await updateChapter(chapterId, { content: DOC_JSON });
        expect(result).toHaveProperty("chapter");
        const chapter = (result as { chapter: { status: string; status_label: string } }).chapter;
        expect(chapter.status_label).toBe(chapter.status);
        // F-31: the degrade is silent otherwise, and this is the hottest
        // endpoint in the app — a persistent lookup failure would downgrade
        // every save's label forever with nothing in the log to say so. The
        // identical degrade after restore (snapshots.service) already logs.
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            err: expect.anything(),
            project_id: expect.any(String),
            chapter_id: chapterId,
          }),
          expect.stringContaining("enrichChapterWithLabel failed"),
        );
      } finally {
        labelSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it("returns validationError for invalid body", async () => {
      const { chapterId } = await createProjectAndChapter();
      const result = await updateChapter(chapterId, { content: "not-valid-json-object" });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("validationError");
    });

    // F-8 safety net: updateChapter reads like a row update but also bumps the
    // PARENT PROJECT's updated_at (a hidden side effect the signature does not
    // disclose). Pin it so any disclosure/refactor of F-8 cannot silently drop
    // the timestamp propagation.
    it("bumps the parent project's updated_at (hidden side effect)", async () => {
      const projectId = uuid();
      const chapterId = uuid();
      const OLD = "2020-01-01T00:00:00.000Z";
      await t.db("projects").insert({
        id: projectId,
        title: `Stale Project ${projectId.slice(0, 8)}`,
        slug: `stale-${projectId.slice(0, 8)}`,
        mode: "fiction",
        created_at: OLD,
        updated_at: OLD,
      });
      await t.db("chapters").insert({
        id: chapterId,
        project_id: projectId,
        title: "Chapter",
        content: JSON.stringify(DOC_JSON),
        sort_order: 0,
        word_count: 1,
        status: "outline",
        created_at: OLD,
        updated_at: OLD,
      });

      const result = await updateChapter(chapterId, { title: "Renamed" });
      expect(result).toHaveProperty("chapter");

      const project = await t.db("projects").where({ id: projectId }).first();
      expect(project.updated_at).not.toBe(OLD);
      expect(project.updated_at > OLD).toBe(true);
    });

    // Safety net for F-03: the content-write obligation bundle is being
    // extracted into a shared helper, and word_count is one of the
    // obligations. It was only covered indirectly (dashboard.test.ts
    // "returns correct totals" asserts the project aggregate), so a helper
    // that dropped the recalculation for the single-chapter update path
    // could still have left that aggregate assertion green. This pins the
    // recalculation on the chapter row itself, at the site that performs it.
    it("recalculates word_count server-side from the saved content", async () => {
      setVelocityService({ updateDailySnapshot: async () => {} });
      const { chapterId } = await createProjectAndChapter();

      const result = await updateChapter(chapterId, {
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "one two three four five" }] },
          ],
        },
      });

      expect(result).toHaveProperty("chapter");
      const { chapter } = result as { chapter: { word_count: number } };
      expect(chapter.word_count).toBe(5);

      const row = await t.db("chapters").where({ id: chapterId }).first();
      expect(row.word_count).toBe(5);
    });
  });

  describe("deleteChapter()", () => {
    it("succeeds even when velocity updateDailySnapshot throws", async () => {
      const { chapterId } = await createProjectAndChapter();
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

      try {
        setVelocityService({
          updateDailySnapshot: async () => {
            throw new Error("velocity broken");
          },
        });

        const result = await deleteChapter(chapterId);
        expect(result).toBe(true);
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            project_id: expect.any(String),
            chapter_id: chapterId,
          }),
          "Velocity updateDailySnapshot failed (best-effort)",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("returns false for a non-existent chapter", async () => {
      const result = await deleteChapter(uuid());
      expect(result).toBe(false);
    });
  });

  describe("restoreChapter()", () => {
    it("succeeds even when velocity updateDailySnapshot throws", async () => {
      const { chapterId } = await createProjectAndChapter();
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

      try {
        // Soft-delete the chapter so we can restore it
        const now = new Date().toISOString();
        await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

        setVelocityService({
          updateDailySnapshot: async () => {
            throw new Error("velocity broken");
          },
        });

        const result = await restoreChapter(chapterId);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect(result).not.toBe("parent_purged");
        expect(result).not.toBe("chapter_purged");
        expect(result).not.toBe("conflict");
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            project_id: expect.any(String),
            chapter_id: chapterId,
          }),
          "Velocity updateDailySnapshot failed (best-effort)",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("returns 'chapter_purged' when chapter is purged mid-transaction", async () => {
      const { chapterId } = await createProjectAndChapter();

      // Soft-delete so findDeletedChapterById will find it
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Hard-delete so the restore UPDATE inside the transaction finds 0 rows
      await t.db("chapters").where({ id: chapterId }).del();

      // Re-insert as soft-deleted so findDeletedChapterById succeeds (outside tx),
      // but then hard-delete before the service calls restore inside the tx.
      // Since SQLite is synchronous and single-threaded, we simulate the race
      // by spying on the store's restoreChapter to return 0.
      const { getProjectStore } = await import("../stores/project-store.injectable");
      const store = getProjectStore();

      // Re-insert for findDeletedChapterById to find
      await t.db("chapters").insert({
        id: chapterId,
        project_id: (await t.db("projects").first()).id,
        title: "Purged Chapter",
        sort_order: 0,
        word_count: 0,
        created_at: now,
        updated_at: now,
        deleted_at: now,
      });

      // Spy on transaction to intercept the txStore's restoreChapter
      const origTransaction = store.transaction.bind(store);
      vi.spyOn(store, "transaction").mockImplementation(async (fn) => {
        return origTransaction(async (txStore) => {
          const origRestore = txStore.restoreChapter.bind(txStore);
          vi.spyOn(txStore, "restoreChapter").mockImplementation(async () => {
            // Simulate: chapter was purged between lookup and restore
            return 0;
          });
          try {
            return await fn(txStore);
          } finally {
            txStore.restoreChapter = origRestore;
          }
        });
      });

      try {
        const result = await restoreChapter(chapterId);
        expect(result).toBe("chapter_purged");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns restored chapter when another request already restored it (double-restore)", async () => {
      const { chapterId } = await createProjectAndChapter();

      // Soft-delete the chapter so findDeletedChapterById will find it
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Simulate: between findDeletedChapterById (outside tx) and restoreChapter (inside tx),
      // another request restored the chapter. We do this by restoring it before our call,
      // but making findDeletedChapterById still find it via a spy.
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: null });

      // Spy on the store so findDeletedChapterById returns the chapter as if still deleted,
      // but the actual restore UPDATE inside the transaction finds 0 rows (deleted_at is NULL).
      const { getProjectStore } = await import("../stores/project-store.injectable");
      const store = getProjectStore();
      vi.spyOn(store, "findDeletedChapterById").mockImplementation(async (id) => {
        // Return the chapter as if it were still deleted (simulating the race window)
        const row = await t.db("chapters").where({ id }).first();
        return row ?? null;
      });

      try {
        const result = await restoreChapter(chapterId);
        // Should NOT return "chapter_purged" — the chapter exists and is active
        expect(result).not.toBe("chapter_purged");
        expect(result).not.toBeNull();
        expect(result).not.toBe("read_failure");
        // Should return the chapter data (successful restore response)
        expect(typeof result).toBe("object");
        expect((result as { id: string }).id).toBe(chapterId);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 'parent_purged' when parent project has been hard-deleted", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();

      // Soft-delete the chapter
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Hard-delete the project (simulating a purge)
      await t.db.raw("PRAGMA foreign_keys = OFF");
      await t.db("projects").where({ id: projectId }).del();
      await t.db.raw("PRAGMA foreign_keys = ON");

      const result = await restoreChapter(chapterId);
      expect(result).toBe("parent_purged");
    });

    it("resolves slug conflict by generating a new slug when restoring a deleted project", async () => {
      const slug = `conflict-slug-${uuid().slice(0, 8)}`;
      const { chapterId, projectId } = await createProjectAndChapter();

      // Give the project a known slug, then soft-delete it and its chapter
      const now = new Date().toISOString();
      await t.db("projects").where({ id: projectId }).update({ slug, title: slug });
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });
      await t.db("projects").where({ id: projectId }).update({ deleted_at: now });

      // Create a new active project that occupies the same slug
      const newProjectId = uuid();
      await t.db("projects").insert({
        id: newProjectId,
        title: `Occupier ${newProjectId.slice(0, 8)}`,
        slug,
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });

      // Restore succeeds — resolveUniqueSlug generates a new slug
      const result = await restoreChapter(chapterId);
      expect(result).not.toBeNull();
      expect(result).not.toBe("conflict");
      expect(result).not.toBe("parent_purged");
      expect(result).not.toBe("chapter_purged");
      expect(typeof result).toBe("object");
      // Restored project gets a different slug
      expect((result as { project_slug: string }).project_slug).toBe(`${slug}-2`);
    });
  });

  describe("restoreChapter() — parent project deleted_at branch", () => {
    it("restores parent project when it is soft-deleted (sets deleted_at null, updates slug)", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();

      // Soft-delete both project and chapter
      const now = new Date().toISOString();
      await t.db("projects").where({ id: projectId }).update({ deleted_at: now });
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const result = await restoreChapter(chapterId);

      expect(result).not.toBeNull();
      expect(result).not.toBe("parent_purged");
      expect(result).not.toBe("chapter_purged");
      expect(typeof result).toBe("object");

      // Verify the project was un-deleted
      const project = await t.db("projects").where({ id: projectId }).first();
      expect(project.deleted_at).toBeNull();
    });
  });

  describe("restoreChapter() — image ref increment on restore", () => {
    it("increments image reference counts for images in restored chapter content", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();
      const imageId = uuid();

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

      // Update chapter content to include an image reference
      const contentWithImage = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hello" }] },
          { type: "image", attrs: { src: `/api/images/${imageId}` } },
        ],
      };
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(contentWithImage) });

      // Soft-delete the chapter
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const result = await restoreChapter(chapterId);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("object");

      // Check that the image reference count was incremented
      const image = await t.db("images").where({ id: imageId }).first();
      expect(image.reference_count).toBe(1);
    });

    it("handles corrupt content gracefully during image ref increment on restore", async () => {
      const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      // applyImageRefDiff logs a warn when it can't parse the corrupt
      // content before aborting the diff. Spy + assert rather than
      // letting it pollute test stderr.
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const { chapterId } = await createProjectAndChapter();

      // Set content to corrupt JSON
      await t.db("chapters").where({ id: chapterId }).update({ content: "{not valid json!!!" });

      // Soft-delete the chapter
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Should not throw — corrupt content catch block handles it
      const result = await restoreChapter(chapterId);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("object");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: expect.any(String) }),
        "applyImageRefDiff: newContent is not a TipTap object; aborting diff to avoid mass decrement",
      );
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  /**
   * restoreChapter's confirming reads and its error routing.
   *
   * These pin behaviour the coverage report showed was unasserted: the
   * positive shape of a successful restore (every existing happy-path test
   * asserted only that the result was NOT one of the error sentinels), the
   * two `read_failure` exits, the defensive slug-collision `conflict` exit,
   * and the rethrow of anything else.
   *
   * The two read_failure cases deliberately do not care WHICH object the
   * confirming read is made on — see the comment on those tests. The
   * membership test added below is the one that does, and it is the only case
   * here that fails if F-28's fix is reverted.
   */
  describe("restoreChapter() — confirming reads and error routing", () => {
    it("returns the restored chapter enriched with status_label, project_slug, and a sort_order above the surviving chapters", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();
      const now = new Date().toISOString();

      // A surviving sibling at sort_order 7, so a restore that skipped
      // getMaxChapterSortOrder would land the chapter at 0 or 1, not 8.
      await t.db("chapters").insert({
        id: uuid(),
        project_id: projectId,
        title: "Surviving Chapter",
        content: JSON.stringify(DOC_JSON),
        sort_order: 7,
        word_count: 1,
        status: "outline",
        created_at: now,
        updated_at: now,
      });
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const result = await restoreChapter(chapterId);

      expect(result).toMatchObject({
        id: chapterId,
        project_id: projectId,
        status: "outline",
        status_label: "Outline",
        sort_order: 8,
        project_slug: `test-${projectId.slice(0, 8)}`,
      });

      const row = await t.db("chapters").where({ id: chapterId }).first();
      expect(row.deleted_at).toBeNull();
    });

    // F-28 membership (finding I2 of
    // `paad/code-reviews/ovid-architecture-2026-08-20-18-52-04-09aaba1e.md`).
    // This is the tripwire the F-28 fix shipped without: every other case in
    // this block passes whether the confirming reads run inside the transaction
    // or after it, so reverting `confirmRestore(txStore, ...)` to the old
    // post-commit pair on the outer store left all 22 cases green. Asserting
    // the reads never touch the outer store is the only thing that tells the
    // two implementations apart.
    //
    // This reverses a decision recorded in F-28's Status block, which rejected
    // such a test as "pinning implementation rather than behaviour". The
    // counter-argument, accepted 2026-08-21: WHICH object holds the read is the
    // whole deliverable here. The invariant has no in-process symptom today
    // (better-sqlite3 is synchronous, Smudge is single-writer), so there is no
    // behaviour left for a test to observe — and roadmap Phase 7g.2 deletes the
    // guard that keeps it symptomless, at which point a silent regression
    // becomes a wrong-response bug rather than a test failure.
    //
    // The not-called assertions are the load-bearing half, matching the F-29
    // membership tests in `snapshots.service.test.ts`: `transaction` hands the
    // callback a distinct store built over the `trx` handle, so an outer-store
    // call is observable — and it is precisely the starvation trap, since a
    // non-scoped `store.*` call from inside a transaction queues on the `max: 1`
    // pool the caller is already holding.
    it("makes both confirming reads through the transaction-scoped store, never the outer one", async () => {
      const { chapterId } = await createProjectAndChapter();
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ deleted_at: new Date().toISOString() });

      // The post-commit velocity snapshot opens a transaction of its own, so
      // it is stubbed out to leave exactly one for the count below to mean
      // something. `afterEach` calls `resetVelocityService()`.
      setVelocityService({ updateDailySnapshot: async () => {} });

      const store = getProjectStore();
      const txSpy = vi.spyOn(store, "transaction");
      const outerChapterRead = vi.spyOn(store, "findChapterById");
      const outerProjectRead = vi.spyOn(store, "findProjectByIdIncludingDeleted");

      try {
        expect(await restoreChapter(chapterId)).toMatchObject({ id: chapterId });

        expect(txSpy).toHaveBeenCalledTimes(1);
        expect(outerChapterRead).not.toHaveBeenCalled();
        expect(outerProjectRead).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 'read_failure' and leaves the chapter restored when the confirming chapter read misses", async () => {
      const { chapterId } = await createProjectAndChapter();
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const store = getProjectStore();
      const origTransaction = store.transaction.bind(store);
      // The confirming read is stubbed on BOTH the outer store and the
      // transaction-scoped one, so this test asserts the behaviour rather
      // than the location of the call: it stays valid whether the read runs
      // after the commit or inside the transaction.
      vi.spyOn(store, "findChapterById").mockResolvedValue(null);
      vi.spyOn(store, "transaction").mockImplementation(async (fn) =>
        origTransaction(async (txStore) => {
          vi.spyOn(txStore, "findChapterById").mockResolvedValue(null);
          return fn(txStore);
        }),
      );

      try {
        const result = await restoreChapter(chapterId);
        expect(result).toBe("read_failure");

        // A missed confirming read must not roll the restore back. The client
        // maps read_failure through `committedCodes` to "this may have saved",
        // which is only true if the row really is restored.
        const row = await t.db("chapters").where({ id: chapterId }).first();
        expect(row.deleted_at).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 'read_failure' when the parent project cannot be re-read after the restore", async () => {
      const { chapterId } = await createProjectAndChapter();
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const store = getProjectStore();
      const origTransaction = store.transaction.bind(store);
      // The project is read TWICE: once at the top of the transaction as the
      // parent-liveness check, once again to confirm the response. Only the
      // second may miss — nulling the first throws ParentPurgedError and the
      // test would assert the wrong branch. So the stub passes the first call
      // through to the real store and misses every call after it.
      //
      // The outer store is stubbed too, so this stays a statement about the
      // behaviour rather than about which object holds the confirming read.
      vi.spyOn(store, "findProjectByIdIncludingDeleted").mockResolvedValue(null);
      vi.spyOn(store, "transaction").mockImplementation(async (fn) =>
        origTransaction(async (txStore) => {
          const orig = txStore.findProjectByIdIncludingDeleted.bind(txStore);
          let call = 0;
          vi.spyOn(txStore, "findProjectByIdIncludingDeleted").mockImplementation(async (pid) =>
            call++ === 0 ? orig(pid) : null,
          );
          return fn(txStore);
        }),
      );

      try {
        expect(await restoreChapter(chapterId)).toBe("read_failure");
      } finally {
        vi.restoreAllMocks();
      }
    });

    // OOSI1 (2026-08-21 review, backlog 767fdc1e). enrichChapterWithLabel runs
    // AFTER the transaction commits, and at this site it was unguarded while
    // both siblings (updateChapter here, restoreSnapshot in snapshots.service)
    // wrapped the identical call and degraded to status-as-label. A DB throw
    // after commit — SQLITE_BUSY, a {max:1} pool acquire timeout, an I/O error —
    // therefore turned a COMMITTED restore into a generic 500 INTERNAL_ERROR,
    // which trash.restoreChapter's scope does not list in committedCodes. The
    // writer was told a committed restore failed, and the retry then 404s
    // because findDeletedChapterById no longer matches the now-active row.
    //
    // The guard now lives inside enrichChapterWithLabel itself, so this pins
    // the shared behaviour from the site that had none.
    it("degrades to status-as-label rather than failing a committed restore when the status lookup throws", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ deleted_at: new Date().toISOString() });

      const store = getProjectStore();
      const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      vi.spyOn(store, "getStatusLabel").mockRejectedValue(new Error("SQLITE_BUSY"));

      try {
        const result = await restoreChapter(chapterId);

        // The restore is reported as the success it is, with the raw status
        // standing in for the label rather than a 500.
        expect(result).toMatchObject({
          id: chapterId,
          status: "outline",
          status_label: "outline",
          project_slug: `test-${projectId.slice(0, 8)}`,
        });

        // Degraded, not swallowed.
        expect(logSpy).toHaveBeenCalledWith(
          expect.objectContaining({ chapter_id: chapterId, project_id: projectId }),
          expect.stringContaining("status as label"),
        );

        const row = await t.db("chapters").where({ id: chapterId }).first();
        expect(row.deleted_at).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 'conflict' when restoring the parent project collides with an active slug", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();
      const now = new Date().toISOString();
      const occupied = `occupied-${uuid().slice(0, 8)}`;

      await t.db("projects").insert({
        id: uuid(),
        title: `Occupier ${occupied}`,
        slug: occupied,
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });
      await t.db("projects").where({ id: projectId }).update({ deleted_at: now });

      const store = getProjectStore();
      const origTransaction = store.transaction.bind(store);
      // resolveUniqueSlug is what normally makes this unreachable; force it to
      // hand back a slug that is already taken so the UNIQUE constraint fires.
      vi.spyOn(store, "transaction").mockImplementation(async (fn) =>
        origTransaction(async (txStore) => {
          vi.spyOn(txStore, "resolveUniqueSlug").mockResolvedValue(occupied);
          return fn(txStore);
        }),
      );

      try {
        expect(await restoreChapter(chapterId)).toBe("conflict");

        // The transaction rolled back, so the chapter is still in the trash.
        const row = await t.db("chapters").where({ id: chapterId }).first();
        expect(row.deleted_at).not.toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    // S4 (2026-08-21 review). confirmRestore's doc comment used to claim that a
    // throw from a confirming read would make chapter.restore's
    // `committedCodes: ["RESTORE_READ_FAILURE"]` "actively wrong" by telling the
    // writer a rolled-back restore might have saved. Both halves of that were
    // false, and this pins the truth so the claim cannot drift back:
    //
    //   1. A throw never reaches RESTORE_READ_FAILURE. That code is emitted by
    //      chapters.routes.ts only when the service RETURNS "read_failure";
    //      restoreChapter's catch discriminates on ParentPurgedError,
    //      ChapterPurgedError and a SQLITE_CONSTRAINT_UNIQUE slug collision, and
    //      a SELECT failure is none of those, so it is rethrown.
    //   2. Because F-28 moved both confirming reads inside the transaction, a
    //      throw now rolls the restore BACK — so "it failed, retry" is accurate.
    //      Before F-28 the read ran post-commit and a throw left the chapter
    //      restored while reporting failure; that improvement was recorded as
    //      "no observable delta" and is asserted here instead.
    //
    // Contrast the sibling case above, where the confirming read RETURNS null:
    // there the transaction commits and the chapter stays restored.
    it("rolls the restore back and rethrows when a confirming read throws, rather than returning 'read_failure'", async () => {
      const { chapterId } = await createProjectAndChapter();
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const store = getProjectStore();
      const origTransaction = store.transaction.bind(store);
      vi.spyOn(store, "transaction").mockImplementation(async (fn) =>
        origTransaction(async (txStore) => {
          // Fail only the CONFIRMING read. findChapterById is not called
          // anywhere else on this path, so the restore UPDATE and the parent
          // bump both land before this fires.
          vi.spyOn(txStore, "findChapterById").mockRejectedValue(new Error("io error"));
          return fn(txStore);
        }),
      );

      try {
        await expect(restoreChapter(chapterId)).rejects.toThrow("io error");

        // Rolled back: the chapter is still in the trash, so the generic 500
        // the route renders for a rethrow is telling the writer the truth.
        const row = await t.db("chapters").where({ id: chapterId }).first();
        expect(row.deleted_at).not.toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("rethrows an error that is neither a purge nor a slug collision", async () => {
      const { chapterId } = await createProjectAndChapter();
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const store = getProjectStore();
      const origTransaction = store.transaction.bind(store);
      vi.spyOn(store, "transaction").mockImplementation(async (fn) =>
        origTransaction(async (txStore) => {
          vi.spyOn(txStore, "getMaxChapterSortOrder").mockRejectedValue(new Error("disk on fire"));
          return fn(txStore);
        }),
      );

      try {
        await expect(restoreChapter(chapterId)).rejects.toThrow("disk on fire");
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe("getChapter()", () => {
    it("returns null for a non-existent chapter", async () => {
      const result = await getChapter(uuid());
      expect(result).toBeNull();
    });

    it("returns chapter with status_label for an existing chapter", async () => {
      const { chapterId } = await createProjectAndChapter();
      const result = await getChapter(chapterId);
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result).not.toBe("corrupt");
      expect(result).toMatchObject({ status_label: "Outline" });
    });
  });
});
