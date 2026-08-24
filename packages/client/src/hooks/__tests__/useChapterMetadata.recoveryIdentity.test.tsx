import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import type { Chapter, ChapterStatusValue, ProjectWithChapters } from "@smudge/shared";
import { api, ApiRequestError } from "../../api/client";
import { useChapterMetadata } from "../useChapterMetadata";
import type { ChapterMetadataDeps } from "../useProjectEditor.types";
import { STRINGS } from "../../strings";
import { expectConsole } from "../../__tests__/expectConsole";

// Backlog `8fc27b79` / `52330775` (agentic review 2026-08-23 round 2, OOSI1 and
// OOSS1). `handleUpdateProjectTitle`'s committed-recovery arm re-GETs the
// project by the slug captured when the rename STARTED — which is the slug the
// rename may have just released. CLAUDE.md §"Slugs are mutable and reclaimable"
// records that renaming a project away from slug S frees S for the next project
// whose title generates it, so that GET can answer 200 with a DIFFERENT
// project.
//
// `isStaleProject()` cannot catch it. It asks "is the user still on the project
// this rename started in", which is TRUE in exactly this case. The question the
// arm needs answered is "is the snapshot that came back that project", and only
// the snapshot's own id can answer it. The sibling site in
// `useChapterCrud.handleCreateChapter` got that conjunct on 2026-08-23 (review
// S14); this one did not, and it is the more exposed of the two because it also
// rewrites `projectSlugRef.current` — a write the comment above it calls
// session-permanent, since `useProjectEditor`'s render-time sync consumes its
// sentinel once per slug transition and never re-advances.

vi.mock("../../api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiRequestError";
    }
  },
  api: {
    projects: { update: vi.fn(), get: vi.fn() },
    chapters: { update: vi.fn() },
  },
}));

function makeProject(id: string, slug: string): ProjectWithChapters {
  return {
    id,
    slug,
    title: `Project ${id}`,
    mode: "fiction",
    target_word_count: null,
    target_deadline: null,
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    deleted_at: null,
    author_name: null,
    chapters: [],
  } as unknown as ProjectWithChapters;
}

const PROJECT_A = makeProject("proj-a", "my-novel");

/**
 * Mount the hook over project A, with A's slug in both refs so
 * `makeStaleProjectGuard` reports "not stale" — the state that makes the
 * snapshot-identity check the only thing standing between the recovery arm and
 * a stranger's project.
 */
function setupOverProjectA() {
  const setProject = vi.fn();
  const onRequestEditorLock = vi.fn();
  const refs: {
    projectRef?: { current: ProjectWithChapters | null };
    projectSlugRef?: { current: string | undefined };
  } = {};

  const { result } = renderHook(() => {
    const projectRef = useRef<ProjectWithChapters | null>(PROJECT_A);
    const projectSlugRef = useRef<string | undefined>(PROJECT_A.slug);
    const activeChapterRef = useRef<Chapter | null>(null);
    const confirmedStatusRef = useRef<Record<string, ChapterStatusValue | undefined>>({});
    const onRequestEditorLockRef = useRef<((message: string) => void) | undefined>(
      onRequestEditorLock,
    );
    refs.projectRef = projectRef;
    refs.projectSlugRef = projectSlugRef;
    const deps: ChapterMetadataDeps = {
      setProject,
      setActiveChapter: vi.fn(),
      setProjectTitleError: vi.fn(),
      setError: vi.fn(),
      activeChapterRef,
      projectRef,
      projectSlugRef,
      confirmedStatusRef,
      onRequestEditorLockRef,
    };
    return useChapterMetadata(deps);
  });

  return { result, setProject, onRequestEditorLock, refs };
}

describe("handleUpdateProjectTitle recovery path — snapshot identity (OOSI1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function armRecoveryReturning(snapshot: ProjectWithChapters) {
    vi.mocked(api.projects.update).mockRejectedValue(
      new ApiRequestError("unreadable", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.get).mockResolvedValue(snapshot);
  }

  it("does not install a snapshot belonging to a different project", async () => {
    const warn = expectConsole("warn");
    // The released slug now resolves to somebody else's project, and it
    // answers 200. Everything the old guard checks still passes.
    armRecoveryReturning(makeProject("proj-other", "my-novel"));
    const { result, setProject, refs } = setupOverProjectA();

    await act(async () => {
      await result.current.handleUpdateProjectTitle("New Title");
    });

    expect(setProject).not.toHaveBeenCalled();
    // The slug write is the damaging half: it is session-permanent, and from
    // there every slug-addressed POST and PUT targets the stranger.
    expect(refs.projectSlugRef!.current).toBe("my-novel");
    warn.calledWith("Failed to update project title:", expect.any(ApiRequestError));
  });

  it("still installs the snapshot when it IS the project the rename started in", async () => {
    // Contrast, so the guard cannot regress to refusing everything.
    const warn = expectConsole("warn");
    const renamed = makeProject("proj-a", "new-title");
    armRecoveryReturning(renamed);
    const { result, setProject, refs } = setupOverProjectA();

    await act(async () => {
      await result.current.handleUpdateProjectTitle("New Title");
    });

    expect(setProject).toHaveBeenCalledWith(renamed);
    expect(refs.projectSlugRef!.current).toBe("new-title");
    warn.calledWith("Failed to update project title:", expect.any(ApiRequestError));
  });
});

describe("handleUpdateProjectTitle recovery-404 arm — drift guard (OOSS1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not lock a project the rename never touched", async () => {
    const warn = expectConsole("warn");
    // The recovery GET 404s because A's slug really did move. But the writer
    // has since navigated to B, and `titleRecoveryAbortRef` is aborted only on
    // unmount and on the next rename — never on project change — so this late
    // 404 arrives while B is on screen. Its banner is non-dismissible, tells
    // the writer to refresh, and short-circuits B's auto-save, on a premise
    // that is false there: `projectSlugRef` already holds B's live slug, so no
    // slug was lost.
    vi.mocked(api.projects.update).mockRejectedValue(
      new ApiRequestError("unreadable", 200, "BAD_JSON"),
    );
    const { result, onRequestEditorLock, refs } = setupOverProjectA();

    vi.mocked(api.projects.get).mockImplementation(async () => {
      // The navigation lands while the recovery GET is in flight.
      refs.projectRef!.current = makeProject("proj-b", "other-book");
      refs.projectSlugRef!.current = "other-book";
      throw new ApiRequestError("gone", 404, "NOT_FOUND");
    });

    await act(async () => {
      await result.current.handleUpdateProjectTitle("New Title");
    });

    expect(onRequestEditorLock).not.toHaveBeenCalled();
    warn.calledWith("Failed to update project title:", expect.any(ApiRequestError));
  });

  it("still locks when the writer is on the project whose slug was lost", async () => {
    // Contrast: the lock is the right answer when the premise holds.
    vi.mocked(api.projects.update).mockRejectedValue(
      new ApiRequestError("unreadable", 200, "BAD_JSON"),
    );
    const warn = expectConsole("warn");
    vi.mocked(api.projects.get).mockRejectedValue(new ApiRequestError("gone", 404, "NOT_FOUND"));
    const { result, onRequestEditorLock } = setupOverProjectA();

    await act(async () => {
      await result.current.handleUpdateProjectTitle("New Title");
    });

    expect(onRequestEditorLock).toHaveBeenCalledWith(STRINGS.error.updateTitleProjectSlugLost);
    warn.calledWith("Failed to update project title:", expect.any(ApiRequestError));
  });
});
