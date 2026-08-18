import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import {
  useFindReplaceController,
  type FindReplaceControllerDeps,
} from "../useFindReplaceController";
import type { useFindReplaceState } from "../useFindReplaceState";
import type { useEditorMutation, MutationResult, MutationDirective } from "../useEditorMutation";
import type { useSnapshotState } from "../useSnapshotState";
import { ApiRequestError, api } from "../../api/client";
import { clearCachedContent, clearAllCachedContent } from "../useContentCache";
import { STRINGS } from "../../strings";
import { editorMutationReducer, type EditorMutationState } from "../useEditorMutationMachine";

// OOSI1 (agentic-review 2026-05-30): unit-level regression for the
// finalizeReplaceSuccess `reloadFailed && stale` branch. Reproducing the
// committed_but_unreloaded + stale-chapter-drift combination at integration
// scope is gated by actionBusyRef (it blocks sidebar chapter switches during a
// replace), so the controller is exercised in isolation here: we drive
// mutation.run() to return committed_but_unreloaded and make getActiveChapter()
// report a chapter that differs from the replace target, which is exactly the
// stale condition finalizeReplaceSuccess guards.
//
// Extended 2026-08-17 (paad:rethink verification pass) to cover the remaining
// failure stages of both replace entry points. These paths have no e2e safety
// net either: Playwright runs with no coverage instrumentation, and no spec
// injects a busy latch, a failing flush, or a bad-JSON body on the replace
// endpoint. They are the paths where a regression silently loses the writer's
// text, so they are pinned here at unit scope where the stages can be driven
// deterministically.

vi.mock("../useContentCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../useContentCache")>()),
  clearCachedContent: vi.fn(),
  clearAllCachedContent: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: { ...actual.api, search: { ...actual.api.search, replace: vi.fn() } },
  };
});

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
  // Canned MutationResult. Ignored when `replaceResponse` is set.
  runResult?: MutationResult<ReplaceData>;
  // When set, mutation.run actually invokes its mutate callback so the
  // controller's own directive-building code runs, and resolves ok with the
  // directive's data. The captured directives are returned for assertion.
  replaceResponse?: ReplaceData;
  activeChapterId: string | null;
  isActionBusy?: () => boolean;
  projectChapterIds?: string[];
}) {
  const applyReloadFailedLock = vi.fn();
  const reassertEditorEditable = vi.fn();
  const setActionError = vi.fn();
  const setActionInfo = vi.fn();
  const refreshSnapshotCount = vi.fn();

  const directives: MutationDirective<ReplaceData>[] = [];
  const run = vi.fn(async (mutate: () => Promise<MutationDirective<ReplaceData>>) => {
    if (overrides.replaceResponse !== undefined) {
      const directive = await mutate();
      directives.push(directive);
      return { ok: true, data: directive.data } satisfies MutationResult<ReplaceData>;
    }
    return overrides.runResult as MutationResult<ReplaceData>;
  });

  const mutation = {
    run,
    isBusy: vi.fn(() => false),
  } as unknown as ReturnType<typeof useEditorMutation>;

  const findReplace = {
    search: vi.fn(async () => {}),
    clearError: vi.fn(),
    // handleReplaceOne reads the frozen query/options/replacement that
    // produced the visible results; without them it returns before any
    // server call.
    results: null,
    resultsQuery: "a",
    resultsOptions: { case_sensitive: false, whole_word: false, regex: false },
    replacement: "b",
  } as unknown as ReturnType<typeof useFindReplaceState>;

  const snapshotPanelRef = {
    current: null,
  } as unknown as ReturnType<typeof useSnapshotState>["snapshotPanelRef"];

  const actionBusyRef: MutableRefObject<boolean> = { current: false };

  const deps: FindReplaceControllerDeps = {
    project: {
      id: "p1",
      chapters: (overrides.projectChapterIds ?? ["ch-1"]).map(chapterWithId),
    } as unknown as ProjectWithChapters,
    slug: "proj-slug",
    findReplace,
    mutation,
    getActiveChapter: () =>
      overrides.activeChapterId === null ? null : chapterWithId(overrides.activeChapterId),
    isActionBusy: overrides.isActionBusy ?? (() => false),
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
    findReplace,
    directives,
    run,
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

const FROZEN_PROJECT_REPLACE = {
  ...FROZEN_CHAPTER_REPLACE,
  scope: { type: "project" as const },
};

/** 2xx response whose body could not be parsed: the server almost certainly
 * committed the replace and only the reply was unreadable. */
function badJsonError(): ApiRequestError {
  return new ApiRequestError("unreadable", 200, "BAD_JSON");
}

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

  // ── F-07 safety net: END STATE, not call-shape ──────────────────────────
  //
  // The two tests above assert that the controller CALLS the injected
  // applyReloadFailedLock / reassertEditorEditable deps. That pins the current
  // division of labour, which is exactly what F-07 puts in question: today
  // useEditorMutation's `finally` dispatches nothing on the committed path and
  // the consumer owns COMMITTED_UNRELOADED. Any fix that moves that dispatch to
  // the seam would legitimately rewrite those spy assertions — and a rewrite
  // that got the stale case wrong would strand an unrelated chapter's editor
  // read-only again (the OOSI1 defect), with no test left to notice.
  //
  // These two pin the machine's RESULTING STATE instead, through the real
  // reducer, wired the way EditorPage wires it (applyReloadFailedLock →
  // COMMITTED_UNRELOADED, reassertEditorEditable → MUTATION_SETTLED_SUPERSEDED).
  //
  // Scope, stated honestly (S3, review 2026-08-18): this is NOT
  // dispatcher-agnostic. `mutation` here is a stub that dispatches nothing and
  // withRealMachine patches only the two injected deps, so a seam-level fix
  // that moved the dispatch into useEditorMutation would redden both of these
  // while production stayed correct. Treat that redness as a prompt to
  // re-verify the end state under the new division of labour — not as proof of
  // a regression. What they add over
  // `editorMutationReducer(seed, <event>)` (already pinned in
  // useEditorMutationMachine.test.tsx) is that the CONTROLLER picks the right
  // event for the drift/no-drift split, and the right copy with it.
  function withRealMachine(deps: FindReplaceControllerDeps) {
    // Precondition: what useEditorMutation leaves behind on the committed path
    // — MUTATION_STARTED applied (editable:false) and NO terminal event.
    let state: EditorMutationState = { editable: false, lock: null };
    const patched: FindReplaceControllerDeps = {
      ...deps,
      applyReloadFailedLock: (message: string) => {
        state = editorMutationReducer(state, { type: "COMMITTED_UNRELOADED", message });
      },
      reassertEditorEditable: () => {
        state = editorMutationReducer(state, { type: "MUTATION_SETTLED_SUPERSEDED" });
      },
    };
    return { deps: patched, getState: () => state };
  }

  it("leaves the machine editable and unlocked when the replace target drifted (end state)", async () => {
    const built = buildDeps({ runResult: COMMITTED_UNRELOADED, activeChapterId: "ch-2" });
    const { deps, getState } = withRealMachine(built.deps);

    const { result } = renderHook(() => useFindReplaceController(deps));
    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    // The now-unrelated chapter must be typeable again, with no banner pinned
    // to it. A committed-path regression that dispatched nothing at all would
    // leave editable:false here and this goes red.
    expect(getState()).toEqual({ editable: true, lock: null });
  });

  it("leaves the machine locked with replace copy when the target is still active (end state)", async () => {
    const built = buildDeps({ runResult: COMMITTED_UNRELOADED, activeChapterId: "ch-1" });
    const { deps, getState } = withRealMachine(built.deps);

    const { result } = renderHook(() => useFindReplaceController(deps));
    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    // Read-only AND banner, as one state. The copy is asserted because a
    // seam-level fix could dispatch hook-owned generic copy and still lock.
    expect(getState()).toEqual({
      editable: false,
      lock: { message: STRINGS.findReplace.replaceSucceededReloadFailed },
    });
  });
});

describe("useFindReplaceController — executeReplace failure stages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to start a second replace while another action is in flight", async () => {
    // Entry guard: a replace dispatched while another mutation is running
    // would race the busy one's cache-clear and reload. The click must be
    // dropped with an informational banner and no server call at all.
    const { deps, run, setActionInfo } = buildDeps({
      runResult: COMMITTED_UNRELOADED,
      activeChapterId: "ch-1",
      isActionBusy: () => true,
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    expect(setActionInfo).toHaveBeenCalledWith(STRINGS.editor.mutationBusy);
    expect(run).not.toHaveBeenCalled();
  });

  it("reports the busy stage when the mutation hook's own latch rejects the run", async () => {
    // The controller's entry guard and the hook's inFlightRef latch are
    // separate gates; the hook can still refuse after the controller admitted
    // the click. Same user-facing copy, but reached through the result stage.
    const { deps, setActionInfo, setActionError } = buildDeps({
      runResult: { ok: false, stage: "busy" },
      activeChapterId: "ch-1",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    expect(setActionInfo).toHaveBeenCalledWith(STRINGS.editor.mutationBusy);
    // Only the up-front stale-banner clear; the busy stage raises no error.
    expect(setActionError.mock.calls).toEqual([[null]]);
  });

  it("attributes a pre-replace save failure to the save, not the replace", async () => {
    // stage:"flush" means the editor's pending content never reached the
    // server, so the replace was not attempted. Telling the user the replace
    // failed would send them retrying the wrong thing.
    const { deps, setActionError, applyReloadFailedLock } = buildDeps({
      runResult: { ok: false, stage: "flush", error: new Error("save failed") },
      activeChapterId: "ch-1",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    expect(setActionError).toHaveBeenCalledWith(STRINGS.findReplace.replaceFailedSaveFirst);
    // No lock: nothing was committed server-side.
    expect(applyReloadFailedLock).not.toHaveBeenCalled();
  });

  it("clears only the targeted chapter's cached draft when a chapter-scope replace returns an unreadable 2xx body", async () => {
    // The mutate callback threw, so the hook's directive-based cache-clear
    // never ran. The server probably committed, so the cached draft for the
    // replaced chapter is now stale and would overwrite the commit on the
    // next auto-save. Every OTHER chapter's draft must survive — wiping them
    // was a real data-loss path (I4).
    const { deps, applyReloadFailedLock, setActionInfo } = buildDeps({
      runResult: { ok: false, stage: "mutate", error: badJsonError() },
      activeChapterId: "ch-1",
      projectChapterIds: ["ch-1", "ch-2", "ch-3"],
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.executeReplace(FROZEN_CHAPTER_REPLACE);
    });

    expect(clearCachedContent).toHaveBeenCalledWith("ch-1");
    expect(clearCachedContent).toHaveBeenCalledTimes(1);
    expect(clearAllCachedContent).not.toHaveBeenCalled();
    // Persistent lock, carrying the mapper's "response unreadable" copy.
    expect(applyReloadFailedLock).toHaveBeenCalledWith(
      STRINGS.findReplace.replaceResponseUnreadable,
    );
    // replacedCount is unknown, so no "Replaced N occurrences" claim.
    expect(setActionInfo).not.toHaveBeenCalledWith(expect.stringContaining("Replaced"));
  });

  it("clears every project chapter's cached draft when a project-scope replace returns an unreadable 2xx body with no chapter open", async () => {
    // Narrow edge case: project scope dispatched from Trash/Dashboard with no
    // active chapter. affected_chapter_ids is unreadable (that is why we are
    // here) and the "clear the active chapter" fallback is a no-op, so any
    // surviving draft would re-hydrate after the refresh and revert the
    // server-committed replace. Clearing all of them is the least-bad choice —
    // no chapter was open to be typed into.
    const { deps, applyReloadFailedLock } = buildDeps({
      runResult: { ok: false, stage: "mutate", error: badJsonError() },
      activeChapterId: null,
      projectChapterIds: ["ch-1", "ch-2", "ch-3"],
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.executeReplace(FROZEN_PROJECT_REPLACE);
    });

    expect(clearAllCachedContent).toHaveBeenCalledWith(["ch-1", "ch-2", "ch-3"]);
    expect(clearCachedContent).not.toHaveBeenCalled();
    expect(applyReloadFailedLock).toHaveBeenCalledWith(
      STRINGS.findReplace.replaceResponseUnreadable,
    );
  });
});

describe("useFindReplaceController — handleReplaceOne", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips the reload when the replaced chapter is not the one on screen", async () => {
    // The user replaced a match in ch-2 from the results panel while ch-1 is
    // open. ch-2's cached draft must still be cleared (it is now stale), but
    // reloading the editor would be pointless work against an untouched
    // chapter.
    vi.mocked(api.search.replace).mockResolvedValue({
      replaced_count: 1,
      affected_chapter_ids: ["ch-2"],
    } as Awaited<ReturnType<typeof api.search.replace>>);

    const { deps, directives } = buildDeps({
      replaceResponse: { replaced_count: 1, affected_chapter_ids: ["ch-2"] },
      activeChapterId: "ch-1",
      projectChapterIds: ["ch-1", "ch-2"],
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.handleReplaceOne("ch-2", 0);
    });

    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      clearCacheFor: ["ch-2"],
      reloadActiveChapter: false,
    });
    expect(directives[0]).not.toHaveProperty("reloadChapterId");
  });

  it("re-runs the search and clears no cache when the match is already gone on the server", async () => {
    // replaced_count === 0 means someone (an earlier replace, an edit) removed
    // the match between the search and the click. Nothing changed server-side,
    // so no cache clear and no reload — but the stale row must disappear from
    // the panel, or the user clicks it again and loops the same error.
    vi.mocked(api.search.replace).mockResolvedValue({
      replaced_count: 0,
      affected_chapter_ids: [],
    } as Awaited<ReturnType<typeof api.search.replace>>);

    const { deps, directives, findReplace, setActionError } = buildDeps({
      replaceResponse: { replaced_count: 0, affected_chapter_ids: [] },
      activeChapterId: "ch-1",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.handleReplaceOne("ch-1", 0);
    });

    expect(directives[0]).toMatchObject({ clearCacheFor: [], reloadActiveChapter: false });
    expect(setActionError).toHaveBeenCalledWith(STRINGS.findReplace.matchNotFound);
    expect(findReplace.search).toHaveBeenCalledWith("proj-slug");
    // The action banner is the authoritative description of this click; the
    // refresh must not leave a competing panel-local message beside it.
    expect(findReplace.clearError).toHaveBeenCalled();
  });

  it("reports the busy stage when the mutation hook refuses a per-match replace", async () => {
    const { deps, setActionInfo, setActionError } = buildDeps({
      runResult: { ok: false, stage: "busy" },
      activeChapterId: "ch-1",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.handleReplaceOne("ch-1", 0);
    });

    expect(setActionInfo).toHaveBeenCalledWith(STRINGS.editor.mutationBusy);
    // Only the up-front stale-banner clear; the busy stage raises no error.
    expect(setActionError.mock.calls).toEqual([[null]]);
  });

  it("attributes a pre-replace save failure to the save on the per-match path too", async () => {
    const { deps, setActionError } = buildDeps({
      runResult: { ok: false, stage: "flush", error: new Error("save failed") },
      activeChapterId: "ch-1",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.handleReplaceOne("ch-1", 0);
    });

    expect(setActionError).toHaveBeenCalledWith(STRINGS.findReplace.replaceFailedSaveFirst);
  });

  it("locks the editor when a per-match replace committed but the confirming reload failed", async () => {
    // The server applied the replacement; the follow-up GET could not confirm
    // what is on screen. The editor must stay read-only until refresh — an
    // auto-save from the unconfirmed display would overwrite the commit.
    const { deps, applyReloadFailedLock, setActionInfo } = buildDeps({
      runResult: COMMITTED_UNRELOADED,
      activeChapterId: "ch-1",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.handleReplaceOne("ch-1", 0);
    });

    expect(applyReloadFailedLock).toHaveBeenCalledWith(
      STRINGS.findReplace.replaceSucceededReloadFailed,
    );
    // The count came back in the result, so the success banner still fires.
    expect(setActionInfo).toHaveBeenCalledWith(STRINGS.findReplace.replaceSuccess(2));
  });

  it("re-enables the editor instead of locking it when the user switched chapters mid-replace", async () => {
    // Same committed-but-unconfirmed outcome, but the user is now looking at
    // ch-2 which the replace never touched. Locking that editor would strand
    // an unrelated chapter read-only.
    const { deps, applyReloadFailedLock, reassertEditorEditable, setActionError } = buildDeps({
      runResult: COMMITTED_UNRELOADED,
      activeChapterId: "ch-2",
    });

    const { result } = renderHook(() => useFindReplaceController(deps));

    await act(async () => {
      await result.current.handleReplaceOne("ch-1", 0);
    });

    expect(reassertEditorEditable).toHaveBeenCalledTimes(1);
    expect(applyReloadFailedLock).not.toHaveBeenCalled();
    expect(setActionError).toHaveBeenCalledWith(STRINGS.findReplace.replaceSucceededReloadFailed);
  });
});
