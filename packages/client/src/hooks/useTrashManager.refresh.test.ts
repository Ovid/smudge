import { describe, expect, it, vi } from "vitest";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { ApiRequestError } from "../errors";
import type { AbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { refreshTrashList } from "./useTrashManager.refresh";

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
    chapters: [],
  };
}

function makeTrashOp(promise: Promise<Chapter[]>, signal: AbortSignal): AbortableAsyncOperation {
  return {
    run: vi.fn(() => ({ promise, signal })),
    abort: vi.fn(),
  };
}

describe("refreshTrashList", () => {
  it("returns { kind: 'ok', trashed } on success when project unchanged and signal not aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const trashed: Chapter[] = [];
    const controller = new AbortController();
    const trashOp = makeTrashOp(Promise.resolve(trashed), controller.signal);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "ok", trashed });
  });

  it("returns { kind: 'aborted' } on success when signal is aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const controller = new AbortController();
    controller.abort();
    const trashOp = makeTrashOp(Promise.resolve([]), controller.signal);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on success when projectRef has moved to a different project", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const controller = new AbortController();
    const promise = Promise.resolve([]).then((v) => {
      projectRef.current = projectB;
      return v;
    });
    const trashOp = makeTrashOp(promise, controller.signal);

    const result = await refreshTrashList(projectA, projectRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });

  it("returns { kind: 'error', mapped } on rejection when project unchanged and signal not aborted", async () => {
    const project = makeProject("p-1", "alpha");
    const projectRef = { current: project };
    const controller = new AbortController();
    const err = new ApiRequestError("Internal Server Error", 500, {
      code: "INTERNAL",
      message: "Internal Server Error",
    });
    const trashOp = makeTrashOp(Promise.reject(err), controller.signal);

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
    const trashOp = makeTrashOp(Promise.reject(new Error("network")), controller.signal);

    const result = await refreshTrashList(project, projectRef, trashOp);

    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns { kind: 'stale' } on rejection when projectRef has moved", async () => {
    const projectA = makeProject("p-1", "alpha");
    const projectB = makeProject("p-2", "beta");
    const projectRef = { current: projectA };
    const controller = new AbortController();
    const err = new ApiRequestError("Internal Server Error", 500, {
      code: "INTERNAL",
      message: "Internal Server Error",
    });
    const promise = Promise.reject(err).catch((e) => {
      projectRef.current = projectB;
      throw e;
    });
    const trashOp = makeTrashOp(promise, controller.signal);

    const result = await refreshTrashList(projectA, projectRef, trashOp);

    expect(result).toEqual({ kind: "stale" });
  });
});
