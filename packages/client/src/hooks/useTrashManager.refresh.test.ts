import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api, ApiRequestError } from "../api/client";
import type { AbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { refreshTrashList } from "./useTrashManager.refresh";

// Mock api/client so the helper's `trashOp.run((s) => api.projects.trash(...))`
// factory actually hits a vi.fn() we can assert on. Without this mock, the
// `makeTrashOp` passthrough below would call the real api at test time.
vi.mock("../api/client", async (importOriginal) => {
  const { ApiRequestError } = await importOriginal<typeof import("../api/client")>();
  return {
    api: {
      projects: {
        trash: vi.fn(),
      },
    },
    ApiRequestError,
  };
});

function makeProject(id: string, slug: string): ProjectWithChapters {
  return {
    id,
    slug,
    title: `Project ${id}`,
    mode: "fiction",
    target_word_count: null,
    target_deadline: null,
    created_at: "2026-05-27T00:00:00.000Z",
    updated_at: "2026-05-27T00:00:00.000Z",
    deleted_at: null,
    author_name: null,
    chapters: [],
  };
}

// Passthrough trashOp: invokes the factory the helper passes to .run() so
// the api.projects.trash mock above actually gets called. Without this,
// the structural-check comment at migrationStructuralCheck.test.ts:118-126
// ("The helper itself is unit-tested separately ... to confirm it actually
// calls .run() on the parameter") would be a guarantee these tests don't
// provide — the prior shape returned pre-baked { promise, signal } values
// and silently skipped the factory entirely (review I2, 2026-05-28).
function makeTrashOp(signal: AbortSignal): AbortableAsyncOperation {
  return {
    run: vi.fn((fn: (s: AbortSignal) => Promise<Chapter[]>) => {
      const promise = fn(signal);
      return { promise, signal };
    }) as unknown as AbortableAsyncOperation["run"],
    abort: vi.fn(),
  };
}

describe("refreshTrashList", () => {
  beforeEach(() => {
    vi.mocked(api.projects.trash).mockReset();
  });

  it("returns { kind: 'ok', trashed } on success AND invokes trashOp.run + api.projects.trash with project.slug and the captured signal", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const slugRef = { current: project.slug };
    const trashed: Chapter[] = [];
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockResolvedValue(trashed);

    const result = await refreshTrashList(project, projectRef, slugRef, trashOp);

    expect(result).toEqual({ kind: "ok", trashed });
    // The contract the structural-check delegation allowlist appeals to:
    // the helper actually calls .run() on the param, and the factory it
    // hands .run() actually invokes api.projects.trash with project.slug
    // and the live signal. Without these assertions a future refactor
    // could break the wrapping entirely and the test would silently pass.
    expect(trashOp.run).toHaveBeenCalledTimes(1);
    expect(api.projects.trash).toHaveBeenCalledTimes(1);
    expect(api.projects.trash).toHaveBeenCalledWith("alpha", controller.signal);
  });

  it("returns { kind: 'aborted' } on success when signal is aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const slugRef = { current: project.slug };
    const controller = new AbortController();
    controller.abort();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockResolvedValue([]);

    const result = await refreshTrashList(project, projectRef, slugRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on success when projectRef has moved to a different project", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const slugRef = { current: projectA.slug };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockImplementation(() =>
      Promise.resolve([]).then((v) => {
        projectRef.current = projectB;
        return v;
      }),
    );

    const result = await refreshTrashList(projectA, projectRef, slugRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });

  // S8 (dedup review 2026-07-26): this helper's drift guard used to be an
  // id-only copy, which cannot see the PRE-LOAD window — the interval between
  // the URL slug changing and loadProject completing. In that window projectRef
  // still holds the old project, so the id compare passes and the response is
  // treated as fresh; the slug ref has already advanced, which is what catches
  // it. useChapterCrud spells this out above its own copy ("Both checks are
  // needed"), and four of the nine copies had drifted to the weaker form.
  it("returns { kind: 'stale' } when the URL slug has advanced but the new project has not loaded yet", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectRef = { current: projectA };
    // The user has navigated to /projects/beta; loadProject has not finished,
    // so projectRef still holds alpha and an id compare would see no drift.
    const slugRef = { current: "alpha" };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockImplementation(() =>
      Promise.resolve([]).then((v) => {
        slugRef.current = "beta";
        return v;
      }),
    );

    const result = await refreshTrashList(projectA, projectRef, slugRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });

  // I4 (agentic-review 2026-08-05): the S8 dedup silently moved the drift
  // BASELINE from the operation's own project (the `project` argument, which is
  // also the slug the GET uses) to whatever `projectRef.current` happened to
  // hold at construction. confirmDeleteChapter awaits handleDeleteChapter
  // BEFORE calling here, so the ref can already have advanced to B while the
  // GET still asks for A's slug — both guard checks then pass and project A's
  // deleted chapters paint into project B's trash view, from which Restore
  // splices an A chapter into B's sidebar.
  it("returns { kind: 'stale' } when the ref already moved on before the call", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectB };
    const slugRef = { current: projectB.slug };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockResolvedValue([]);

    const result = await refreshTrashList(projectA, projectRef, slugRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
    // Bailing before the GET also spares a request nobody will read.
    expect(api.projects.trash).not.toHaveBeenCalled();
  });

  it("returns { kind: 'error', mapped } on rejection when project unchanged and signal not aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const slugRef = { current: project.slug };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    const err = new ApiRequestError("Internal Server Error", 500, "INTERNAL");
    vi.mocked(api.projects.trash).mockRejectedValue(err);

    const result = await refreshTrashList(project, projectRef, slugRef, trashOp);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("unreachable");
    expect(result.mapped.message).not.toBeNull();
  });

  it("returns { kind: 'aborted' } on rejection when signal is aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const slugRef = { current: project.slug };
    const controller = new AbortController();
    controller.abort();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockRejectedValue(new Error("network"));

    const result = await refreshTrashList(project, projectRef, slugRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on rejection when projectRef has moved", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const slugRef = { current: projectA.slug };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    const err = new ApiRequestError("Internal Server Error", 500, "INTERNAL");
    vi.mocked(api.projects.trash).mockImplementation(() =>
      Promise.reject(err).catch((e) => {
        projectRef.current = projectB;
        throw e;
      }),
    );

    const result = await refreshTrashList(projectA, projectRef, slugRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });
});
