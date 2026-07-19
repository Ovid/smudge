import { describe, it, expect, afterEach } from "vitest";
import { randomUUID as uuid } from "node:crypto";
import { setupTestDb } from "./test-helpers";
import { setVelocityService, resetVelocityService } from "../velocity/velocity.injectable";
import { createOuttake, listOuttakes } from "../outtakes/outtakes.service";
import { getVelocityBySlug } from "../velocity/velocity.service";
import { exportProject } from "../export/export.service";
import { replaceInProject } from "../search/search.service";

const t = setupTestDb();

afterEach(() => resetVelocityService());

// No-op velocity so replaceInProject's best-effort recordSave stays warning-clean.
function stubVelocity() {
  setVelocityService({ recordSave: async () => {}, updateDailySnapshot: async () => {} });
}

function doc(text: string): Record<string, unknown> {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function createProjectAndChapter(chapterText: string, wordCount: number) {
  const projectId = uuid();
  const chapterId = uuid();
  const slug = `test-${projectId.slice(0, 8)}`;
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: `Test Project ${projectId.slice(0, 8)}`,
    slug,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title: "Chapter 1",
    content: JSON.stringify(doc(chapterText)),
    sort_order: 0,
    word_count: wordCount,
    status: "outline",
    created_at: now,
    updated_at: now,
  });
  return { projectId, slug, chapterId };
}

describe("outtakes are structurally excluded from aggregations", () => {
  it("do not count toward velocity current_total", async () => {
    const { projectId, slug } = await createProjectAndChapter("one two three", 3);

    const before = await getVelocityBySlug(slug);
    expect(before).not.toBeNull();
    const baseline = before!.current_total;

    await createOuttake(projectId, doc("alpha beta gamma delta epsilon"), "cut");

    const after = await getVelocityBySlug(slug);
    expect(after!.current_total).toBe(baseline);
  });

  it("do not appear in an export", async () => {
    const { projectId, slug } = await createProjectAndChapter("chapter body text", 3);
    await createOuttake(projectId, doc("SECRET_OUTTAKE_MARKER should never export"), "cut");

    const result = await exportProject(slug, { format: "plaintext" });
    expect("result" in result).toBe(true);
    const content = (result as { result: { content: string } }).result.content;
    expect(content).not.toContain("SECRET_OUTTAKE_MARKER");
  });

  it("are not touched by a project-wide find-and-replace", async () => {
    stubVelocity();
    const { projectId } = await createProjectAndChapter("nothing here to change", 4);
    const created = await createOuttake(projectId, doc("please REPLACE_ME now"), "cut");

    const result = await replaceInProject(projectId, "REPLACE_ME", "CHANGED");
    // Well-formed replace (may match zero times in chapters); not a failure shape.
    expect(result).not.toBeNull();
    expect(typeof result).not.toBe("string");

    const list = await listOuttakes(projectId);
    const stillThere = list!.find((o) => o.id === created!.id)!;
    const flat = JSON.stringify(stillThere.content);
    expect(flat).toContain("REPLACE_ME");
    expect(flat).not.toContain("CHANGED");
  });
});
