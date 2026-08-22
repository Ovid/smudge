// F-07 safety net — dispatcher-agnostic end state on the committed path.
//
// F-07 (architecture report 2026-08-11) is that `useEditorMutation.run()`
// dispatches NO terminal machine event when the server committed but the
// follow-up reload could not confirm what is on screen. Every consumer must
// complete the transition by hand, and nothing forces it. The recorded fix
// option — the one this file exists to make safe — moves that dispatch INTO
// the seam.
//
// Why the existing coverage is not enough. Both controller suites already pin
// this behaviour, but both do it by asserting on the injected
// applyReloadFailedLock callback (and a re-assert sibling since deleted) —
// or (in useFindReplaceController.test.tsx's `withRealMachine`) by patching
// those two deps to drive a real reducer. That file says so in its own words:
// "this is NOT dispatcher-agnostic … a seam-level fix that moved the dispatch
// into useEditorMutation would redden both of these while production stayed
// correct." A safety net that goes red when the code is right cannot tell you
// the code is wrong.
//
// What this file does instead: composes the REAL `useEditorMutationMachine`,
// the REAL `useEditorMutation`, and the REAL controller, wired the way
// EditorPage wires them, then forces a genuine committed-but-unreloaded run by
// making reloadActiveChapter fail. It never observes WHO dispatched — only
// where the machine ends up. That end state is the thing the user experiences
// (can I type? is there a banner?), and it is identical before and after the
// dispatch moves.
//
// The two facts pinned here are the two live defects this path has already
// produced: OOSI1 (find-and-replace) and OOSS1 (snapshot restore), both of
// which stranded an unrelated chapter's editor read-only after the user
// navigated away mid-mutation.
//
//   drifted   → { editable: true,  lock: null }        typeable, no banner
//   on-target → { editable: false, lock: { message } } read-only + banner
//
// These must stay green across the F-07 fix without edits to their assertions.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { useEditorMutation } from "../useEditorMutation";
import { useEditorMutationMachine, type EditorMutationState } from "../useEditorMutationMachine";
import {
  useFindReplaceController,
  type FindReplaceControllerDeps,
} from "../useFindReplaceController";
import { useSnapshotController, type SnapshotControllerDeps } from "../useSnapshotController";
import type { EditorHandle } from "../../components/Editor";
import { api, ApiRequestError } from "../../api/client";
import { STRINGS } from "../../strings";

vi.mock("../useContentCache", () => ({
  clearAllCachedContent: vi.fn(),
  clearCachedContent: vi.fn(),
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn(),
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      search: { replace: vi.fn(), find: vi.fn() },
    },
  };
});

const TARGET = "ch-1";
const DRIFTED = "ch-2";

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

/** A TipTap stand-in that satisfies the hook's flush/markClean/setEditable
 * sequence. flushSave must not resolve false — that is a stage:"flush" bail
 * which never reaches the committed path. */
function fakeEditor(): EditorHandle {
  return {
    setEditable: vi.fn(),
    markClean: vi.fn(),
    flushSave: vi.fn(async () => true),
  } as unknown as EditorHandle;
}

/**
 * Wires the real machine + real seam + a real controller exactly as EditorPage
 * does, and reports the machine's live state.
 *
 * `activeChapterId` is what getActiveChapter() reports for the whole run — the
 * chapter the user is looking at when the reload fails. Setting it to
 * something other than TARGET is the drift the two defects were about.
 */
function useHarness(activeChapterId: string) {
  const machine = useEditorMutationMachine();
  const editorRef = useRef<EditorHandle | null>(fakeEditor());
  const actionBusyRef = useRef(false);

  const getActiveChapter = () => chapterWithId(activeChapterId);

  const mutation = useEditorMutation({
    editorRef,
    projectEditor: {
      cancelPendingSaves: () => {},
      // The committed path in one line: the server mutation succeeded, and
      // this confirming GET does not.
      reloadActiveChapter: async () => "failed" as const,
      getActiveChapter,
    },
    dispatch: machine.dispatch,
  });

  // EditorPage's two helpers, verbatim in behaviour (pages/EditorPage.tsx).
  const applyReloadFailedLock = (message: string) => {
    machine.dispatch({ type: "COMMITTED_UNRELOADED", message });
  };

  const shared = {
    mutation,
    getActiveChapter,
    isActionBusy: () => false,
    actionBusyRef,
    isEditorLocked: () => false,
    applyReloadFailedLock,
    setActionError: vi.fn(),
    setActionInfo: vi.fn(),
    snapshotPanelRef: { current: null },
    refreshSnapshotCount: vi.fn(),
  };

  const findReplace = useFindReplaceController({
    ...shared,
    project: { id: "p1", chapters: [] } as unknown as ProjectWithChapters,
    slug: "my-novel",
    findReplace: {
      clearError: vi.fn(),
      search: vi.fn(async () => {}),
    } as unknown as FindReplaceControllerDeps["findReplace"],
  } as unknown as FindReplaceControllerDeps);

  const snapshot = useSnapshotController({
    ...shared,
    activeChapter: chapterWithId(TARGET),
    viewingSnapshot: { id: "snap-1", label: "Before the cut", created_at: "2026-01-02" },
    restoreSnapshot: vi.fn(async () => ({ ok: true as const })),
    viewSnapshot: vi.fn(async () => ({ ok: true as const })),
    exitSnapshotView: vi.fn(),
    cancelPendingSaves: () => {},
    editorRef,
    findReplace: { clearError: vi.fn() },
  } as unknown as SnapshotControllerDeps);

  return { state: machine.state, findReplace, snapshot };
}

/** Chapter-scoped replace on TARGET. `affected` decides whether the chapter
 * the user is currently looking at gets reloaded — it must include the active
 * chapter, or the seam takes the no-reload happy path and never reaches the
 * committed branch at all. */
const FROZEN_REPLACE = {
  scope: { type: "chapter" as const, chapter_id: TARGET },
  query: "a",
  replacement: "b",
  options: { case_sensitive: false, whole_word: false, regex: false },
};

describe("F-07 safety net — committed_but_unreloaded end state (find and replace)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks when the user drifted onto a chapter the replace ALSO affected", async () => {
    vi.mocked(api.search.replace).mockResolvedValue({
      replaced_count: 2,
      affected_chapter_ids: [TARGET, DRIFTED],
    } as Awaited<ReturnType<typeof api.search.replace>>);

    const { result } = renderHook(() => useHarness(DRIFTED));
    await act(async () => {
      await result.current.findReplace.executeReplace(FROZEN_REPLACE);
    });

    // I1 (agentic review 2026-08-21): the user is on a chapter the replace did
    // not START on, but DID change. Drift alone does not make the editor safe
    // to type in — DRIFTED's draft cache was wiped, its confirming GET failed,
    // and its post-replace content was therefore never fetched. Re-enabling
    // here hands back a writable editor showing pre-replace text, and the next
    // auto-save PATCHes it over the server-committed replace with no cached
    // draft left to recover from. Only drift onto an UNaffected chapter is
    // safe; that case is pinned by the snapshot sibling below.
    expect(result.current.state).toEqual<EditorMutationState>({
      editable: false,
      lock: { message: STRINGS.findReplace.replaceSucceededReloadFailed },
    });
  });

  it("leaves the editor read-only under the replace banner when the target is still active", async () => {
    vi.mocked(api.search.replace).mockResolvedValue({
      replaced_count: 2,
      affected_chapter_ids: [TARGET],
    } as Awaited<ReturnType<typeof api.search.replace>>);

    const { result } = renderHook(() => useHarness(TARGET));
    await act(async () => {
      await result.current.findReplace.executeReplace(FROZEN_REPLACE);
    });

    // The editor genuinely shows content whose post-replace state could not be
    // confirmed. Read-only AND banner are one state, and the copy is asserted
    // because a seam that dispatched its own generic wording would still lock.
    expect(result.current.state).toEqual<EditorMutationState>({
      editable: false,
      lock: { message: STRINGS.findReplace.replaceSucceededReloadFailed },
    });
  });
});

describe("2xx BAD_JSON replace — the OTHER possibly-committed path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // S4 (agentic review 2026-08-21). This path never reaches the seam's
  // committed branch: the mutate callback throws, so run() settles with
  // MUTATION_SETTLED_OK and the controller finishes the transition itself.
  //
  // The controller's drift arm used to re-assert editability here, and this
  // assertion is what proved that call was dead weight rather than merely
  // looking like it. Entry is gated on !isEditorLocked(), so lock is null on the
  // way in; MUTATION_SETTLED_OK re-enables against that null lock; and the
  // MUTATION_SETTLED_SUPERSEDED the arm dispatched could only re-derive the same
  // {editable:true, lock:null}. The call is gone (S4); this pins the end state
  // it was supposedly producing, so its removal is verified, not assumed.
  it("leaves the editor typeable with a dismissible notice when the user drifted", async () => {
    vi.mocked(api.search.replace).mockRejectedValue(
      new ApiRequestError("[dev] unreadable body", 200, "BAD_JSON"),
    );

    const { result } = renderHook(() => useHarness(DRIFTED));
    await act(async () => {
      await result.current.findReplace.executeReplace(FROZEN_REPLACE);
    });

    expect(result.current.state).toEqual<EditorMutationState>({ editable: true, lock: null });
  });
});

describe("F-07 safety net — committed_but_unreloaded end state (snapshot restore)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves the editor typeable and unbannered when the user drifted off the restored chapter (OOSS1)", async () => {
    const { result } = renderHook(() => useHarness(DRIFTED));
    await act(async () => {
      await result.current.snapshot.handleRestoreSnapshot();
    });

    expect(result.current.state).toEqual<EditorMutationState>({ editable: true, lock: null });
  });

  it("leaves the editor read-only under the restore banner when the restored chapter is still active", async () => {
    const { result } = renderHook(() => useHarness(TARGET));
    await act(async () => {
      await result.current.snapshot.handleRestoreSnapshot();
    });

    expect(result.current.state).toEqual<EditorMutationState>({
      editable: false,
      lock: { message: STRINGS.snapshots.restoreSucceededReloadFailed },
    });
  });
});
