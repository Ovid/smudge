import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useFindReplaceState } from "../hooks/useFindReplaceState";
import { api } from "../api/client";
import { STRINGS } from "../strings";

vi.mock("../api/client", () => ({
  api: {
    search: {
      find: vi.fn(),
      replace: vi.fn(),
    },
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = "ApiRequestError";
      this.status = status;
      this.code = code;
    }
  },
}));

const mockFind = api.search.find as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFindReplaceState", () => {
  it("initial state is closed with empty fields", () => {
    const { result } = renderHook(() => useFindReplaceState("my-project"));
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.replacement).toBe("");
    expect(result.current.results).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("togglePanel opens and closes the panel", () => {
    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.togglePanel();
    });
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.togglePanel();
    });
    expect(result.current.panelOpen).toBe(false);
  });

  it("closePanel closes the panel", () => {
    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.togglePanel();
    });
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.closePanel();
    });
    expect(result.current.panelOpen).toBe(false);
  });

  it("closePanel cancels a pending debounce timer", async () => {
    // If the panel closes inside the 300ms debounce window, the timer
    // must not fire — otherwise search() runs after close, bumping the
    // seq again and writing stale results pinned to the pre-close
    // query/options that reappear when the user reopens the panel.
    mockFind.mockResolvedValue({ total_count: 1, chapters: [] });

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.togglePanel();
      result.current.setQuery("foo");
    });
    // Advance less than the 300ms debounce — search not fired yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockFind).not.toHaveBeenCalled();

    act(() => {
      result.current.closePanel();
    });

    // Let any pending timer expire — it must be cancelled by closePanel.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockFind).not.toHaveBeenCalled();
    expect(result.current.results).toBeNull();
  });

  it("closePanel clears stale result state", async () => {
    mockFind.mockResolvedValue({
      total_count: 2,
      chapters: [],
    });

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.togglePanel();
      result.current.setQuery("foo");
    });

    // Let the debounced search fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.results).not.toBeNull();

    act(() => {
      result.current.closePanel();
    });
    expect(result.current.panelOpen).toBe(false);
    // Reopening must not resurface the stale result set.
    expect(result.current.results).toBeNull();
    expect(result.current.resultsQuery).toBeNull();
    expect(result.current.resultsOptions).toBeNull();
  });

  it("toggleOption toggles search options", () => {
    const { result } = renderHook(() => useFindReplaceState("my-project"));

    expect(result.current.options.case_sensitive).toBe(false);
    act(() => {
      result.current.toggleOption("case_sensitive");
    });
    expect(result.current.options.case_sensitive).toBe(true);

    act(() => {
      result.current.toggleOption("whole_word");
    });
    expect(result.current.options.whole_word).toBe(true);

    act(() => {
      result.current.toggleOption("regex");
    });
    expect(result.current.options.regex).toBe(true);
  });

  it("search() with empty query clears results and error", async () => {
    const { result } = renderHook(() => useFindReplaceState("my-project"));

    await act(async () => {
      await result.current.search("my-project");
    });

    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("search() with query calls api.search.find and sets results", async () => {
    const searchResult = { total_count: 2, chapters: [] };
    mockFind.mockResolvedValueOnce(searchResult);

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("hello");
    });

    await act(async () => {
      await result.current.search("my-project");
    });

    expect(result.current.results).toEqual(searchResult);
    expect(result.current.error).toBeNull();
  });

  it("search() uses the current projectSlug even if caller passes a stale one (rename race)", async () => {
    // EditorPage closures capture slug at call time. After a rename the
    // captured value is stale; the wrapper must read from the
    // projectSlug-synced ref so the POST targets the live URL.
    const searchResult = { total_count: 1, chapters: [] };
    mockFind.mockResolvedValue(searchResult);

    const { result, rerender } = renderHook(
      ({ slug }: { slug: string }) => useFindReplaceState(slug),
      { initialProps: { slug: "old-slug" } },
    );

    act(() => {
      result.current.setQuery("word");
    });

    // Simulate a rename: the projectSlug prop changes.
    rerender({ slug: "new-slug" });

    // Caller still holds the stale closure value.
    await act(async () => {
      await result.current.search("old-slug");
    });

    expect(mockFind).toHaveBeenCalled();
    expect(mockFind).toHaveBeenLastCalledWith(
      "new-slug",
      "word",
      expect.any(Object),
      expect.anything(),
    );
  });

  it("search() sets error on ApiRequestError with status 400 (invalid regex)", async () => {
    const { ApiRequestError: MockApiError } = await import("../api/client");
    mockFind.mockRejectedValueOnce(new MockApiError("Invalid regex", 400));

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("[invalid");
    });

    await act(async () => {
      await result.current.search("my-project");
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.results).toBeNull();
  });

  it("search() maps MATCH_CAP_EXCEEDED to tooManyMatches copy", async () => {
    const { ApiRequestError: MockApiError } = await import("../api/client");
    const { STRINGS } = await import("../strings");
    mockFind.mockRejectedValueOnce(new MockApiError("too many", 400, "MATCH_CAP_EXCEEDED"));

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("x");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.error).toBe(STRINGS.findReplace.tooManyMatches);
  });

  it("search() maps REGEX_TIMEOUT to searchTimedOut copy", async () => {
    const { ApiRequestError: MockApiError } = await import("../api/client");
    const { STRINGS } = await import("../strings");
    mockFind.mockRejectedValueOnce(new MockApiError("timeout", 400, "REGEX_TIMEOUT"));

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("x");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.error).toBe(STRINGS.findReplace.searchTimedOut);
  });

  it("search() maps INVALID_REGEX to invalidRegex copy", async () => {
    const { ApiRequestError: MockApiError } = await import("../api/client");
    const { STRINGS } = await import("../strings");
    mockFind.mockRejectedValueOnce(new MockApiError("bad", 400, "INVALID_REGEX"));

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("x");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.error).toBe(STRINGS.findReplace.invalidRegex);
  });

  it("search() maps unknown 400 codes to externalized invalidSearchRequest (no raw server message leak)", async () => {
    const { ApiRequestError: MockApiError } = await import("../api/client");
    mockFind.mockRejectedValueOnce(new MockApiError("Query is too long", 400, "VALIDATION_ERROR"));

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("x");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.error).toBe(STRINGS.findReplace.invalidSearchRequest);
  });

  it("search() silently swallows ABORTED errors", async () => {
    const { ApiRequestError: MockApiError } = await import("../api/client");
    mockFind.mockRejectedValueOnce(new MockApiError("Request aborted", 0, "ABORTED"));

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("x");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    // No banner for aborts.
    expect(result.current.error).toBeNull();
    expect(result.current.results).toBeNull();
  });

  it("search() sets externalized searchFailed message on non-400 error", async () => {
    mockFind.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("test");
    });

    await act(async () => {
      await result.current.search("my-project");
    });

    // Raw server messages must not leak into UI (string externalization).
    expect(result.current.error).toBe("Search failed. Try again.");
    expect(result.current.results).toBeNull();
  });

  it("search() sets externalized searchFailed message for non-Error throws", async () => {
    mockFind.mockRejectedValueOnce("string error");

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("test");
    });

    await act(async () => {
      await result.current.search("my-project");
    });

    expect(result.current.error).toBe("Search failed. Try again.");
    expect(result.current.results).toBeNull();
  });

  it("search() maps unknown 400 code to externalized invalidSearchRequest (not raw message)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFind.mockRejectedValueOnce(
      new ApiRequestError("Search query is too long", 400, "VALIDATION_ERROR"),
    );

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("test");
    });

    await act(async () => {
      await result.current.search("my-project");
    });

    expect(result.current.error).toBe("Search request was rejected. Check your search input.");
    expect(result.current.results).toBeNull();
  });

  it("search() preserves prior successful results on network/5xx blip (S8)", async () => {
    const priorResults = { total_count: 1, chapters: [{ id: "c1", title: "Ch 1", matches: [] }] };
    mockFind.mockResolvedValueOnce(priorResults);

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("test");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.results).toEqual(priorResults);

    // Now a transient network failure — results the user is reading
    // must not be wiped.
    mockFind.mockRejectedValueOnce(new Error("Network down"));
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.error).toBe(STRINGS.findReplace.searchFailed);
    expect(result.current.results).toEqual(priorResults);
  });

  it("search() surfaces terminal 'scope not found' copy on 404 (not retry copy)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFind.mockRejectedValueOnce(new ApiRequestError("project gone", 404));

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("test");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    // 404 is terminal — must not reuse the generic "Search failed. Try again."
    // copy that invites a retry loop.
    expect(result.current.error).toBe(STRINGS.findReplace.searchProjectNotFound);
    expect(result.current.results).toBeNull();
  });

  it("search() DOES clear results on 400 (query itself is invalid) (S8)", async () => {
    const priorResults = { total_count: 1, chapters: [{ id: "c1", title: "Ch 1", matches: [] }] };
    mockFind.mockResolvedValueOnce(priorResults);

    const { result } = renderHook(() => useFindReplaceState("my-project"));
    act(() => {
      result.current.setQuery("test");
    });
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.results).toEqual(priorResults);

    // 400 means the current query is invalid — old results no longer
    // reflect anything the user typed; clear them.
    const { ApiRequestError } = await import("../api/client");
    mockFind.mockRejectedValueOnce(new ApiRequestError("bad", 400, "INVALID_REGEX"));
    await act(async () => {
      await result.current.search("my-project");
    });
    expect(result.current.results).toBeNull();
  });

  it("debounced auto-search triggers after typing when panel is open", async () => {
    const searchResult = { total_count: 1, chapters: [] };
    mockFind.mockResolvedValue(searchResult);

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    // Open the panel
    act(() => {
      result.current.togglePanel();
    });

    // Type a query
    act(() => {
      result.current.setQuery("hello");
    });

    // Advance timer past the 300ms debounce
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(mockFind).toHaveBeenCalledWith(
      "my-project",
      "hello",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("debounced search reads latest slug at fire time, not effect setup (I3)", async () => {
    // If the projectSlug changes (rename) during the 300ms debounce window,
    // the debounce callback must POST against the CURRENT slug. Previously
    // `const slug = latestSlugRef.current` ran at effect-setup and was
    // closed over by the setTimeout, so the search fired against the
    // dead slug — contradicting the search() wrapper comment that says
    // `latestSlugRef.current` should be read at call time.
    const searchResult = { total_count: 0, chapters: [] };
    mockFind.mockResolvedValue(searchResult);

    const { result, rerender } = renderHook(
      ({ slug }: { slug: string }) => useFindReplaceState(slug),
      { initialProps: { slug: "old-slug" } },
    );

    act(() => {
      result.current.togglePanel();
      result.current.setQuery("word");
    });

    // Advance partway through the debounce window, then rename.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    rerender({ slug: "new-slug" });

    // Fire the remainder of the debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockFind).toHaveBeenCalledWith(
      "new-slug",
      "word",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("does not auto-search when panel is closed", async () => {
    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("hello");
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(mockFind).not.toHaveBeenCalled();
  });

  it("setQuery and setReplacement update their respective state", () => {
    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("search term");
    });
    expect(result.current.query).toBe("search term");

    act(() => {
      result.current.setReplacement("replace term");
    });
    expect(result.current.replacement).toBe("replace term");
  });

  it("preserves query/replacement across a project rename (slug changes, id stable) (I1)", () => {
    const { result, rerender } = renderHook(
      ({ slug, id }: { slug: string; id: string }) => useFindReplaceState(slug, id),
      { initialProps: { slug: "old-title", id: "proj-1" } },
    );

    act(() => {
      result.current.setQuery("find me");
      result.current.setReplacement("replace me");
    });
    expect(result.current.query).toBe("find me");
    expect(result.current.replacement).toBe("replace me");

    // Rename: slug changes, project id unchanged
    rerender({ slug: "new-title", id: "proj-1" });

    expect(result.current.query).toBe("find me");
    expect(result.current.replacement).toBe("replace me");
  });

  it("resets query/replacement on genuine project change (id changes)", () => {
    const { result, rerender } = renderHook(
      ({ slug, id }: { slug: string; id: string }) => useFindReplaceState(slug, id),
      { initialProps: { slug: "first", id: "proj-1" } },
    );

    act(() => {
      result.current.setQuery("find me");
      result.current.setReplacement("replace me");
    });

    rerender({ slug: "second", id: "proj-2" });

    expect(result.current.query).toBe("");
    expect(result.current.replacement).toBe("");
    expect(result.current.results).toBeNull();
  });

  it("clears loading on project-change reset so the new panel is not stuck 'Searching…' (I2)", async () => {
    // Before I2 the project-change reset bumped searchSeqRef and aborted
    // the controller but did not clear `loading`. The in-flight search's
    // finally only clears loading when seq === current — after the bump
    // the check fails and loading stays true forever. closePanel sidesteps
    // this by clearing loading explicitly, so the bug only manifested when
    // navigating projects with the panel open.
    let resolveFind: (v: { total_count: number; chapters: [] }) => void = () => {};
    mockFind.mockImplementationOnce(
      () =>
        new Promise<{ total_count: number; chapters: [] }>((resolve) => {
          resolveFind = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ slug, id }: { slug: string; id: string }) => useFindReplaceState(slug, id),
      { initialProps: { slug: "first", id: "proj-1" } },
    );

    act(() => {
      result.current.togglePanel();
      result.current.setQuery("hello");
    });
    // Let the 300ms debounce fire so the search starts and loading flips.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.loading).toBe(true);

    // Navigate to a different project with the panel still open and a
    // search in flight.
    rerender({ slug: "second", id: "proj-2" });

    expect(result.current.loading).toBe(false);
    // Resolve the now-orphaned response — it must not flip loading back.
    resolveFind({ total_count: 0, chapters: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);
  });
});
