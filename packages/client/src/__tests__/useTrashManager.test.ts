import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";

import { api } from "../api/client";
import { useTrashManager } from "../hooks/useTrashManager";
import { pendingUntilAbort } from "./helpers/abortableMocks";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: {
      projects: { trash: vi.fn(), get: vi.fn() },
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
    // I4 (4b.3c.3): committed branch now fires a recovery GET; default
    // the mock so this test can focus on the committed-banner UX.
    vi.mocked(api.projects.get).mockResolvedValue({ ...project, chapters: [] });

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
    // I4 (4b.3c.3): default the recovery GET so the committed branch
    // doesn't reject on undefined.then.
    vi.mocked(api.projects.get).mockResolvedValue({ ...project, chapters: [] });

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
      return pendingUntilAbort(signal);
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
      return pendingUntilAbort(signal);
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
    // masked by the phantom status code (a 404 fixture without the code
    // would correctly route to byStatus[404] = restoreChapterUnavailable).
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

  it("openTrash aborts the prior in-flight signal when called again rapidly", async () => {
    // Pin the abort-prior contract on trashOp via the openTrash path. Pre-
    // migration: trashAbortRef.current?.abort() at line 55. Post-migration:
    // trashOp.run() aborts the prior controller before allocating a new
    // one. Either way, two rapid openTrash() calls must leave the first
    // signal aborted and the second signal fresh.
    const capturedSignals: AbortSignal[] = [];
    vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
      if (signal) capturedSignals.push(signal);
      return pendingUntilAbort(signal);
    });

    const project = makeProject();
    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
    );

    act(() => {
      void result.current.openTrash();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));
    expect(capturedSignals[0]?.aborted).toBe(false);

    act(() => {
      void result.current.openTrash();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(2));

    expect(capturedSignals[0]?.aborted).toBe(true);
    expect(capturedSignals[1]?.aborted).toBe(false);
  });

  it("confirmDeleteChapter's post-delete trash refresh aborts on unmount and threads the signal", async () => {
    // Pin abort-on-unmount + signal-threading for the post-delete refresh
    // path. Pre-migration: the refresh allocates its own AbortController
    // and stores it on trashAbortRef (lines 166–170); the combined unmount
    // cleanup effect at lines 45–51 aborts it. Post-migration: the refresh
    // calls trashOp.run() and the hook's auto-abort handles unmount.
    //
    // Per Plan-vs-Design Note [D1]: this test sets trashOpen=true manually
    // via the hook's exposed setter so confirmDeleteChapter's
    // `if (trashOpen && project)` guard reaches the refresh branch without
    // requiring a preceding openTrash() (whose pendingUntilAbort would
    // never set trashOpen=true).
    let refreshSignal: AbortSignal | undefined;
    vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
      refreshSignal = signal;
      return pendingUntilAbort(signal);
    });

    const target = makeChapter({ id: "ch-target" });
    const project = makeProject();
    const handleDeleteChapter = vi.fn().mockResolvedValue(true);

    const { result, unmount } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), handleDeleteChapter, vi.fn()),
    );

    // [D1] setup: satisfy the `if (trashOpen && project)` guard without
    // calling openTrash (whose pendingUntilAbort would never resolve).
    act(() => {
      result.current.setTrashOpen(true);
      result.current.setDeleteTarget(target);
    });

    act(() => {
      void result.current.confirmDeleteChapter();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));

    expect(refreshSignal).toBeDefined();
    expect(refreshSignal?.aborted).toBe(false);

    unmount();
    expect(refreshSignal?.aborted).toBe(true);
  });

  it("openTrash and confirmDeleteChapter's refresh share trashOp (shared-ref behaviour)", async () => {
    // Pin the shared-controller behaviour across openTrash and
    // confirmDeleteChapter's refresh. Pre-migration: both call sites
    // reference trashAbortRef, so the second one's
    // `trashAbortRef.current?.abort()` cancels the first's controller.
    // Post-migration: both call sites invoke trashOp.run() on the same
    // hook instance, so run()'s abort-prior cancels the first call's
    // controller. The shared-controller invariant is what makes
    // openTrash + refresh mutually exclusive — calling either while the
    // other is in flight aborts the prior.
    //
    // Per Plan-vs-Design Note [D2]: setTrashOpen=true is called manually
    // before the in-flight openTrash so confirmDeleteChapter's refresh
    // branch can fire without waiting for openTrash to resolve (which it
    // won't, with pendingUntilAbort).
    const capturedSignals: AbortSignal[] = [];
    vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
      if (signal) capturedSignals.push(signal);
      return pendingUntilAbort(signal);
    });

    const target = makeChapter({ id: "ch-target" });
    const project = makeProject();
    const handleDeleteChapter = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), handleDeleteChapter, vi.fn()),
    );

    // [D2] setup: trashOpen=true so confirmDeleteChapter reaches the
    // refresh branch; deleteTarget so confirmDeleteChapter has a chapter
    // to delete.
    act(() => {
      result.current.setTrashOpen(true);
      result.current.setDeleteTarget(target);
    });

    act(() => {
      void result.current.openTrash();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));
    const openTrashSignal = capturedSignals[0];
    expect(openTrashSignal?.aborted).toBe(false);

    // Fire confirmDeleteChapter. It awaits handleDeleteChapter (resolves
    // true), then hits the refresh branch which calls api.projects.trash
    // a second time. Pre-migration the refresh aborts the prior
    // trashAbortRef.current; post-migration trashOp.run() aborts the prior
    // controller. Either way, the openTrash signal is aborted.
    act(() => {
      void result.current.confirmDeleteChapter();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(2));
    const refreshSignal = capturedSignals[1];

    expect(openTrashSignal?.aborted).toBe(true);
    expect(refreshSignal?.aborted).toBe(false);
  });

  it("handleRestore aborts the prior in-flight signal when called again rapidly", async () => {
    // Pin the abort-prior contract on restoreOp via the handleRestore
    // path. Pre-migration: restoreAbortRef.current?.abort() at line 80.
    // Post-migration: restoreOp.run() aborts the prior controller.
    // Either way, two rapid handleRestore() calls must leave the first
    // signal aborted and the second signal fresh.
    const capturedSignals: AbortSignal[] = [];
    vi.mocked(api.chapters.restore).mockImplementation((_id, signal) => {
      if (signal) capturedSignals.push(signal);
      return pendingUntilAbort(signal);
    });

    const project = makeProject();
    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
    );

    act(() => {
      void result.current.handleRestore("ch-1");
    });
    await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(1));
    expect(capturedSignals[0]?.aborted).toBe(false);

    act(() => {
      void result.current.handleRestore("ch-2");
    });
    await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(2));

    expect(capturedSignals[0]?.aborted).toBe(true);
    expect(capturedSignals[1]?.aborted).toBe(false);
  });

  it("trashOp and restoreOp use independent controllers (cross-ref independence)", async () => {
    // Pin the cross-ref independence invariant. Pre-migration:
    // trashAbortRef and restoreAbortRef are distinct useRef<...> slots,
    // so openTrash (which touches only trashAbortRef) cannot abort an
    // in-flight handleRestore signal, and vice versa. Post-migration:
    // trashOp and restoreOp are two separate useAbortableAsyncOperation
    // instances with two distinct internal refs, preserving the same
    // independence.
    //
    // This is the load-bearing test the design's §Risks calls out —
    // without it, a future maintainer collapsing trashOp + restoreOp
    // into one shared instance would silently break the "user can be
    // restoring a chapter while the trash list refreshes" concurrency
    // model. The §Out of scope rule "Folding trashOp and restoreOp into
    // one instance" depends on this test for executable enforcement.
    const trashSignals: AbortSignal[] = [];
    vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
      if (signal) trashSignals.push(signal);
      return pendingUntilAbort(signal);
    });
    const restoreSignals: AbortSignal[] = [];
    vi.mocked(api.chapters.restore).mockImplementation((_id, signal) => {
      if (signal) restoreSignals.push(signal);
      return pendingUntilAbort(signal);
    });

    const project = makeProject();
    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
    );

    // Start both ops in flight.
    act(() => {
      void result.current.openTrash();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));
    act(() => {
      void result.current.handleRestore("ch-x");
    });
    await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(1));

    const trashSignal1 = trashSignals[0];
    const restoreSignal1 = restoreSignals[0];
    expect(trashSignal1?.aborted).toBe(false);
    expect(restoreSignal1?.aborted).toBe(false);

    // Fire a second openTrash. It aborts the prior trash controller via
    // trashOp; restore controller is untouched.
    act(() => {
      void result.current.openTrash();
    });
    await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(2));
    expect(trashSignal1?.aborted).toBe(true);
    expect(restoreSignal1?.aborted).toBe(false);

    // Fire a second handleRestore. It aborts the prior restore controller
    // via restoreOp; the just-allocated second trash controller is
    // untouched.
    act(() => {
      void result.current.handleRestore("ch-y");
    });
    await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(2));
    expect(restoreSignal1?.aborted).toBe(true);
    // Sanity: the second trash signal (allocated by the second openTrash)
    // is still fresh — handleRestore did not reach into trashOp.
    expect(trashSignals[1]?.aborted).toBe(false);
  });
});

describe("handleRestore possiblyCommitted (4b.3c.3 I4)", () => {
  it("on 200 BAD_JSON, fires a recovery GET, merges the refreshed project, and reseeds the confirmed-status cache", async () => {
    // The committed-recovery branch optimistically removes the row from
    // trashedChapters (existing I2/S8 behaviour), AND now (4b.3c.3 I4)
    // fires api.projects.get so the sidebar reflects server-truth state
    // and the confirmed-status cache is reseeded.
    const deleted = makeChapter({ id: "ch-pin-i4" });
    const project = makeProject();
    const refreshed: ProjectWithChapters = {
      ...project,
      chapters: [
        makeChapter({
          id: "ch-pin-i4",
          status: "outline",
          deleted_at: null,
          sort_order: 0,
        }),
      ],
    };
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();
    const seedConfirmedStatus = vi.fn();
    const replaceConfirmedStatusesFromProject = vi.fn();

    vi.mocked(api.chapters.restore).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.trash).mockResolvedValue([deleted]);
    vi.mocked(api.projects.get).mockResolvedValue(refreshed);

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, handleDeleteChapter, navigate, {
        seedConfirmedStatus,
        replaceConfirmedStatusesFromProject,
      }),
    );

    await act(async () => {
      await result.current.openTrash();
    });

    await act(async () => {
      await result.current.handleRestore("ch-pin-i4");
    });

    // Optimistic drop (carried over from existing I2 behaviour).
    await waitFor(() => {
      expect(result.current.trashedChapters.find((c) => c.id === "ch-pin-i4")).toBeUndefined();
    });
    expect(result.current.actionError).toBe(STRINGS.error.restoreChapterCommitted);
    // Recovery GET fires against the committed-restore slug.
    await waitFor(() => {
      expect(api.projects.get).toHaveBeenCalledTimes(1);
    });
    expect(api.projects.get).toHaveBeenCalledWith(project.slug, expect.any(AbortSignal));
    // Bulk reseed runs against the refreshed snapshot.
    await waitFor(() => {
      expect(replaceConfirmedStatusesFromProject).toHaveBeenCalledTimes(1);
    });
    expect(replaceConfirmedStatusesFromProject).toHaveBeenCalledWith(refreshed);
    // The setProject updater is invoked; calling it with the prior
    // project state must return the refreshed snapshot.
    expect(setProject).toHaveBeenCalled();
    const updater = setProject.mock.calls.at(-1)?.[0] as (
      prev: ProjectWithChapters | null,
    ) => ProjectWithChapters | null;
    expect(updater(project)).toBe(refreshed);
    // Identity guard: if the user navigated to a different project, the
    // refreshed snapshot must NOT clobber the new project's state.
    const otherProject: ProjectWithChapters = { ...project, id: "other-project" };
    expect(updater(otherProject)).toBe(otherProject);
  });

  it("T1 (review 2026-05-27): restoreRecoveryAbortRef is nulled on success — subsequent restore's preamble does not re-abort the prior controller", async () => {
    // Indirect assertion mirrors S17 (useProjectEditor createRecoveryAbortRef)
    // and S19 (useSnapshotState restoreFollowupAbortRef): after the
    // recovery GET .then resolves, the ref is nulled. A second
    // committed restore calls `restoreRecoveryAbortRef.current?.abort()`
    // at the top of its recovery branch; if the prior ref is null,
    // that's a no-op and the first recovery controller's signal stays
    // unaborted. Without the T1 fix the prior ref still points at the
    // completed controller, and the second call's preamble .abort()
    // would flip the prior signal to aborted.
    const deletedA = makeChapter({ id: "ch-a" });
    const deletedB = makeChapter({ id: "ch-b" });
    const project = makeProject();
    const refreshed: ProjectWithChapters = {
      ...project,
      chapters: [
        makeChapter({ id: "ch-a", deleted_at: null, sort_order: 0 }),
        makeChapter({ id: "ch-b", deleted_at: null, sort_order: 1 }),
      ],
    };
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();
    const replaceConfirmedStatusesFromProject = vi.fn();

    vi.mocked(api.chapters.restore).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.trash).mockResolvedValue([deletedA, deletedB]);
    const recoverySignals: AbortSignal[] = [];
    vi.mocked(api.projects.get).mockImplementation((_slug, signal) => {
      if (signal) recoverySignals.push(signal);
      return Promise.resolve(refreshed);
    });

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, handleDeleteChapter, navigate, {
        replaceConfirmedStatusesFromProject,
      }),
    );

    await act(async () => {
      await result.current.openTrash();
    });

    // First committed restore — captures the first recovery signal.
    await act(async () => {
      await result.current.handleRestore("ch-a");
    });
    await waitFor(() => {
      expect(recoverySignals).toHaveLength(1);
    });
    const firstSignal = recoverySignals[0];
    expect(firstSignal?.aborted).toBe(false);

    // Second committed restore — its recovery preamble runs
    // `restoreRecoveryAbortRef.current?.abort()`. Post-T1 the ref is null,
    // so the prior (completed) signal stays unaborted.
    await act(async () => {
      await result.current.handleRestore("ch-b");
    });
    await waitFor(() => {
      expect(recoverySignals).toHaveLength(2);
    });

    expect(firstSignal?.aborted).toBe(false);
    expect(recoverySignals[1]?.aborted).toBe(false);
  });

  it("I1 (review 2026-05-27): replaceConfirmedStatusesFromProject is NOT called after A→B nav during the recovery GET", async () => {
    // Pre-fix: setProject's identity-guard updater correctly bailed when
    // prev (project B) didn't match refreshed (A's data), but the next
    // line `replaceConfirmedStatusesRef.current?.(refreshed)` ran
    // unconditionally and wiped B's confirmed-status cache with A's
    // chapter→status mapping — the C2 cache-corruption hazard. Post-fix:
    // a projectRef captured sync-on-render gates BOTH setProject and
    // the reseed by current-project identity. The reseed is only
    // invoked when the user is still on the project whose recovery
    // GET just resolved.
    const deletedA = makeChapter({ id: "ch-a", project_id: "p1" });
    const projectA = makeProject();
    const projectB: ProjectWithChapters = {
      ...projectA,
      id: "p2",
      slug: "project-2",
      chapters: [],
    };
    const refreshedA: ProjectWithChapters = {
      ...projectA,
      chapters: [makeChapter({ id: "ch-a", deleted_at: null, sort_order: 0 })],
    };
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();
    const replaceConfirmedStatusesFromProject = vi.fn();

    vi.mocked(api.chapters.restore).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.trash).mockResolvedValue([deletedA]);

    // Defer the recovery GET so we can rerender with project B BEFORE
    // .then resolves.
    let resolveGet!: (p: ProjectWithChapters) => void;
    vi.mocked(api.projects.get).mockImplementation(
      () => new Promise<ProjectWithChapters>((resolve) => (resolveGet = resolve)),
    );

    const { rerender, result } = renderHook(
      ({ project, slug }: { project: ProjectWithChapters; slug: string }) =>
        useTrashManager(project, slug, setProject, handleDeleteChapter, navigate, {
          replaceConfirmedStatusesFromProject,
        }),
      { initialProps: { project: projectA, slug: projectA.slug } },
    );

    await act(async () => {
      await result.current.openTrash();
    });

    // Trigger the committed-recovery branch. The catch fires synchronously
    // off the mockRejectedValue, the recovery GET is dispatched, but it
    // stays pending until we call resolveGet below.
    await act(async () => {
      await result.current.handleRestore("ch-a");
    });

    expect(api.projects.get).toHaveBeenCalledTimes(1);
    expect(replaceConfirmedStatusesFromProject).not.toHaveBeenCalled();

    // Navigate A → B while the recovery GET is still in flight.
    rerender({ project: projectB, slug: projectB.slug });

    // Now resolve the GET with A's refreshed data.
    await act(async () => {
      resolveGet(refreshedA);
      await Promise.resolve();
    });

    // Identity-guard pin: the reseed must NOT have run, because the
    // user is on project B and A's snapshot would corrupt B's cache.
    expect(replaceConfirmedStatusesFromProject).not.toHaveBeenCalled();
  });

  it("I2 (review 2026-05-27): Restore-A's recovery GET does NOT clobber Restore-B's successful state", async () => {
    // Pre-fix: restoreRecoveryAbortRef was deliberately separate from
    // restoreOp so a recovery GET from a prior failed restore survived
    // the next handleRestore's restoreOp.abort(). Exploitable
    // sequence: Restore-A returns 200 BAD_JSON → recovery GET-A
    // fires. Before GET-A resolves, user clicks Restore-B; B's POST
    // succeeds and setProject merges B's chapter. GET-A finally
    // resolves with a snapshot captured BEFORE B's restore landed
    // (no ch-b in the chapter list). Without I2's sequence-version
    // guard, that stale snapshot would have been written into
    // project state, silently dropping B's restored chapter from
    // the sidebar. Post-fix: useAbortableSequence's token captured
    // at Restore-A start goes stale when Restore-B's start() bumps
    // the epoch; GET-A's .then bails before touching state.
    const deletedA = makeChapter({ id: "ch-a" });
    const deletedB = makeChapter({ id: "ch-b" });
    const restoredB = makeChapter({
      id: "ch-b",
      project_id: "p1",
      deleted_at: null,
      sort_order: 1,
    });
    const project = makeProject();
    const staleSnapshotA: ProjectWithChapters = {
      ...project,
      chapters: [makeChapter({ id: "ch-a", deleted_at: null, sort_order: 0 })],
    };
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();
    const replaceConfirmedStatusesFromProject = vi.fn();

    // Restore-A rejects 200 BAD_JSON; Restore-B resolves with the
    // restored chapter.
    vi.mocked(api.chapters.restore)
      .mockReset()
      .mockImplementation((chapterId: string) => {
        if (chapterId === "ch-a") {
          return Promise.reject(new ApiRequestError("bad body", 200, "BAD_JSON"));
        }
        return Promise.resolve({ ...restoredB, project_slug: project.slug });
      });
    vi.mocked(api.projects.trash).mockResolvedValue([deletedA, deletedB]);

    // Defer the recovery GET so Restore-B can run before GET-A
    // resolves.
    let resolveGetA!: (p: ProjectWithChapters) => void;
    vi.mocked(api.projects.get).mockImplementation(
      () => new Promise<ProjectWithChapters>((resolve) => (resolveGetA = resolve)),
    );

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, setProject, handleDeleteChapter, navigate, {
        replaceConfirmedStatusesFromProject,
      }),
    );

    await act(async () => {
      await result.current.openTrash();
    });

    // Fire Restore-A → catch → recovery GET-A scheduled (pending).
    await act(async () => {
      await result.current.handleRestore("ch-a");
    });
    expect(api.projects.get).toHaveBeenCalledTimes(1);
    expect(replaceConfirmedStatusesFromProject).not.toHaveBeenCalled();

    // Fire Restore-B → resolves immediately → setProject merges B.
    await act(async () => {
      await result.current.handleRestore("ch-b");
    });
    const setProjectCallsBefore = setProject.mock.calls.length;

    // Now resolve A's recovery GET with a stale snapshot (no ch-b).
    await act(async () => {
      resolveGetA(staleSnapshotA);
      await Promise.resolve();
    });

    // Sequence guard: the stale GET-A response must be discarded —
    // setProject must NOT have received a new updater call after
    // Restore-B's merge, and the reseed must NOT have fired with
    // the stale snapshot.
    expect(setProject.mock.calls.length).toBe(setProjectCallsBefore);
    expect(replaceConfirmedStatusesFromProject).not.toHaveBeenCalledWith(staleSnapshotA);
  });
});

describe("handleRestore cross-project nav guard (review 2026-05-27 round 2)", () => {
  it("does NOT set actionError when project changes mid-restore-failure", async () => {
    // Pre-fix: handleRestore's catch passed `mapped` to
    // `applyMappedError(..., { onMessage: setActionError })` unconditionally.
    // The committed sub-branch's setProject already gated on
    // projectRef-vs-refreshed.id, but the actionError banner did not.
    // Reachable sequence: user clicks Restore on project A → navigates
    // A → B before the POST settles → POST rejects (any non-ABORTED
    // failure) → catch runs while projectRef.current points at B →
    // setActionError fires the restore-failure copy on B for an event
    // that happened on A. Confusing and unactionable.
    // Post-fix: capture project id at handleRestore entry; the catch
    // bails before applyMappedError when projectRef has drifted away
    // from the captured id.
    const projectA = makeProject();
    const projectB: ProjectWithChapters = {
      ...projectA,
      id: "p2",
      slug: "project-2",
      chapters: [],
    };
    const deletedA = makeChapter({ id: "ch-a" });
    const setProject = vi.fn();
    const navigate = vi.fn();
    const handleDeleteChapter = vi.fn();

    // Defer the restore POST so we can navigate A → B before the catch
    // fires.
    let rejectRestore!: (err: Error) => void;
    vi.mocked(api.chapters.restore).mockImplementation(
      () =>
        new Promise<Chapter>((_resolve, reject) => {
          rejectRestore = reject;
        }),
    );
    vi.mocked(api.projects.trash).mockResolvedValue([deletedA]);

    const { rerender, result } = renderHook(
      ({ project, slug }: { project: ProjectWithChapters; slug: string }) =>
        useTrashManager(project, slug, setProject, handleDeleteChapter, navigate),
      { initialProps: { project: projectA, slug: projectA.slug } },
    );

    await act(async () => {
      await result.current.openTrash();
    });

    // Fire the restore — POST stays pending until rejectRestore is called.
    let restorePromise!: Promise<void>;
    act(() => {
      restorePromise = result.current.handleRestore("ch-a");
    });

    // Navigate A → B while the POST is still in flight. The hook
    // re-renders with project B; projectRef.current now points at B.
    rerender({ project: projectB, slug: projectB.slug });

    // Reject the POST with a non-committed failure (500 with no
    // committed code maps to a recoverable error path, not the
    // possiblyCommitted branch). The catch fires while the user is on B.
    await act(async () => {
      rejectRestore(new ApiRequestError("server gone", 500, "INTERNAL_ERROR"));
      await restorePromise;
    });

    // Identity guard: the catch must have bailed before applyMappedError,
    // so B's UI does not flash a banner about an event that happened on A.
    expect(result.current.actionError).toBeNull();
  });
});

describe("useTrashManager.confirmDeleteChapter — I5 programming-bug warn (4b.3c.2)", () => {
  it("dismisses the dialog AND warns when handleDeleteChapter throws unexpectedly", async () => {
    // handleDeleteChapter is contracted to surface ALL API errors via its
    // onError callback (never as a throw); the bare catch in
    // confirmDeleteChapter exists only to keep the dialog from hanging
    // open if a programming bug introduces a throw. Pre-I5 the catch was
    // silent; this test pins the new console.warn so the programming-bug
    // path is observable in dev.
    const target = makeChapter({ id: "ch-target" });
    const project = makeProject();
    const handleDeleteChapter = vi.fn().mockRejectedValue(new Error("synthetic programming bug"));

    const { result } = renderHook(() =>
      useTrashManager(project, project.slug, vi.fn(), handleDeleteChapter, vi.fn()),
    );

    act(() => {
      result.current.setDeleteTarget(target);
    });

    await act(async () => {
      await result.current.confirmDeleteChapter();
    });

    // handleDeleteChapter was reached — the bug surfaces via its throw.
    expect(handleDeleteChapter).toHaveBeenCalledWith(target, expect.any(Function));
    // Dialog dismissed so the user isn't stuck behind a dead confirm.
    expect(result.current.deleteTarget).toBeNull();
    // The programming-bug path warns with a named context string.
    expect(warnSpy).toHaveBeenCalledWith(
      "confirmDeleteChapter programming-bug path:",
      expect.any(Error),
    );
  });
});
