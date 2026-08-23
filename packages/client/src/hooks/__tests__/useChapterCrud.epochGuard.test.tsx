import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import type { Chapter, ChapterStatusValue, ProjectWithChapters } from "@smudge/shared";
import { api, ApiRequestError } from "../../api/client";
import { useChapterCrud } from "../useChapterCrud";
import type { ChapterCrudDeps } from "../useProjectEditor.types";
import { expectConsole } from "../../__tests__/expectConsole";

// Backlog 8b34a209 (absorbing a65acf76). Both setProject calls in
// handleCreateChapter merged their result without re-testing project
// identity INSIDE the updater. The outer isStaleProject() guard is
// strictly stronger than an id compare — it also catches the pre-load
// window — but it is evaluated when the handler resumes, while the
// updater body runs later, when React drains the queue. A setProject(B)
// from a concurrent loadProject(B) queued in between drains first, and
// A's updater then appends A's chapter onto B's list: a phantom chapter
// in project B's sidebar whose id points into project A. An outer guard
// cannot see inside the queue; only the updater can.
//
// These tests reach the updater directly. They capture the function
// handleCreateChapter passes to setProject and invoke it with a `prev`
// belonging to a different project — exactly the state React would hand
// it after a concurrent switch drained first.

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
    chapters: { create: vi.fn() },
    projects: { get: vi.fn() },
  },
}));

function makeProject(id: string, slug: string, chapters: Chapter[] = []): ProjectWithChapters {
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
    chapters,
  } as ProjectWithChapters;
}

function makeChapter(id: string, projectId: string): Chapter {
  return {
    id,
    project_id: projectId,
    title: `Chapter ${id}`,
    content: { type: "doc", content: [] },
    sort_order: 1,
    word_count: 0,
    status: "draft" as ChapterStatusValue,
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    deleted_at: null,
  } as unknown as Chapter;
}

const PROJECT_A = makeProject("proj-a", "project-a");
const PROJECT_B = makeProject("proj-b", "project-b", [makeChapter("ch-b1", "proj-b")]);
const NEW_CHAPTER_A = makeChapter("ch-a-new", "proj-a");

/** Renders useChapterCrud over project A with a spy setProject, and
 *  returns the spy plus the handlers. projectRef/projectSlugRef are held
 *  at A for the whole test so the outer isStaleProject() guard PASSES —
 *  the point is that passing it is not sufficient. */
function setupOverProjectA() {
  const setProject = vi.fn();
  const setActiveChapter = vi.fn();
  const setChapterWordCount = vi.fn();
  const replaceConfirmedStatusesFromProject = vi.fn();

  const { result } = renderHook(() => {
    const projectRef = useRef<ProjectWithChapters | null>(PROJECT_A);
    const projectSlugRef = useRef<string | undefined>(PROJECT_A.slug);
    const activeChapterRef = useRef<Chapter | null>(null);
    const confirmedStatusRef = useRef<Record<string, ChapterStatusValue | undefined>>({});
    const onProjectNotFoundRef = useRef<(() => void) | undefined>(undefined);

    const deps: ChapterCrudDeps = {
      setProject,
      setActiveChapter,
      setSaveStatus: vi.fn(),
      setSaveErrorMessage: vi.fn(),
      setCacheWarning: vi.fn(),
      setChapterWordCount,
      setChapterReloadKey: vi.fn(),
      setError: vi.fn(),
      activeChapterRef,
      projectRef,
      projectSlugRef,
      confirmedStatusRef,
      onProjectNotFoundRef,
      cancelInFlightSave: vi.fn(),
      replaceConfirmedStatusesFromProject,
    };
    return useChapterCrud(deps);
  });

  return { result, setProject, setActiveChapter, setChapterWordCount };
}

/** Pulls the single updater function handed to setProject. */
function capturedUpdater(setProject: ReturnType<typeof vi.fn>) {
  expect(setProject).toHaveBeenCalledTimes(1);
  const arg = setProject.mock.calls[0]?.[0];
  expect(typeof arg).toBe("function");
  return arg as (prev: ProjectWithChapters | null) => ProjectWithChapters | null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleCreateChapter success path — inside-updater epoch guard (8b34a209)", () => {
  it("does not append project A's new chapter onto project B's list", async () => {
    vi.mocked(api.chapters.create).mockResolvedValue(NEW_CHAPTER_A);
    const { result, setProject } = setupOverProjectA();

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    // React drained a concurrent setProject(B) before this updater ran.
    const merge = capturedUpdater(setProject);
    expect(merge(PROJECT_B)).toBe(PROJECT_B);
  });

  it("still appends when the updater sees the project it was captured for", async () => {
    vi.mocked(api.chapters.create).mockResolvedValue(NEW_CHAPTER_A);
    const { result, setProject } = setupOverProjectA();

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    const merged = capturedUpdater(setProject)(PROJECT_A);
    expect(merged?.chapters.map((c) => c.id)).toEqual(["ch-a-new"]);
  });

  it("leaves a null prev alone", async () => {
    vi.mocked(api.chapters.create).mockResolvedValue(NEW_CHAPTER_A);
    const { result, setProject } = setupOverProjectA();

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(capturedUpdater(setProject)(null)).toBeNull();
  });
});

describe("handleCreateChapter recovery path — inside-updater epoch guard (a65acf76)", () => {
  // The 2xx-BAD_JSON arm re-fetches the project and merges the whole
  // snapshot. Same queue-drain window, worse consequence: an unguarded
  // merge replaces project B's state with project A's outright.
  function armCommittedRecovery() {
    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("unreadable", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.get).mockResolvedValue(
      makeProject("proj-a", "project-a", [NEW_CHAPTER_A]),
    );
  }

  it("does not overwrite project B with project A's refreshed snapshot", async () => {
    const warn = expectConsole("warn");
    armCommittedRecovery();
    const { result, setProject } = setupOverProjectA();

    await act(async () => {
      await result.current.handleCreateChapter(vi.fn());
    });

    expect(capturedUpdater(setProject)(PROJECT_B)).toBe(PROJECT_B);
    warn.calledWith("Failed to create chapter:", expect.any(ApiRequestError));
  });

  it("still applies the refreshed snapshot for the project it was captured for", async () => {
    const warn = expectConsole("warn");
    armCommittedRecovery();
    const { result, setProject } = setupOverProjectA();

    await act(async () => {
      await result.current.handleCreateChapter(vi.fn());
    });

    const applied = capturedUpdater(setProject)(PROJECT_A);
    expect(applied?.id).toBe("proj-a");
    expect(applied?.chapters.map((c) => c.id)).toEqual(["ch-a-new"]);
    warn.calledWith("Failed to create chapter:", expect.any(ApiRequestError));
  });
});
