import { describe, it, expect, vi } from "vitest";
import { randomUUID as uuid } from "node:crypto";
import { setupTestDb } from "./test-helpers";
import * as OuttakesRepo from "../outtakes/outtakes.repository";
import { logger } from "../logger";

const t = setupTestDb();

async function createProject() {
  const projectId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: "Outtake Test",
    slug: `out-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  return projectId;
}

function makeData(projectId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    project_id: projectId,
    label: null,
    content: '{"type":"doc","content":[]}',
    created_at: now,
    updated_at: now,
    ...overrides,
  } as {
    id: string;
    project_id: string;
    label: string | null;
    content: string;
    created_at: string;
    updated_at: string;
  };
}

describe("outtakes repository", () => {
  describe("insert() + findById()", () => {
    it("inserts an outtake and re-reads it with PARSED content", async () => {
      const projectId = await createProject();
      const data = makeData(projectId, { label: "Cut scene" });

      const inserted = await OuttakesRepo.insert(t.db, data);
      // content comes back parsed (object), not the stored string
      expect(inserted.content).toEqual({ type: "doc", content: [] });
      expect(inserted.id).toBe(data.id);
      expect(inserted.project_id).toBe(projectId);
      expect(inserted.label).toBe("Cut scene");

      const found = await OuttakesRepo.findById(t.db, data.id);
      expect(found).not.toBeNull();
      expect(found!.content).toEqual({ type: "doc", content: [] });
      expect(found!.label).toBe("Cut scene");
      expect(found!.created_at).toBe(data.created_at);
      expect(found!.updated_at).toBe(data.updated_at);
    });

    it("returns null for a non-existing id", async () => {
      const found = await OuttakesRepo.findById(t.db, uuid());
      expect(found).toBeNull();
    });
  });

  describe("listByProject()", () => {
    it("returns outtakes newest first, breaking ties by id desc", async () => {
      const projectId = await createProject();
      const older = makeData(projectId, {
        label: "older",
        created_at: "2026-04-01T00:00:00.000Z",
      });
      const newer = makeData(projectId, {
        label: "newer",
        created_at: "2026-04-02T00:00:00.000Z",
      });

      await OuttakesRepo.insert(t.db, older);
      await OuttakesRepo.insert(t.db, newer);

      const list = await OuttakesRepo.listByProject(t.db, projectId);
      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe(newer.id);
      expect(list[1]!.id).toBe(older.id);
      // content is parsed here too
      expect(list[0]!.content).toEqual({ type: "doc", content: [] });
    });

    // S8 (agentic-review 2026-08-04): the tie-break was `id DESC`, and ids are
    // v4 UUIDs — they carry no ordering information, so two outtakes sharing a
    // millisecond listed in UUID order, as likely oldest-first as newest-first,
    // against an endpoint whose contract (and whose panel) says newest first.
    // Deterministic-but-arbitrary is harder to notice than nondeterministic.
    // Insertion order here contradicts id order, so only a rowid tie-break
    // passes.
    it("breaks same-timestamp ties by insertion order, newest first", async () => {
      const projectId = await createProject();
      const sameTime = "2026-04-03T00:00:00.000Z";
      const first = makeData(projectId, { id: "zzzz-id", created_at: sameTime });
      const second = makeData(projectId, { id: "aaaa-id", created_at: sameTime });

      await OuttakesRepo.insert(t.db, first);
      await OuttakesRepo.insert(t.db, second);

      const list = await OuttakesRepo.listByProject(t.db, projectId);
      expect(list.map((o) => o.id)).toEqual(["aaaa-id", "zzzz-id"]);
    });

    it("returns an empty array when no outtakes exist", async () => {
      const projectId = await createProject();
      const list = await OuttakesRepo.listByProject(t.db, projectId);
      expect(list).toEqual([]);
    });

    it("degrades one corrupt-content row to an empty doc without breaking the list", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      const projectId = await createProject();
      const good = makeData(projectId, { label: "good" });
      await OuttakesRepo.insert(t.db, good);
      // Bypass the repo so we can persist deliberately-malformed JSON.
      const corrupt = makeData(projectId, { label: "corrupt", content: "not json {" });
      await t.db("outtakes").insert(corrupt);

      const list = await OuttakesRepo.listByProject(t.db, projectId);

      expect(list).toHaveLength(2);
      const badRow = list.find((o) => o.id === corrupt.id);
      expect(badRow).toBeDefined();
      expect(badRow!.label).toBe("corrupt");
      expect(badRow!.content).toEqual({ type: "doc", content: [] });
      // S7 (agentic-review 2026-08-04): the placeholder doc keeps the row
      // renderable and therefore deletable, but it must not be MISTAKEABLE for
      // an empty outtake. Outtakes are hard-deleted (no deleted_at, no trash, no
      // 30-day window), so the writer who reads that card as "nothing here"
      // destroys the last copy of JSON a human could still recover by hand.
      expect(badRow!.content_corrupt).toBe(true);
      // The healthy row still loads with its real content, and carries no flag.
      const goodRow = list.find((o) => o.id === good.id);
      expect(goodRow!.content).toEqual({ type: "doc", content: [] });
      expect(goodRow!.content_corrupt).toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ outtake_id: corrupt.id }),
        expect.any(String),
      );
      warnSpy.mockRestore();
    });

    it.each([
      ["null", "null"],
      ["a number", "42"],
      ["an array", "[]"],
      ["a string", '"just text"'],
    ])("degrades content that parses to %s (S1)", async (_label, stored) => {
      // JSON.parse succeeds for all of these, so only guarding the throw let a
      // non-object through as OuttakeRow.content — which the client then
      // dereferences unguarded (EditorPage reads .content.content, OuttakeCard
      // walks it for the word count).
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      const projectId = await createProject();
      const row = makeData(projectId, { label: "shapeless", content: stored });
      await t.db("outtakes").insert(row);

      const found = await OuttakesRepo.findById(t.db, row.id);

      expect(found!.content).toEqual({ type: "doc", content: [] });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ outtake_id: row.id }),
        expect.any(String),
      );
      warnSpy.mockRestore();
    });

    // S2 (agentic-review 2026-08-05): isTipTapNode is the shared "may a walker
    // descend into this?" predicate — deliberately any non-null non-array
    // object — so it flags null/42/[]/"text" but waves through `{"foo":1}` and
    // a doc whose `content` is not an array. Those list as an empty card with 0
    // words and NO corruption badge: the exact "looks empty, invites the writer
    // to hard-delete the last recoverable copy" failure the flag exists for.
    // The sibling this file says it mirrors (snapshots.service restore) gates on
    // TipTapDocSchema and names this case explicitly.
    it.each([
      ["an object that is not a document", '{"foo":1}'],
      ["a doc whose content is not an array", '{"type":"doc","content":{"0":{}}}'],
      ["a doc with a primitive child", '{"type":"doc","content":[7]}'],
    ])("flags content that parses to %s (S2)", async (_label, stored) => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      const projectId = await createProject();
      const row = makeData(projectId, { label: "wrong shape", content: stored });
      await t.db("outtakes").insert(row);

      const found = await OuttakesRepo.findById(t.db, row.id);

      expect(found!.content).toEqual({ type: "doc", content: [] });
      expect(found!.content_corrupt).toBe(true);
      warnSpy.mockRestore();
    });
  });

  describe("updateLabel()", () => {
    it("changes the label and updated_at, leaving content untouched", async () => {
      const projectId = await createProject();
      const data = makeData(projectId, { label: "before" });
      await OuttakesRepo.insert(t.db, data);

      const newTime = "2026-05-01T00:00:00.000Z";
      const updated = await OuttakesRepo.updateLabel(t.db, data.id, "after", newTime);
      expect(updated).not.toBeNull();
      expect(updated!.label).toBe("after");
      expect(updated!.updated_at).toBe(newTime);
      expect(updated!.content).toEqual({ type: "doc", content: [] });
    });

    it("can clear the label to null", async () => {
      const projectId = await createProject();
      const data = makeData(projectId, { label: "named" });
      await OuttakesRepo.insert(t.db, data);

      const updated = await OuttakesRepo.updateLabel(
        t.db,
        data.id,
        null,
        "2026-05-02T00:00:00.000Z",
      );
      expect(updated!.label).toBeNull();
    });

    it("returns null when the outtake does not exist", async () => {
      const updated = await OuttakesRepo.updateLabel(t.db, uuid(), "x", new Date().toISOString());
      expect(updated).toBeNull();
    });
  });

  describe("remove()", () => {
    it("hard-deletes an existing outtake and returns 1", async () => {
      const projectId = await createProject();
      const data = makeData(projectId);
      await OuttakesRepo.insert(t.db, data);

      const count = await OuttakesRepo.remove(t.db, data.id);
      expect(count).toBe(1);
      expect(await OuttakesRepo.findById(t.db, data.id)).toBeNull();
    });

    it("returns 0 for a non-existing outtake", async () => {
      const count = await OuttakesRepo.remove(t.db, uuid());
      expect(count).toBe(0);
    });
  });

  describe("FK cascade on project delete", () => {
    it("deletes outtakes automatically when the parent project is hard-deleted", async () => {
      const projectId = await createProject();
      await OuttakesRepo.insert(t.db, makeData(projectId));
      await OuttakesRepo.insert(t.db, makeData(projectId));

      await t.db("projects").where({ id: projectId }).delete();

      const list = await OuttakesRepo.listByProject(t.db, projectId);
      expect(list).toEqual([]);
    });
  });
});
