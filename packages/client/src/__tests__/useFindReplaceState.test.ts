import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useFindReplaceState } from "../hooks/useFindReplaceState";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    search: {
      find: vi.fn(),
      replace: vi.fn(),
    },
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiRequestError";
      this.status = status;
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

  it("search() sets generic error message on non-400 error", async () => {
    mockFind.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("test");
    });

    await act(async () => {
      await result.current.search("my-project");
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.results).toBeNull();
  });

  it("search() sets fallback error message for non-Error throws", async () => {
    mockFind.mockRejectedValueOnce("string error");

    const { result } = renderHook(() => useFindReplaceState("my-project"));

    act(() => {
      result.current.setQuery("test");
    });

    await act(async () => {
      await result.current.search("my-project");
    });

    expect(result.current.error).toBe("Search failed");
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

    expect(mockFind).toHaveBeenCalledWith("my-project", "hello", expect.any(Object));
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
});
