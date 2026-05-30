import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import {
  useFindReplaceController,
  type FindReplaceControllerDeps,
} from "../useFindReplaceController";
import type { useFindReplaceState } from "../useFindReplaceState";
import type { useEditorMutation, MutationResult } from "../useEditorMutation";
import type { useSnapshotState } from "../useSnapshotState";
import { STRINGS } from "../../strings";

// OOSI1 (agentic-review 2026-05-30): unit-level regression for the
// finalizeReplaceSuccess `reloadFailed && stale` branch. Reproducing the
// committed_but_unreloaded + stale-chapter-drift combination at integration
// scope is gated by actionBusyRef (it blocks sidebar chapter switches during a
// replace), so the controller is exercised in isolation here: we drive
// mutation.run() to return committed_but_unreloaded and make getActiveChapter()
// report a chapter that differs from the replace target, which is exactly the
// stale condition finalizeReplaceSuccess guards.

type ReplaceData = { replaced_count: number; affected_chapter_ids: string[] };

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

function buildDeps(overrides: {
  runResult: MutationResult<ReplaceData>;
  activeChapterId: string | null;
}) {
  const applyReloadFailedLock = vi.fn();
  const reassertEditorEditable = vi.fn();
  const setActionError = vi.fn();
  const setActionInfo = vi.fn();
  const refreshSnapshotCount = vi.fn();

  const mutation = {
    run: vi.fn(async () => overrides.runResult),
    isBusy: vi.fn(() => false),
  } as unknown as ReturnType<typeof useEditorMutation>;

  const findReplace = {
    search: vi.fn(async () => {}),
    clearError: vi.fn(),
  } as unknown as ReturnType<typeof useFindReplaceState>;

  const snapshotPanelRef = {
    current: null,
  } as unknown as ReturnType<typeof useSnapshotState>["snapshotPanelRef"];

  const actionBusyRef: MutableRefObject<boolean> = { current: false };

  const deps: FindReplaceControllerDeps = {
    project: { id: "p1", chapters: [chapterWithId("ch-1")] } as unknown as ProjectWithChapters,
    slug: "proj-slug",
    findReplace,
    mutation,
    getActiveChapter: () =>
      overrides.activeChapterId === null ? null : chapterWithId(overrides.activeChapterId),
    isActionBusy: () => false,
    actionBusyRef,
    isEditorLocked: () => false,
    applyReloadFailedLock,
    reassertEditorEditable,
    setActionError,
    setActionInfo,
    snapshotPanelRef,
    refreshSnapshotCount,
  };

  return {
    deps,
    applyReloadFailedLock,
    reassertEditorEditable,
    setActionError,
    setActionInfo,
  };
}

const COMMITTED_UNRELOADED: MutationResult<ReplaceData> = {
  ok: false,
  stage: "committed_but_unreloaded",
  data: { replaced_count: 2, affected_chapter_ids: ["ch-1"] },
};

const FROZEN_CHAPTER_REPLACE = {
  scope: { type: "chapter" as const, chapter_id: "ch-1" },
  query: "a",
  replacement: "b",
  options: { case_sensitive: false, whole_word: false, regex: false },
};

describe("useFindReplaceController — finalizeReplaceSuccess reloadFailed branch (OOSI1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-asserts editor editable (not a persistent lock) when the active chapter has drifted from the replace target", async () => {
    // committed_but_unreloaded leaves the editor setEditable(false) (the hook's
    // reloadFailed path dispatches no terminal event). The user has since
    // navigated to a DIFFERENT chapter than the replace targeted (ch-2 vs
    // ch-1), so a persistent lock banner would be misattributed to an
    // untouched chapter. The branch must instead re-assert editable on the
    // now-unrelated editor and surface a dismissible action error — otherwise
    // the editor is stranded read-only with only a dismissible signal (OOSI1).
    const { deps, applyReloadFailedLock, reassertEditorEditable, setActionError } = buildDeps({
      runResult: COMMITTED_UNRELOADED,
      activeChapterId: "ch-2",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    // Editor re-asserted editable (the fix): the unrelated chapter must not be
    // left read-only.
    expect(reassertEditorEditable).toHaveBeenCalledTimes(1);
    // No persistent lock banner pinned to the untouched chapter.
    expect(applyReloadFailedLock).not.toHaveBeenCalled();
    // The dismissible action error is still the user-visible signal.
    expect(setActionError).toHaveBeenCalledWith(STRINGS.findReplace.replaceSucceededReloadFailed);
  });

  it("raises the persistent lock (and does NOT re-assert editable) when the active chapter still matches the replace target", async () => {
    // Contrast / non-regression: not stale (active chapter == target). The
    // editor genuinely shows the chapter whose post-mutation state we could
    // not confirm, so the persistent lock banner is correct and the editor
    // must stay read-only — reassertEditorEditable must NOT fire here.
    const { deps, applyReloadFailedLock, reassertEditorEditable, setActionError } = buildDeps({
      runResult: COMMITTED_UNRELOADED,
      activeChapterId: "ch-1",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    expect(applyReloadFailedLock).toHaveBeenCalledWith(
      STRINGS.findReplace.replaceSucceededReloadFailed,
    );
    expect(reassertEditorEditable).not.toHaveBeenCalled();
    expect(setActionError).not.toHaveBeenCalledWith(
      STRINGS.findReplace.replaceSucceededReloadFailed,
    );
  });
});
