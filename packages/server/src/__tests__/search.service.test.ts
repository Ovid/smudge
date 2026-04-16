import { describe, it, expect, vi, afterEach } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDoc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function makeDocMultiParagraph(texts: string[]) {
  return {
    type: "doc",
    content: texts.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

const _EMPTY_DOC = { type: "doc", content: [] };

async function createProject(title = "Test Project") {
  const projectId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title,
    slug: `test-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  return projectId;
}

async function createChapter(
  projectId: string,
  title: string,
  content: string | null,
  sortOrder = 0,
) {
  const chapterId = uuid();
  const now = new Date().toISOString();
  const wordCount = content ? 0 : 0; // Will be set by the service
  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title,
    content,
    sort_order: sortOrder,
    word_count: wordCount,
    status: "outline",
    created_at: now,
    updated_at: now,
  });
  return chapterId;
}

describe("search.service", () => {
  describe("searchProject()", () => {
    it("finds matches across multiple chapters, grouped by chapter", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(
        projectId,
        "Chapter 1",
        JSON.stringify(makeDoc("The cat sat on the mat")),
        0,
      );
      await createChapter(projectId, "Chapter 2", JSON.stringify(makeDoc("The cat ran away")), 1);

      const result = await searchProject(projectId, "cat");

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(2);
      expect(result!.chapters).toHaveLength(2);
      expect(result!.chapters[0]!.chapter_title).toBe("Chapter 1");
      expect(result!.chapters[0]!.matches).toHaveLength(1);
      expect(result!.chapters[1]!.chapter_title).toBe("Chapter 2");
      expect(result!.chapters[1]!.matches).toHaveLength(1);
    });

    it("returns total count and per-chapter counts", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(
        projectId,
        "Chapter 1",
        JSON.stringify(makeDocMultiParagraph(["the the the", "the end"])),
        0,
      );
      await createChapter(projectId, "Chapter 2", JSON.stringify(makeDoc("the thing")), 1);

      const result = await searchProject(projectId, "the");

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(5);
      expect(result!.chapters[0]!.matches).toHaveLength(4);
      expect(result!.chapters[1]!.matches).toHaveLength(1);
    });

    it("is case-insensitive by default", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("Hello HELLO hello")));

      const result = await searchProject(projectId, "hello");

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(3);
    });

    it("respects case_sensitive: true", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("Hello HELLO hello")));

      const result = await searchProject(projectId, "Hello", { case_sensitive: true });

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(1);
    });

    it("respects whole_word: true", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("cat concatenate catfish")));

      const result = await searchProject(projectId, "cat", { whole_word: true });

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(1);
    });

    it("respects regex: true", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("cat bat hat mat")));

      const result = await searchProject(projectId, "[cbh]at", { regex: true });

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(3);
    });

    it("returns empty results for no matches", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")));

      const result = await searchProject(projectId, "xyz");

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(0);
      expect(result!.chapters).toHaveLength(0);
    });

    it("returns null for non-existent project", async () => {
      const { searchProject } = await import("../search/search.service");

      const result = await searchProject(uuid(), "test");

      expect(result).toBeNull();
    });

    it("skips chapters with corrupt JSON content", async () => {
      const { searchProject } = await import("../search/search.service");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const projectId = await createProject();
      await createChapter(projectId, "Good", JSON.stringify(makeDoc("hello world")), 0);
      await createChapter(projectId, "Corrupt", "{not valid json!!!", 1);

      const result = await searchProject(projectId, "hello");

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(1);
      expect(result!.chapters).toHaveLength(1);
      expect(result!.chapters[0]!.chapter_title).toBe("Good");
      warnSpy.mockRestore();
    });

    it("skips chapters with null content", async () => {
      const { searchProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Has Content", JSON.stringify(makeDoc("hello")), 0);
      await createChapter(projectId, "No Content", null, 1);

      const result = await searchProject(projectId, "hello");

      expect(result).not.toBeNull();
      expect(result!.total_count).toBe(1);
      expect(result!.chapters).toHaveLength(1);
    });
  });

  describe("replaceInProject()", () => {
    it("replaces across all chapters, returns count and affected IDs", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      const ch1 = await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")), 0);
      const ch2 = await createChapter(projectId, "Ch 2", JSON.stringify(makeDoc("hello there")), 1);

      const result = await replaceInProject(projectId, "hello", "goodbye");

      expect(result).not.toBeNull();
      expect("validationError" in result!).toBe(false);
      const r = result as { replaced_count: number; affected_chapter_ids: string[] };
      expect(r.replaced_count).toBe(2);
      expect(r.affected_chapter_ids).toContain(ch1);
      expect(r.affected_chapter_ids).toContain(ch2);

      // Verify content was actually replaced
      const row1 = await t.db("chapters").where({ id: ch1 }).first();
      const doc1 = JSON.parse(row1.content);
      expect(doc1.content[0].content[0].text).toBe("goodbye world");

      const row2 = await t.db("chapters").where({ id: ch2 }).first();
      const doc2 = JSON.parse(row2.content);
      expect(doc2.content[0].content[0].text).toBe("goodbye there");
    });

    it("auto-snapshots created for every affected chapter before replacement", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      const ch1 = await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")), 0);

      await replaceInProject(projectId, "hello", "goodbye");

      const snapshots = await t.db("chapter_snapshots").where({ chapter_id: ch1 });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].label).toContain("Before find-and-replace");
      expect(snapshots[0].label).toContain("hello");
      expect(snapshots[0].label).toContain("goodbye");
      expect(snapshots[0].is_auto).toBe(1); // SQLite stores booleans as integers
      // Snapshot should contain the ORIGINAL content
      const snapContent = JSON.parse(snapshots[0].content);
      expect(snapContent.content[0].content[0].text).toBe("hello world");
    });

    it("word counts recalculated after replacement", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      // "one two" => 2 words, replace "two" with "two three four" => 4 words
      const ch1 = await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("one two")), 0);

      await replaceInProject(projectId, "two", "two three four");

      const row = await t.db("chapters").where({ id: ch1 }).first();
      expect(row.word_count).toBe(4);
    });

    it("chapters with no matches are not snapshotted or modified", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      const ch1 = await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")), 0);
      const ch2 = await createChapter(
        projectId,
        "Ch 2",
        JSON.stringify(makeDoc("goodbye world")),
        1,
      );
      const originalContent = JSON.stringify(makeDoc("goodbye world"));

      await replaceInProject(projectId, "hello", "hi");

      // ch1 should be affected
      const snapshots1 = await t.db("chapter_snapshots").where({ chapter_id: ch1 });
      expect(snapshots1).toHaveLength(1);

      // ch2 should NOT be affected
      const snapshots2 = await t.db("chapter_snapshots").where({ chapter_id: ch2 });
      expect(snapshots2).toHaveLength(0);

      // ch2 content should be unchanged
      const row2 = await t.db("chapters").where({ id: ch2 }).first();
      expect(row2.content).toBe(originalContent);
    });

    it("scoped to single chapter when scope.type === 'chapter'", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      const ch1 = await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")), 0);
      const ch2 = await createChapter(projectId, "Ch 2", JSON.stringify(makeDoc("hello there")), 1);

      const result = await replaceInProject(projectId, "hello", "goodbye", undefined, {
        type: "chapter",
        chapter_id: ch1,
      });

      const r = result as { replaced_count: number; affected_chapter_ids: string[] };
      expect(r.replaced_count).toBe(1);
      expect(r.affected_chapter_ids).toEqual([ch1]);

      // ch2 should be unchanged
      const row2 = await t.db("chapters").where({ id: ch2 }).first();
      const doc2 = JSON.parse(row2.content);
      expect(doc2.content[0].content[0].text).toBe("hello there");
    });

    it("returns null for non-existent project", async () => {
      const { replaceInProject } = await import("../search/search.service");

      const result = await replaceInProject(uuid(), "hello", "goodbye");

      expect(result).toBeNull();
    });

    it("returns 0 replacements when no matches", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")), 0);

      const result = await replaceInProject(projectId, "xyz", "abc");

      const r = result as { replaced_count: number; affected_chapter_ids: string[] };
      expect(r.replaced_count).toBe(0);
      expect(r.affected_chapter_ids).toEqual([]);
    });

    it("invalid regex returns validationError", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")), 0);

      const result = await replaceInProject(projectId, "[invalid(", "replacement", {
        regex: true,
      });

      expect(result).not.toBeNull();
      expect("validationError" in result!).toBe(true);
      const r = result as { validationError: string };
      expect(r.validationError).toBeTruthy();
    });

    it("replace with empty string works (deletion)", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      const ch1 = await createChapter(projectId, "Ch 1", JSON.stringify(makeDoc("hello world")), 0);

      const result = await replaceInProject(projectId, "hello ", "");

      const r = result as { replaced_count: number; affected_chapter_ids: string[] };
      expect(r.replaced_count).toBe(1);

      const row = await t.db("chapters").where({ id: ch1 }).first();
      const doc = JSON.parse(row.content);
      expect(doc.content[0].content[0].text).toBe("world");
    });

    it("image reference counts adjusted via applyImageRefDiff", async () => {
      const { replaceInProject } = await import("../search/search.service");
      const projectId = await createProject();
      const imageId = uuid();

      // Create a chapter with text that contains an image node alongside text
      const docWithImage = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
          { type: "image", attrs: { src: `/api/images/${imageId}` } },
        ],
      };
      await createChapter(projectId, "Ch 1", JSON.stringify(docWithImage), 0);

      // Insert an image record
      await t.db("images").insert({
        id: imageId,
        project_id: projectId,
        filename: "test.png",
        mime_type: "image/png",
        size_bytes: 100,
        reference_count: 1,
        created_at: new Date().toISOString(),
      });

      // Replace text — image refs should stay the same (no image change)
      await replaceInProject(projectId, "hello", "goodbye");

      const image = await t.db("images").where({ id: imageId }).first();
      expect(image.reference_count).toBe(1); // unchanged — image still there
    });
  });
});
