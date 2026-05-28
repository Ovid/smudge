import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api, ApiRequestError } from "../api/client";
import type { AbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { refreshTrashList } from "./useTrashManager.refresh";

// Mock api/client so the helper's `trashOp.run((s) => api.projects.trash(...))`
// factory actually hits a vi.fn() we can assert on. Without this mock, the
// `makeTrashOp` passthrough below would call the real api at test time.
vi.mock("../api/client", () => {
  class ApiRequestError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
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
    const trashed: Chapter[] = [];
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockResolvedValue(trashed);

    const result = await refreshTrashList(project, projectRef, trashOp);

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
    const controller = new AbortController();
    controller.abort();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockResolvedValue([]);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on success when projectRef has moved to a different project", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockImplementation(() =>
      Promise.resolve([]).then((v) => {
        projectRef.current = projectB;
        return v;
      }),
    );

    const result = await refreshTrashList(projectA, projectRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });

  it("returns { kind: 'error', mapped } on rejection when project unchanged and signal not aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    const err = new ApiRequestError("Internal Server Error", 500, "INTERNAL");
    vi.mocked(api.projects.trash).mockRejectedValue(err);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("unreachable");
    expect(result.mapped.message).not.toBeNull();
  });

  it("returns { kind: 'aborted' } on rejection when signal is aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const controller = new AbortController();
    controller.abort();
    const trashOp = makeTrashOp(controller.signal);
    vi.mocked(api.projects.trash).mockRejectedValue(new Error("network"));

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on rejection when projectRef has moved", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const controller = new AbortController();
    const trashOp = makeTrashOp(controller.signal);
    const err = new ApiRequestError("Internal Server Error", 500, "INTERNAL");
    vi.mocked(api.projects.trash).mockImplementation(() =>
      Promise.reject(err).catch((e) => {
        projectRef.current = projectB;
        throw e;
      }),
    );

    const result = await refreshTrashList(projectA, projectRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });
});
