import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";

import { api } from "../api/client";
import { useTrashManager } from "../hooks/useTrashManager";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: {
      projects: { trash: vi.fn() },
      chapters: { restore: vi.fn() },
    },
  };
});

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "ch1",
    project_id: "p1",
    title: "Deleted Chapter",
    content: null,
    sort_order: 0,
    word_count: 0,
    status: "outline",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: "2026-03-20T10:00:00.000Z",
    ...overrides,
  };
}

function makeProject(chapters: Chapter[] = []): ProjectWithChapters {
  return {
    id: "p1",
    slug: "project-1",
    title: "Project 1",
    mode: "fiction",
    target_word_count: null,
    target_deadline: null,
    author_name: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
    chapters,
  } as unknown as ProjectWithChapters;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Hook logs console.error on failure paths; suppress to honor
  // "zero warnings in test output" from CLAUDE.md.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("useTrashManager.handleRestore — I2 committed UX", () => {
  it("on RESTORE_READ_FAILURE, removes the chapter from the trashed list and shows the committed message", async () => {
    const deleted = makeChapter({ id: "ch-committed" });
    const project = makeProject();
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();

    vi.mocked(api.chapters.restore).mockRejectedValue(
      new ApiRequestError("read failed", 500, "RESTORE_READ_FAILURE"),
    );

    vi.mocked(api.projects.trash).mockResolvedValue([deleted]);

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, handleDeleteChapter, navigate),
    );

    // Seed the trashed list via openTrash (no setter is exposed directly).
    await act(async () => {
      await result.current.openTrash();
    });

    await act(async () => {
      await result.current.handleRestore("ch-committed");
    });

    // Committed UX: chapter is gone from the trashed list (will reappear
    // in the project on refresh), and the committed message is surfaced
    // so the user knows to refresh rather than retry.
    await waitFor(() => {
      expect(result.current.trashedChapters.find((c) => c.id === "ch-committed")).toBeUndefined();
    });
    expect(result.current.actionError).toBe(STRINGS.error.restoreChapterCommitted);
    // No optimistic project mutation — we don't have the restored row.
    expect(setProject).not.toHaveBeenCalled();
  });

  it("on 2xx BAD_JSON (possiblyCommitted), removes the chapter from trash and shows the committed message", async () => {
    const deleted = makeChapter({ id: "ch-badjson" });
    const project = makeProject();
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();

    vi.mocked(api.chapters.restore).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.trash).mockResolvedValue([deleted]);

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, handleDeleteChapter, navigate),
    );

    await act(async () => {
      await result.current.openTrash();
    });

    await act(async () => {
      await result.current.handleRestore("ch-badjson");
    });

    await waitFor(() => {
      expect(result.current.trashedChapters.find((c) => c.id === "ch-badjson")).toBeUndefined();
    });
    expect(result.current.actionError).toBe(STRINGS.error.restoreChapterCommitted);
    expect(setProject).not.toHaveBeenCalled();
  });

  // I5 (review 2026-04-24): api.projects.trash now accepts a signal
  // and the hook wires a controller. Unmount aborts the in-flight
  // fetch so a late .then/.catch can't fire setState on a gone
  // component, and an aborted console.error no longer pollutes test
  // output (zero-warnings invariant).
  it("aborts in-flight trash fetch on unmount (I5)", async () => {
    const project = makeProject();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves
    });

    const { result, unmount } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
    );

    act(() => {
      void result.current.openTrash();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalled());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("on ABORTED error, does not log to console.error (I5)", async () => {
    const project = makeProject();
    vi.mocked(api.projects.trash).mockRejectedValue(new ApiRequestError("aborted", 0, "ABORTED"));

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
    );

    await act(async () => {
      await result.current.openTrash();
    });

    // Mapper returns message=null for ABORTED, so no actionError.
    expect(result.current.actionError).toBeNull();
    // Zero-warnings invariant: a superseded/unmount abort must not log.
    expect(errorSpy).not.toHaveBeenCalledWith("Failed to load trash:", expect.anything());
  });

  it("aborts in-flight restore on unmount (User callout 2026-04-25)", async () => {
    // The 2026-04-25 review note: handleRestore had no
    // cancellation/unmount guard (unlike openTrash). If the hook's
    // owner unmounts (navigation / chapter switch) while
    // api.chapters.restore() is in flight, the catch path can still
    // log and setState on a torn-down hook. Mirror the openTrash
    // pattern: AbortController stored in a ref + unmount cleanup,
    // signal threaded into api.chapters.restore, early-return from
    // success and error paths on aborted/stale.
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.chapters.restore).mockImplementation((_id, signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves — we care about abort only
    });
    vi.mocked(api.projects.trash).mockResolvedValue([makeChapter({ id: "ch-restored" })]);

    const project = makeProject();
    const { result, unmount } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
    );
    await act(async () => {
      await result.current.openTrash();
    });

    act(() => {
      void result.current.handleRestore("ch-restored");
    });
    await waitFor(() => expect(api.chapters.restore).toHaveBeenCalled());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("on ABORTED restore error, does not log or surface state (User callout 2026-04-25)", async () => {
    // The mapper returns message: null for ABORTED. The hook must
    // honor that: no console.error, no actionError set, no optimistic
    // trash-list mutation. Otherwise an unmount/supersession abort
    // logs noise (CLAUDE.md zero-warnings invariant) and risks state
    // updates on a torn-down hook.
    const deleted = makeChapter({ id: "ch-aborted" });
    vi.mocked(api.chapters.restore).mockRejectedValue(
      new ApiRequestError("[dev] aborted", 0, "ABORTED"),
    );
    vi.mocked(api.projects.trash).mockResolvedValue([deleted]);
    const project = makeProject();
    const setProject = vi.fn();
    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, vi.fn(), vi.fn()),
    );
    await act(async () => {
      await result.current.openTrash();
    });
    await act(async () => {
      await result.current.handleRestore("ch-aborted");
    });

    expect(result.current.actionError).toBeNull();
    expect(setProject).not.toHaveBeenCalled();
    // Aborted superseded restore must not pollute the console.
    expect(errorSpy).not.toHaveBeenCalledWith("Failed to restore chapter:", expect.anything());
  });

  it("seeds confirmed-status cache for the restored chapter (C2 2026-04-25)", async () => {
    // Restored chapters land in project state via setProject(prev =>
    // …). Without seeding the confirmed-status cache, a later status
    // PATCH on this chapter that double-fails (PATCH + recovery GET)
    // reads previousStatus = undefined and silently skips the local
    // revert, leaving the optimistic status on screen even though the
    // server never accepted it. The hook accepts an optional
    // seedConfirmedStatus callback so EditorPage can wire it through
    // to useProjectEditor's seeder.
    const restored = makeChapter({ id: "ch-restored", status: "drafting" });
    const project = makeProject();
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();
    const seedConfirmedStatus = vi.fn();

    vi.mocked(api.chapters.restore).mockResolvedValue({
      ...restored,
      project_slug: project.slug,
    });
    vi.mocked(api.projects.trash).mockResolvedValue([restored]);

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, handleDeleteChapter, navigate, {
        seedConfirmedStatus,
      }),
    );

    await act(async () => {
      await result.current.openTrash();
    });

    await act(async () => {
      await result.current.handleRestore("ch-restored");
    });

    expect(seedConfirmedStatus).toHaveBeenCalledWith("ch-restored", "drafting");
  });

  it("on PROJECT_PURGED (non-committed failure), keeps the chapter in trash and shows error", async () => {
    // Regression guard: non-committed errors keep the chapter visible in
    // the trash list so the user can try a different action — only the
    // committed branch optimistically removes.
    const deleted = makeChapter({ id: "ch-purged" });
    const project = makeProject();
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();

    // I3 (review 2026-04-26): server emits PROJECT_PURGED at HTTP 404
    // (`packages/server/src/chapters/chapters.routes.ts:97-104`), not 409.
    // The 409 fixture used to pass only because byCode precedence resolves
    // before byStatus; pin real-traffic 404 so a future regression that
    // drops byCode["PROJECT_PURGED"] would surface here instead of being
    // masked by the phantom status code (a 404 fixture would correctly
    // route to byStatus[404] = restoreChapterAlreadyPurged).
    vi.mocked(api.chapters.restore).mockRejectedValue(
      new ApiRequestError("gone", 404, "PROJECT_PURGED"),
    );
    vi.mocked(api.projects.trash).mockResolvedValue([deleted]);

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, handleDeleteChapter, navigate),
    );

    await act(async () => {
      await result.current.openTrash();
    });

    await act(async () => {
      await result.current.handleRestore("ch-purged");
    });

    expect(result.current.trashedChapters.find((c) => c.id === "ch-purged")).toBeDefined();
    expect(result.current.actionError).toBe(STRINGS.error.restoreChapterProjectPurged);
  });
});
