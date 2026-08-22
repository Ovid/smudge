import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { Chapter } from "@smudge/shared";
import { SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { useSnapshotController, type SnapshotControllerDeps } from "../useSnapshotController";
import type { useEditorMutation, MutationResult } from "../useEditorMutation";
import type { useFindReplaceState } from "../useFindReplaceState";
import type { EditorHandle } from "../../components/Editor";
import { ApiRequestError } from "../../api/client";
import { STRINGS } from "../../strings";
import { expectConsole } from "../../__tests__/expectConsole";
import { safeSetEditable, quiesceEditorForServerOp } from "../../utils/editorSafeOps";
import { clearCachedContent } from "../useContentCache";

// F-02 (architecture report 2026-08-11): useSnapshotController was the
// lowest-covered non-migration source file in the repo (68.5% statements /
// 48.9% branches) and had no test file of its own, while its sibling
// useFindReplaceController did. Snapshot restore is one of the two
// server-mutation flows CLAUDE.md singles out as load-bearing, so the
// uncovered branches were the lock/busy refusals, the whole
// committed_but_unreloaded arm, the stale-chapter-switch return, flush-failure
// attribution, and the entire snapshot.view error ladder.
//
// EditorPageFeatures.test.tsx:3481 argues one of these races is unreachable at
// component scope "because the surrounding busy guard blocks every user-facing
// chapter-switch path" — which is precisely the argument for a hook-level test,
// so the branches are driven here directly through the deps interface.
//
// mapApiError is deliberately NOT mocked: the message and possiblyCommitted /
// transient classifications come from the real scope registry, so these tests
// break if scopes.ts drifts away from what the controller expects.

vi.mock("../../utils/editorSafeOps", () => ({
  safeSetEditable: vi.fn(),
  quiesceEditorForServerOp: vi.fn(async () => true),
}));

vi.mock("../useContentCache", () => ({
  clearCachedContent: vi.fn(),
}));

const mockQuiesce = vi.mocked(quiesceEditorForServerOp);
const mockSafeSetEditable = vi.mocked(safeSetEditable);
const mockClearCachedContent = vi.mocked(clearCachedContent);

type RestoreData = { staleChapterSwitch: boolean };
/** The shape handleRestoreSnapshot's mutate callback returns to useEditorMutation. */
type MutateSpec = {
  clearCacheFor: string[];
  reloadActiveChapter: boolean;
  reloadChapterId?: string;
  data: RestoreData;
};

function chapterWithId(id: string): Chapter {
  return {
    id,
    project_id: "p1",
    title: `Chapter ${id}`,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    sort_order: 0,
    word_count: 0,
    status: "outline",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
  };
}

const SNAP = { id: "snap-1", label: "Before the cut", created_at: "2026-01-02" };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = () => {
      r();
    };
  });
  return { promise, resolve };
}

interface HarnessOptions {
  /** Canned result from mutation.run. When omitted, run() invokes the real mutate callback. */
  runResult?: MutationResult<RestoreData>;
  /** Result of useSnapshotState.restoreSnapshot, used when run() invokes the callback. */
  restoreResult?:
    | { ok: true; staleChapterSwitch?: boolean; droppedImageCount?: number }
    | { ok: false; error: ApiRequestError };
  viewResult?:
    | { ok: true; superseded?: "chapter" | "sameChapterNewer" }
    | { ok: false; error: ApiRequestError };
  locked?: boolean;
  busy?: boolean;
  /** Live active chapter, for the possibly-committed drift check. Defaults to the restore target. */
  currentChapterId?: string | null;
  /** Held open inside mutation.run before the mutate callback runs. */
  gate?: Promise<void>;
}

function buildHarness(opts: HarnessOptions = {}) {
  const activeChapter = chapterWithId("ch-1");

  const setActionError = vi.fn();
  const setActionInfo = vi.fn();
  const applyReloadFailedLock = vi.fn();
  const refreshSnapshotCount = vi.fn();
  const refreshSnapshots = vi.fn();
  const exitSnapshotView = vi.fn();
  const clearError = vi.fn();
  const cancelPendingSaves = vi.fn();

  /** Captures what the mutate callback asked useEditorMutation to do. */
  const mutateSpecs: MutateSpec[] = [];

  const restoreSnapshot = vi.fn(
    async () => opts.restoreResult ?? ({ ok: true } as const),
  ) as unknown as SnapshotControllerDeps["restoreSnapshot"];

  const viewSnapshot = vi.fn(
    async () => opts.viewResult ?? ({ ok: true } as const),
  ) as unknown as SnapshotControllerDeps["viewSnapshot"];

  const mutation = {
    // Faithful stand-in for useEditorMutation.run: it actually invokes the
    // mutate callback (so the callback's own branches — RestoreAbortedError,
    // the stale-chapter return, the reloadChapterId scoping — are exercised)
    // and maps a throw to stage:"mutate", exactly as the real hook does.
    run: vi.fn(async (cb: () => Promise<MutateSpec>): Promise<MutationResult<RestoreData>> => {
      if (opts.gate) await opts.gate;
      // I2 (agentic review 2026-08-17): stage ORDER matters. "busy" and
      // "flush" are reached BEFORE the mutate callback ever runs; every other
      // stage is reached strictly AFTER it succeeded. Returning runResult
      // unconditionally made the stand-in unfaithful for the post-mutate
      // stages — the callback's side effects (droppedImageCount) were never
      // assigned, so a bug that loses them shipped green. Run the callback
      // first for those, mirroring the real hook.
      if (opts.runResult) {
        const preMutate =
          opts.runResult.ok === false &&
          (opts.runResult.stage === "busy" || opts.runResult.stage === "flush");
        if (preMutate) return opts.runResult;
        try {
          mutateSpecs.push(await cb());
        } catch (error) {
          return { ok: false, stage: "mutate", error };
        }
        return opts.runResult;
      }
      try {
        const spec = await cb();
        mutateSpecs.push(spec);
        return { ok: true, data: spec.data };
      } catch (error) {
        return { ok: false, stage: "mutate", error };
      }
    }),
    isBusy: vi.fn(() => false),
  } as unknown as ReturnType<typeof useEditorMutation>;

  const actionBusyRef: MutableRefObject<boolean> = { current: false };
  const editorRef: MutableRefObject<EditorHandle | null> = { current: null };

  const baseDeps = {
    activeChapter,
    restoreSnapshot,
    viewSnapshot,
    exitSnapshotView,
    snapshotPanelRef: {
      current: { refreshSnapshots },
    } as unknown as SnapshotControllerDeps["snapshotPanelRef"],
    refreshSnapshotCount,
    cancelPendingSaves,
    mutation,
    findReplace: { clearError } as unknown as ReturnType<typeof useFindReplaceState>,
    getActiveChapter: () =>
      opts.currentChapterId === undefined
        ? activeChapter
        : opts.currentChapterId === null
          ? null
          : chapterWithId(opts.currentChapterId),
    editorRef,
    isEditorLocked: () => opts.locked ?? false,
    isActionBusy: () => opts.busy ?? false,
    actionBusyRef,
    applyReloadFailedLock,
    setActionError,
    setActionInfo,
  };

  const rendered = renderHook(
    ({ viewingSnapshot }: { viewingSnapshot: typeof SNAP | null }) =>
      useSnapshotController({
        ...baseDeps,
        viewingSnapshot,
      } as unknown as SnapshotControllerDeps),
    { initialProps: { viewingSnapshot: SNAP as typeof SNAP | null } },
  );

  return {
    ...rendered,
    activeChapter,
    actionBusyRef,
    mutation,
    mutateSpecs,
    restoreSnapshot,
    viewSnapshot,
    setActionError,
    setActionInfo,
    applyReloadFailedLock,
    refreshSnapshotCount,
    refreshSnapshots,
    exitSnapshotView,
    clearError,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuiesce.mockResolvedValue(true);
});

describe("useSnapshotController — handleRestoreSnapshot entry guards", () => {
  it("does nothing when no snapshot is being viewed", async () => {
    const h = buildHarness();
    h.rerender({ viewingSnapshot: null });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.mutation.run).not.toHaveBeenCalled();
    expect(h.setActionInfo).not.toHaveBeenCalled();
  });

  it("refuses with the lock refusal — not a busy message — while the editor is locked", async () => {
    // I1 (dedup review 2026-07-26): a lock is not a busy state. Nothing is in
    // flight and waiting never clears it, so the copy must say refresh.
    const h = buildHarness({ locked: true });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionInfo).toHaveBeenCalledWith(STRINGS.editor.lockedRefusal);
    expect(h.mutation.run).not.toHaveBeenCalled();
  });

  it("refuses with the busy banner while another action is in flight", async () => {
    const h = buildHarness({ busy: true });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionInfo).toHaveBeenCalledWith(STRINGS.editor.mutationBusy);
    expect(h.mutation.run).not.toHaveBeenCalled();
  });

  it("clears stale banners and the panel-local search error on entry", async () => {
    const h = buildHarness();

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionError).toHaveBeenCalledWith(null);
    expect(h.setActionInfo).toHaveBeenCalledWith(null);
    expect(h.clearError).toHaveBeenCalled();
  });

  it("releases the action-busy latch even when the mutation reports a failure", async () => {
    const h = buildHarness({ runResult: { ok: false, stage: "busy" } });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.actionBusyRef.current).toBe(false);
  });
});

describe("useSnapshotController — handleRestoreSnapshot mutate callback", () => {
  it("aborts the server restore when the user leaves snapshot view during the flush", async () => {
    // The re-check happens AFTER useEditorMutation's flush/markClean, so the
    // user can click "Back to editing" inside that window. Held open with a
    // gate so the rerender lands before the callback reads its ref.
    const gate = deferred();
    const h = buildHarness({ gate: gate.promise });

    let pending!: Promise<void>;
    act(() => {
      pending = h.result.current.handleRestoreSnapshot();
    });

    h.rerender({ viewingSnapshot: null });

    await act(async () => {
      gate.resolve();
      await pending;
    });

    expect(h.restoreSnapshot).not.toHaveBeenCalled();
    // A silent no-op: the user asked for this by leaving the view.
    expect(h.setActionError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("scopes the cache clear and reload to the restore target on the happy path", async () => {
    const h = buildHarness({ restoreResult: { ok: true } });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.mutateSpecs[0]).toEqual({
      clearCacheFor: ["ch-1"],
      // F-07: the copy and drift reference point the seam needs to settle the
      // committed path itself. targetChapterId is the RESTORE target, matching
      // reloadChapterId below and for the same reason — the restore was about a
      // specific chapter's snapshot, not whichever chapter is active on return.
      committedLock: {
        message: STRINGS.snapshots.restoreSucceededReloadFailed,
        targetChapterId: "ch-1",
      },
      reloadActiveChapter: true,
      reloadChapterId: "ch-1",
      data: { staleChapterSwitch: false },
    });
    expect(h.refreshSnapshots).toHaveBeenCalled();
    expect(h.refreshSnapshotCount).toHaveBeenCalled();
  });

  it("announces when the restore dropped images that no longer exist (F-05)", async () => {
    // This is the one path where a restore returns something other than what
    // was saved. Silence here would make it an unannounced content edit.
    const h = buildHarness({ restoreResult: { ok: true, droppedImageCount: 2 } });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionInfo).toHaveBeenLastCalledWith(STRINGS.snapshots.restoreDroppedImages(2));
  });

  it("says nothing about images when the restore was byte-exact", async () => {
    const h = buildHarness({ restoreResult: { ok: true } });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    // Only the entry-clearing setActionInfo(null) call.
    expect(h.setActionInfo).toHaveBeenCalledTimes(1);
    expect(h.setActionInfo).toHaveBeenCalledWith(null);
  });

  it("still announces dropped images when the user has switched chapters (F-05)", async () => {
    const h = buildHarness({
      restoreResult: { ok: true, staleChapterSwitch: true, droppedImageCount: 1 },
    });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionInfo).toHaveBeenLastCalledWith(STRINGS.snapshots.restoreDroppedImages(1));
  });

  it("attributes the dropped-image notice to its chapter when the user moved away (S2)", async () => {
    // The stale arm's notice is the only banner that arm raises, and the user
    // is looking at a different chapter — unattributed, it reads as a claim
    // about the chapter on screen.
    const h = buildHarness({
      restoreResult: { ok: true, staleChapterSwitch: true, droppedImageCount: 1 },
      currentChapterId: "ch-2",
    });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionInfo).toHaveBeenLastCalledWith(
      STRINGS.snapshots.restoreDroppedImagesOnOtherChapter(1, "Chapter ch-1"),
    );
  });

  it("still announces dropped images when the reload could not confirm the restore (I2)", async () => {
    // The server committed a restore that dropped images, then the follow-up
    // GET failed. This is the arm where the user is LEAST able to see the
    // change themselves — the editor is locked and they are told to refresh.
    // Losing the notice here means they refresh into missing images with no
    // explanation.
    const h = buildHarness({
      restoreResult: { ok: true, droppedImageCount: 2 },
      runResult: {
        ok: false,
        stage: "committed_but_unreloaded",
        data: { staleChapterSwitch: false },
        drifted: false,
      },
    });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionInfo).toHaveBeenCalledWith(STRINGS.snapshots.restoreDroppedImages(2));
    // ...and the lock banner still goes up alongside it — since F-07 raised by
    // the seam rather than from here, so what this arm must not do is dispatch
    // a competing transition of its own. The two still occupy separate slots.
    expect(h.applyReloadFailedLock).not.toHaveBeenCalled();
  });

  it("does not pin the lock banner to an unrelated chapter when the target drifted (OOSS1)", async () => {
    // OOSS1 (agentic review 2026-08-18): this arm called applyReloadFailedLock
    // unconditionally while both siblings guard first — useFindReplaceController
    // computes `stale`, and this file's 2xx-BAD_JSON arm compares
    // getActiveChapter()?.id. On drift the persistent, NON-dismissible banner
    // pinned to and disabled a chapter the restore never touched. Simply
    // skipping the lock is not enough: committed_but_unreloaded leaves the
    // machine at editable:false (the hook dispatches no terminal event there),
    // so the re-assert is what keeps the unrelated editor from being stranded
    // read-only with no banner explaining why.
    const h = buildHarness({
      currentChapterId: "ch-2",
      runResult: {
        ok: false,
        stage: "committed_but_unreloaded",
        data: { staleChapterSwitch: false },
        drifted: true,
      },
    });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    // F-07: the seam already re-enabled the unrelated editor, so this arm must
    // dispatch nothing. What it still owns is the chapter-attributed notice —
    // without it the user is never told which chapter changed under them.
    expect(h.applyReloadFailedLock).not.toHaveBeenCalled();
    expect(h.setActionError).toHaveBeenLastCalledWith(
      STRINGS.snapshots.restoreSucceededReloadFailedOnOtherChapter(h.activeChapter.title),
    );
    // The restore target's cache is still stale — clear it regardless of drift.
    expect(mockClearCachedContent).toHaveBeenCalledWith("ch-1");
    expect(h.refreshSnapshotCount).toHaveBeenCalled();
  });

  it("still locks when the user is on the chapter the restore targeted", async () => {
    const h = buildHarness({
      runResult: {
        ok: false,
        stage: "committed_but_unreloaded",
        data: { staleChapterSwitch: false },
        drifted: false,
      },
    });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    // F-07: the lock is raised by the seam, which carries this flow's copy in
    // the directive's committedLock. Dispatching here too would be a second
    // transition on an already-settled machine.
    expect(h.applyReloadFailedLock).not.toHaveBeenCalled();
  });

  it("skips the cache clear and the active-chapter reload on a stale chapter switch", async () => {
    // The restore landed on a now-background chapter: reloading the active
    // chapter would pull the wrong chapter's server state over the user's draft.
    const h = buildHarness({ restoreResult: { ok: true, staleChapterSwitch: true } });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.mutateSpecs[0]).toEqual({
      clearCacheFor: [],
      committedLock: {
        message: STRINGS.snapshots.restoreSucceededReloadFailed,
        targetChapterId: "ch-1",
      },
      reloadActiveChapter: false,
      data: { staleChapterSwitch: true },
    });
    // No panel refresh either — the user is not looking at this chapter.
    expect(h.refreshSnapshots).not.toHaveBeenCalled();
    expect(h.refreshSnapshotCount).not.toHaveBeenCalled();
  });
});

describe("useSnapshotController — handleRestoreSnapshot result stages", () => {
  it("surfaces the busy banner rather than dead-buttoning during save backoff", async () => {
    const h = buildHarness({ runResult: { ok: false, stage: "busy" } });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionInfo).toHaveBeenLastCalledWith(STRINGS.editor.mutationBusy);
  });

  it("attributes a flush-stage failure to the save, not the restore", async () => {
    const h = buildHarness({ runResult: { ok: false, stage: "flush", error: new Error("nope") } });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionError).toHaveBeenLastCalledWith(STRINGS.snapshots.restoreFailedSaveFirst);
  });

  it("raises the persistent lock banner and clears the cache when the reload cannot confirm the restore", async () => {
    const h = buildHarness({
      runResult: {
        ok: false,
        stage: "committed_but_unreloaded",
        data: { staleChapterSwitch: false },
        drifted: false,
      },
    });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    // F-07: the banner is the seam's; the cache clear and the panel refreshes
    // below are what this arm still owns.
    expect(h.applyReloadFailedLock).not.toHaveBeenCalled();
    expect(mockClearCachedContent).toHaveBeenCalledWith("ch-1");
    expect(h.refreshSnapshots).toHaveBeenCalled();
    // The server wrote a pre-restore auto-snapshot; the badge is stale by one.
    expect(h.refreshSnapshotCount).toHaveBeenCalled();
  });

  it("falls back to generic restore copy for a mutate throw that is not a restore failure", async () => {
    const h = buildHarness({
      runResult: { ok: false, stage: "mutate", error: new Error("something else") },
    });

    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });

    expect(h.setActionError).toHaveBeenLastCalledWith(STRINGS.snapshots.restoreFailed);
  });
});

describe("useSnapshotController — handleRestoreSnapshot error ladder", () => {
  async function restoreFailingWith(error: ApiRequestError, extra: HarnessOptions = {}) {
    const h = buildHarness({ restoreResult: { ok: false, error }, ...extra });
    await act(async () => {
      await h.result.current.handleRestoreSnapshot();
    });
    return h;
  }

  it("stays silent on an aborted restore", async () => {
    const h = await restoreFailingWith(new ApiRequestError("aborted", 0, "ABORTED"));

    // setActionError(null) on entry is the only call; no message is surfaced.
    expect(h.setActionError).toHaveBeenCalledTimes(1);
    expect(h.setActionError).toHaveBeenCalledWith(null);
    expect(h.exitSnapshotView).not.toHaveBeenCalled();
  });

  it("keeps the banner open on a network failure so the user can retry", async () => {
    const h = await restoreFailingWith(new ApiRequestError("offline", 0, "NETWORK"));

    expect(h.setActionError).toHaveBeenLastCalledWith(STRINGS.snapshots.restoreNetworkFailed);
    // Transient: the snapshot is still restorable once the connection returns.
    expect(h.exitSnapshotView).not.toHaveBeenCalled();
    expect(h.refreshSnapshots).toHaveBeenCalled();
  });

  it.each([
    [
      "a corrupt snapshot",
      SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT,
      409,
      STRINGS.snapshots.restoreFailedCorrupt,
    ],
    [
      "a cross-project image reference",
      SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF,
      409,
      STRINGS.snapshots.restoreFailedCrossProjectImage,
    ],
  ])(
    "dismisses the banner on %s so the user cannot loop on Restore",
    async (_l, code, status, copy) => {
      const h = await restoreFailingWith(new ApiRequestError("nope", status, code));

      expect(h.setActionError).toHaveBeenLastCalledWith(copy);
      expect(h.exitSnapshotView).toHaveBeenCalled();
      expect(h.refreshSnapshots).toHaveBeenCalled();
    },
  );

  it("dismisses the banner and refreshes the list on a 404 so the stale row stops being clickable", async () => {
    const h = await restoreFailingWith(new ApiRequestError("gone", 404, "NOT_FOUND"));

    expect(h.setActionError).toHaveBeenLastCalledWith(STRINGS.snapshots.restoreFailedNotFound);
    expect(h.exitSnapshotView).toHaveBeenCalled();
    expect(h.refreshSnapshots).toHaveBeenCalled();
  });

  it("falls back to generic restore copy for a failure carrying no discriminating code", async () => {
    // RestoreFailedError's message degrades to the status when `code` is
    // absent, and the scope registry has no byCode/byStatus entry to match.
    const h = await restoreFailingWith(new ApiRequestError("boom", 500));

    expect(h.setActionError).toHaveBeenLastCalledWith(STRINGS.snapshots.restoreFailed);
    expect(h.exitSnapshotView).toHaveBeenCalled();
  });

  it("locks the editor when the response was unreadable and the user is still on the restored chapter", async () => {
    // 2xx BAD_JSON: the restore probably committed but the body was unreadable.
    // Retrying could double-restore, so this is pessimistic by design.
    const h = await restoreFailingWith(new ApiRequestError("bad json", 200, "BAD_JSON"));

    expect(mockClearCachedContent).toHaveBeenCalledWith("ch-1");
    expect(h.applyReloadFailedLock).toHaveBeenCalledWith(
      STRINGS.snapshots.restoreResponseUnreadable,
    );
    expect(h.refreshSnapshotCount).toHaveBeenCalled();
  });

  it("attributes the unreadable response to the restored chapter when the user has navigated away", async () => {
    // I6 (review 2026-04-25): the mapped copy is chapter-agnostic, so pinning a
    // lock banner here would disable a chapter the restore never touched and
    // invite a refresh against the wrong context.
    const h = await restoreFailingWith(new ApiRequestError("bad json", 200, "BAD_JSON"), {
      currentChapterId: "ch-2",
    });

    expect(h.applyReloadFailedLock).not.toHaveBeenCalled();
    expect(h.setActionError).toHaveBeenLastCalledWith(
      STRINGS.snapshots.restoreResponseUnreadableOnOtherChapter(h.activeChapter.title),
    );
    // I4: leave snapshot view so Restore stops pointing at a chapter the user left.
    expect(h.exitSnapshotView).toHaveBeenCalled();
    expect(mockClearCachedContent).toHaveBeenCalledWith("ch-1");
  });
});

describe("useSnapshotController — onSnapshotView", () => {
  it("refuses while locked and tells the panel to suppress its own copy", async () => {
    const h = buildHarness({ locked: true });

    const out = await h.result.current.onSnapshotView(SNAP);

    expect(out).toEqual({ ok: false, reason: "locked" });
    expect(mockQuiesce).not.toHaveBeenCalled();
  });

  it("refuses while an action is in flight, surfacing the busy banner", async () => {
    const h = buildHarness({ busy: true });

    const out = await h.result.current.onSnapshotView(SNAP);

    expect(out).toBeUndefined();
    expect(h.setActionInfo).toHaveBeenCalledWith(STRINGS.editor.mutationBusy);
    expect(mockQuiesce).not.toHaveBeenCalled();
  });

  it("refuses to enter view mode when the pending save could not be flushed", async () => {
    mockQuiesce.mockResolvedValue(false);
    const h = buildHarness();

    const out = await h.result.current.onSnapshotView(SNAP);

    expect(out).toEqual({ ok: false, reason: "save_failed" });
    expect(h.viewSnapshot).not.toHaveBeenCalled();
  });

  it("disables the editor across the round trip and leaves it disabled on success", async () => {
    const h = buildHarness({ viewResult: { ok: true } });

    const out = await h.result.current.onSnapshotView(SNAP);

    expect(mockQuiesce).toHaveBeenCalledWith(expect.anything(), expect.any(Function), {
      disableEditor: true,
    });
    expect(out).toEqual({ ok: true });
    // Snapshot view is mounting; re-enabling would open a typing window.
    expect(mockSafeSetEditable).not.toHaveBeenCalled();
  });

  it("re-enables the editor when the view was superseded by a chapter switch", async () => {
    const h = buildHarness({ viewResult: { ok: true, superseded: "chapter" } });

    await h.result.current.onSnapshotView(SNAP);

    expect(mockSafeSetEditable).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("does NOT re-enable the editor when a newer view of the same chapter is still in flight", async () => {
    // Re-enabling here opens a typing window between this (older) response and
    // the newer one; those keystrokes would ride the unmount-cleanup PATCH.
    const h = buildHarness({ viewResult: { ok: true, superseded: "sameChapterNewer" } });

    await h.result.current.onSnapshotView(SNAP);

    expect(mockSafeSetEditable).not.toHaveBeenCalled();
  });

  it.each([
    ["corrupt_snapshot", new ApiRequestError("x", 409, SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT)],
    ["not_found", new ApiRequestError("x", 404, "NOT_FOUND")],
    ["network", new ApiRequestError("x", 0, "NETWORK")],
    ["unknown", new ApiRequestError("x", 500, "INTERNAL_ERROR")],
  ])("translates a failed view into reason %s for the panel", async (reason, error) => {
    const h = buildHarness({ viewResult: { ok: false, error } });

    const out = await h.result.current.onSnapshotView(SNAP);

    expect(out).toEqual({ ok: false, reason });
    expect(mockSafeSetEditable).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("falls through to unknown on an aborted view rather than leaving a dead button", async () => {
    // The panel has no silent-bail arm, so ABORTED must still produce copy.
    const h = buildHarness({
      viewResult: { ok: false, error: new ApiRequestError("x", 0, "ABORTED") },
    });

    const out = await h.result.current.onSnapshotView(SNAP);

    expect(out).toEqual({ ok: false, reason: "unknown" });
  });

  it("keeps the editor usable and warns when the flush throws synchronously", async () => {
    // TipTap can throw during a remount window; the onView contract is
    // {ok,reason} | undefined, not an exception channel.
    const warn = expectConsole("warn");
    mockQuiesce.mockRejectedValue(new Error("tiptap remount"));
    const h = buildHarness();

    const out = await h.result.current.onSnapshotView(SNAP);

    expect(out).toEqual({ ok: false, reason: "save_failed" });
    expect(mockSafeSetEditable).toHaveBeenCalledWith(expect.anything(), true);
    warn.calledWith("SnapshotPanel onView aborted:", expect.any(Error));
  });
});

describe("useSnapshotController — onSnapshotBeforeCreate", () => {
  it("refuses while locked so the panel does not contradict the lock banner", async () => {
    const h = buildHarness({ locked: true });

    await expect(h.result.current.onSnapshotBeforeCreate()).resolves.toEqual({
      ok: false,
      reason: "locked",
    });
    expect(mockQuiesce).not.toHaveBeenCalled();
  });

  it("refuses while an action is in flight, returning a discriminated busy outcome", async () => {
    // I5: without the reason tag the panel stamps createError on top of the
    // busy banner, producing two contradictory messages.
    const h = buildHarness({ busy: true });

    await expect(h.result.current.onSnapshotBeforeCreate()).resolves.toEqual({
      ok: false,
      reason: "busy",
    });
    expect(h.setActionInfo).toHaveBeenCalledWith(STRINGS.editor.mutationBusy);
  });

  it("marks the editor clean after flushing, without disabling it", async () => {
    // Snapshot create captures live content and does not overwrite the editor,
    // so it stays editable; markClean closes the keystroke-during-flush window.
    const h = buildHarness();

    await expect(h.result.current.onSnapshotBeforeCreate()).resolves.toEqual({ ok: true });
    expect(mockQuiesce).toHaveBeenCalledWith(expect.anything(), expect.any(Function), {
      markCleanAfter: true,
    });
  });

  it("reports flush_failed when the pending save could not be flushed", async () => {
    mockQuiesce.mockResolvedValue(false);
    const h = buildHarness();

    await expect(h.result.current.onSnapshotBeforeCreate()).resolves.toEqual({
      ok: false,
      reason: "flush_failed",
    });
  });

  it("reports flush_failed and warns when the flush throws instead of resolving", async () => {
    const warn = expectConsole("warn");
    mockQuiesce.mockRejectedValue(new Error("tiptap remount"));
    const h = buildHarness();

    await expect(h.result.current.onSnapshotBeforeCreate()).resolves.toEqual({
      ok: false,
      reason: "flush_failed",
    });
    warn.calledWith("SnapshotPanel onBeforeCreate aborted:", expect.any(Error));
  });
});
