import { describe, it, expect, vi, beforeEach } from "vitest";
import { UNTITLED_CHAPTER } from "@smudge/shared";
import { api } from "../api/client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api.projects", () => {
  it("list() fetches GET /api/projects", async () => {
    const projects = [
      { id: "1", title: "P1", mode: "fiction", total_word_count: 0, updated_at: "" },
    ];
    mockFetch.mockResolvedValue(jsonResponse(projects));

    const result = await api.projects.list();
    expect(result).toEqual(projects);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("get(slug) fetches GET /api/projects/:slug", async () => {
    const project = { id: "p1", title: "Test", chapters: [] };
    mockFetch.mockResolvedValue(jsonResponse(project));

    const result = await api.projects.get("p1");
    expect(result).toEqual(project);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("create(input) sends POST /api/projects", async () => {
    const created = { id: "p2", title: "New", mode: "fiction" };
    mockFetch.mockResolvedValue(jsonResponse(created, 201));

    const result = await api.projects.create({ title: "New", mode: "fiction" });
    expect(result).toEqual(created);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ title: "New", mode: "fiction" }),
    });
  });

  it("update(slug, data) sends PATCH /api/projects/:slug", async () => {
    const updated = { id: "p1", title: "Renamed" };
    mockFetch.mockResolvedValue(jsonResponse(updated));

    const result = await api.projects.update("p1", { title: "Renamed" });
    expect(result).toEqual(updated);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1", {
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      body: JSON.stringify({ title: "Renamed" }),
    });
  });

  it("reorderChapters sends PUT /api/projects/:slug/chapters/order", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "ok" }));

    await api.projects.reorderChapters("p1", ["ch3", "ch1", "ch2"]);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/chapters/order", {
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      body: JSON.stringify({ chapter_ids: ["ch3", "ch1", "ch2"] }),
    });
  });

  it("trash(slug) fetches GET /api/projects/:slug/trash", async () => {
    const trashed = [{ id: "ch1", title: "Deleted", deleted_at: "2026-01-01" }];
    mockFetch.mockResolvedValue(jsonResponse(trashed));

    const result = await api.projects.trash("p1");
    expect(result).toEqual(trashed);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/trash", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("delete(slug) sends DELETE /api/projects/:slug", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "deleted" }));

    await api.projects.delete("p1");
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1", {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
  });
});

describe("api.chapters", () => {
  it("get(id) fetches GET /api/chapters/:id", async () => {
    const chapter = { id: "ch-1", title: "Ch1" };
    mockFetch.mockResolvedValue(jsonResponse(chapter));

    const result = await api.chapters.get("ch-1");
    expect(result).toEqual(chapter);
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch-1", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("create(projectSlug) sends POST /api/projects/:slug/chapters", async () => {
    const chapter = { id: "ch-new", title: UNTITLED_CHAPTER };
    mockFetch.mockResolvedValue(jsonResponse(chapter, 201));

    const result = await api.chapters.create("p1");
    expect(result).toEqual(chapter);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/chapters", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("delete(id) sends DELETE /api/chapters/:id", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "Chapter moved to trash." }));

    await api.chapters.delete("ch1");
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch1", {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
  });

  it("restore(id) sends POST /api/chapters/:id/restore", async () => {
    const chapter = { id: "ch1", title: "Restored" };
    mockFetch.mockResolvedValue(jsonResponse(chapter));

    const result = await api.chapters.restore("ch1");
    expect(result).toEqual(chapter);
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch1/restore", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("update(id, data) sends PATCH /api/chapters/:id", async () => {
    const updated = { id: "ch-1", title: "Updated" };
    mockFetch.mockResolvedValue(jsonResponse(updated));

    const result = await api.chapters.update("ch-1", { title: "Updated" });
    expect(result).toEqual(updated);
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch-1", {
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      body: JSON.stringify({ title: "Updated" }),
    });
  });
});

describe("api.projects (additional methods)", () => {
  it("velocity(slug) fetches GET /api/projects/:slug/velocity", async () => {
    const velocityData = {
      words_today: 0,
      daily_average_7d: null,
      daily_average_30d: null,
      current_total: 0,
      target_word_count: null,
      remaining_words: null,
      target_deadline: null,
      days_until_deadline: null,
      required_pace: null,
      projected_completion_date: null,
      today: "2026-04-12",
    };
    mockFetch.mockResolvedValue(jsonResponse(velocityData));

    const result = await api.projects.velocity("p1");
    expect(result).toEqual(velocityData);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/velocity", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("dashboard(slug) fetches GET /api/projects/:slug/dashboard", async () => {
    const dashboardData = {
      chapters: [],
      status_summary: {},
      totals: { word_count: 0, chapter_count: 0, most_recent_edit: null, least_recent_edit: null },
    };
    mockFetch.mockResolvedValue(jsonResponse(dashboardData));

    const result = await api.projects.dashboard("p1");
    expect(result).toEqual(dashboardData);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/dashboard", {
      headers: { "Content-Type": "application/json" },
    });
  });
});

describe("api.chapterStatuses", () => {
  it("list() fetches GET /api/chapter-statuses", async () => {
    const statuses = [{ status: "outline", sort_order: 0, label: "Outline" }];
    mockFetch.mockResolvedValue(jsonResponse(statuses));

    const result = await api.chapterStatuses.list();
    expect(result).toEqual(statuses);
    expect(mockFetch).toHaveBeenCalledWith("/api/chapter-statuses", {
      headers: { "Content-Type": "application/json" },
    });
  });
});

describe("api.settings", () => {
  it("get() fetches GET /api/settings", async () => {
    const settings = { timezone: "America/New_York" };
    mockFetch.mockResolvedValue(jsonResponse(settings));

    const result = await api.settings.get();
    expect(result).toEqual(settings);
    expect(mockFetch).toHaveBeenCalledWith("/api/settings", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("update(settings) sends PATCH /api/settings", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: "ok" }));

    const result = await api.settings.update([{ key: "timezone", value: "UTC" }]);
    expect(result).toEqual({ message: "ok" });
    expect(mockFetch).toHaveBeenCalledWith("/api/settings", {
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      body: JSON.stringify({ settings: [{ key: "timezone", value: "UTC" }] }),
    });
  });
});

describe("api.projects.export", () => {
  it("returns a Blob on successful export", async () => {
    const mockBlob = new Blob(["<html>exported</html>"], { type: "text/html" });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(mockBlob),
    });

    const result = await api.projects.export("my-project", { format: "html", include_toc: true });
    expect(result).toBeInstanceOf(Blob);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/my-project/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "html", include_toc: true }),
    });
  });

  it("throws ApiRequestError with server error message on failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({ error: { code: "VALIDATION_ERROR", message: "Invalid format" } }),
    });

    await expect(api.projects.export("my-project", { format: "html" })).rejects.toThrow(
      "Invalid format",
    );
  });

  it("throws generic error when error response is not JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not JSON")),
    });

    await expect(api.projects.export("my-project", { format: "html" })).rejects.toThrow(
      "Export failed: 500",
    );
  });
});

describe("api.images", () => {
  it("list(projectId) fetches GET /api/projects/:id/images", async () => {
    const images = [{ id: "img-1", project_id: "p1", filename: "cover.png" }];
    mockFetch.mockResolvedValue(jsonResponse(images));

    const result = await api.images.list("p1");
    expect(result).toEqual(images);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/images", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("upload(projectId, file) sends POST multipart to /api/projects/:id/images", async () => {
    const uploaded = { id: "img-2", project_id: "p1", filename: "photo.jpg" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(uploaded),
    });

    const file = new File(["fake-image-data"], "photo.jpg", { type: "image/jpeg" });
    const result = await api.images.upload("p1", file);

    expect(result).toEqual(uploaded);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/images", {
      method: "POST",
      body: expect.any(FormData),
    });

    // Verify FormData contains the file
    const callArgs = mockFetch.mock.calls[0]!;
    const formData = (callArgs[1] as { body: FormData }).body;
    expect(formData.get("file")).toBe(file);
  });

  it("upload throws ApiRequestError on failure with server message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 413,
      json: () =>
        Promise.resolve({ error: { code: "FILE_TOO_LARGE", message: "File exceeds 5MB limit" } }),
    });

    const file = new File(["big-data"], "huge.jpg", { type: "image/jpeg" });
    await expect(api.images.upload("p1", file)).rejects.toThrow("File exceeds 5MB limit");
  });

  it("upload throws ApiRequestError with fallback message when body is not JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not JSON")),
    });

    const file = new File(["data"], "img.png", { type: "image/png" });
    await expect(api.images.upload("p1", file)).rejects.toThrow("Upload failed (500)");
  });

  it("references(id) fetches GET /api/images/:id/references", async () => {
    const refs = { chapters: [{ id: "ch-1", title: "Chapter One" }] };
    mockFetch.mockResolvedValue(jsonResponse(refs));

    const result = await api.images.references("img-1");
    expect(result).toEqual(refs);
    expect(mockFetch).toHaveBeenCalledWith("/api/images/img-1/references", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("update(id, data) sends PATCH /api/images/:id", async () => {
    const updated = { id: "img-1", alt_text: "A sunset", caption: "Beautiful sunset" };
    mockFetch.mockResolvedValue(jsonResponse(updated));

    const result = await api.images.update("img-1", {
      alt_text: "A sunset",
      caption: "Beautiful sunset",
    });
    expect(result).toEqual(updated);
    expect(mockFetch).toHaveBeenCalledWith("/api/images/img-1", {
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      body: JSON.stringify({ alt_text: "A sunset", caption: "Beautiful sunset" }),
    });
  });

  it("delete(id) sends DELETE /api/images/:id and returns success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ deleted: true }),
    });

    const result = await api.images.delete("img-1");
    expect(result).toEqual({ deleted: true });
    expect(mockFetch).toHaveBeenCalledWith("/api/images/img-1", {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
  });

  it("delete(id) throws ApiRequestError with IMAGE_IN_USE code and chapters in extras on 409", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          error: {
            code: "IMAGE_IN_USE",
            message: "Image is referenced by chapters",
            chapters: [{ id: "ch-1", title: "Chapter One" }],
          },
        }),
    });

    let caught: unknown;
    try {
      await api.images.delete("img-1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(409);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("IMAGE_IN_USE");
    expect((caught as InstanceType<typeof ApiRequestError>).extras).toEqual({
      chapters: [{ id: "ch-1", title: "Chapter One" }],
    });
  });

  it("delete(id) throws ApiRequestError on non-409 failure with server message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: "Internal error" } }),
    });

    await expect(api.images.delete("img-1")).rejects.toThrow("Internal error");
  });

  it("delete(id) throws ApiRequestError with fallback when error body lacks message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    await expect(api.images.delete("img-1")).rejects.toThrow("Request failed: 500");
  });
});

describe("api.snapshots", () => {
  it("create(chapterId, label) sends POST /api/chapters/:id/snapshots with label", async () => {
    const snap = { id: "snap-1", chapter_id: "ch-1", label: "My Snapshot" };
    mockFetch.mockResolvedValue(jsonResponse({ status: "created", snapshot: snap }, 201));

    const result = await api.snapshots.create("ch-1", "My Snapshot");
    expect(result).toEqual({ status: "created", snapshot: snap });
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch-1/snapshots", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ label: "My Snapshot" }),
    });
  });

  it("create(chapterId) sends POST without label when not provided", async () => {
    const snap = { id: "snap-2", chapter_id: "ch-1" };
    mockFetch.mockResolvedValue(jsonResponse({ status: "created", snapshot: snap }, 201));

    const result = await api.snapshots.create("ch-1");
    expect(result).toEqual({ status: "created", snapshot: snap });
    expect(mockFetch).toHaveBeenCalledWith("/api/chapters/ch-1/snapshots", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({}),
    });
  });

  it("create(chapterId) returns status='duplicate' when server replies 200 with duplicate body", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ status: "duplicate", message: "Snapshot skipped — content unchanged." }, 200),
    );

    const result = await api.snapshots.create("ch-1");
    expect(result.status).toBe("duplicate");
  });

  it("get(id) fetches GET /api/snapshots/:id", async () => {
    const snap = { id: "snap-1", content: "{}" };
    mockFetch.mockResolvedValue(jsonResponse(snap));

    const result = await api.snapshots.get("snap-1");
    expect(result).toEqual(snap);
    expect(mockFetch).toHaveBeenCalledWith("/api/snapshots/snap-1", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("delete(id) sends DELETE /api/snapshots/:id", async () => {
    mockFetch.mockResolvedValue(jsonResponse(undefined));

    await api.snapshots.delete("snap-1");
    expect(mockFetch).toHaveBeenCalledWith("/api/snapshots/snap-1", {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
  });

  it("restore(id) sends POST /api/snapshots/:id/restore", async () => {
    const chapter = { id: "ch-1", title: "Restored" };
    mockFetch.mockResolvedValue(jsonResponse(chapter));

    const result = await api.snapshots.restore("snap-1");
    expect(result).toEqual(chapter);
    expect(mockFetch).toHaveBeenCalledWith("/api/snapshots/snap-1/restore", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });
});

describe("api.search", () => {
  it("find(slug, query, options) sends POST /api/projects/:slug/search", async () => {
    const searchResult = { total_count: 2, chapters: [] };
    mockFetch.mockResolvedValue(jsonResponse(searchResult));

    const result = await api.search.find("my-project", "hello", { case_sensitive: true });
    expect(result).toEqual(searchResult);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/my-project/search", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ query: "hello", options: { case_sensitive: true } }),
    });
  });

  it("find(slug, query) sends POST without options when not provided", async () => {
    const searchResult = { total_count: 0, chapters: [] };
    mockFetch.mockResolvedValue(jsonResponse(searchResult));

    await api.search.find("my-project", "test");
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/my-project/search", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ query: "test", options: undefined }),
    });
  });

  it("replace(slug, search, replace, options, scope) sends POST /api/projects/:slug/replace", async () => {
    const replaceResult = { replaced_count: 3, affected_chapter_ids: ["ch-1"] };
    mockFetch.mockResolvedValue(jsonResponse(replaceResult));

    const result = await api.search.replace(
      "my-project",
      "old",
      "new",
      { whole_word: true },
      {
        type: "chapter",
        chapter_id: "ch-1",
      },
    );
    expect(result).toEqual(replaceResult);
    expect(mockFetch).toHaveBeenCalledWith("/api/projects/my-project/replace", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        search: "old",
        replace: "new",
        options: { whole_word: true },
        scope: { type: "chapter", chapter_id: "ch-1" },
      }),
    });
  });
});

describe("api.projects.export (additional)", () => {
  it("passes abort signal to fetch", async () => {
    const mockBlob = new Blob(["content"], { type: "application/epub+zip" });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(mockBlob),
    });

    const controller = new AbortController();
    await api.projects.export(
      "p1",
      { format: "epub", chapter_ids: ["ch1", "ch2"] },
      controller.signal,
    );

    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p1/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "epub", chapter_ids: ["ch1", "ch2"] }),
      signal: controller.signal,
    });
  });

  // I1: transport-level error classification. Before I1, export threw
  // a bare TypeError for offline/DNS/CSP, bubbled AbortError raw, and
  // discarded err.code/extras from the envelope — breaking the unified
  // mapper contract.
  it("wraps fetch TypeError as ApiRequestError(0, NETWORK) (I1)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let caught: unknown;
    try {
      await api.projects.export("p1", { format: "html" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("NETWORK");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(0);
  });

  it("wraps AbortError from fetch as ApiRequestError(0, ABORTED) (I1)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));

    let caught: unknown;
    try {
      await api.projects.export("p1", { format: "html" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("ABORTED");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(0);
  });

  it("populates code from envelope on !ok response (I1)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockResolvedValue(
      jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Invalid format" } }, 400),
    );

    let caught: unknown;
    try {
      await api.projects.export("p1", { format: "html" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("VALIDATION_ERROR");
  });
});

describe("api.images.upload (I1 transport classification)", () => {
  it("wraps fetch TypeError as ApiRequestError(0, NETWORK)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const file = new File(["x"], "a.png", { type: "image/png" });
    let caught: unknown;
    try {
      await api.images.upload("p1", file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("NETWORK");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(0);
  });

  it("wraps AbortError from fetch as ApiRequestError(0, ABORTED)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));

    const file = new File(["x"], "a.png", { type: "image/png" });
    let caught: unknown;
    try {
      await api.images.upload("p1", file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("ABORTED");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(0);
  });

  it("populates code from envelope on !ok response", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockResolvedValue(
      jsonResponse({ error: { code: "FILE_TOO_LARGE", message: "too big" } }, 413),
    );

    const file = new File(["x"], "a.png", { type: "image/png" });
    let caught: unknown;
    try {
      await api.images.upload("p1", file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("FILE_TOO_LARGE");
  });

  it("maps 2xx AbortError body-read to ABORTED", async () => {
    const { ApiRequestError } = await import("../api/client");
    const abort = new DOMException("aborted", "AbortError");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(abort),
    });

    const file = new File(["x"], "a.png", { type: "image/png" });
    let caught: unknown;
    try {
      await api.images.upload("p1", file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("ABORTED");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(0);
  });

  it("maps 2xx non-abort body-read to BAD_JSON with real status", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    });

    const file = new File(["x"], "a.png", { type: "image/png" });
    let caught: unknown;
    try {
      await api.images.upload("p1", file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("BAD_JSON");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(200);
  });
});

describe("error handling", () => {
  it("throws with server error message when response is not ok", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404),
    );

    await expect(api.projects.get("bad-id")).rejects.toThrow("Project not found");
  });

  it("throws with fallback message when error body lacks message", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: {} }, 500));

    await expect(api.projects.list()).rejects.toThrow("Request failed: 500");
  });

  it("throws with fallback message when error body is not JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("not JSON")),
    });

    await expect(api.projects.list()).rejects.toThrow("Request failed: 502");
  });

  it("wraps fetch TypeError as ApiRequestError(0, NETWORK)", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let caught: unknown;
    try {
      await api.projects.list();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("NETWORK");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(0);
    expect((caught as Error).message).toMatch(/Failed to fetch/);
  });

  it("handles 204 No Content response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error("no body")),
    });

    const result = await api.projects.delete("p1");
    expect(result).toBeUndefined();
  });

  it("maps 2xx AbortError body-read failure to ABORTED with status 0", async () => {
    const { ApiRequestError } = await import("../api/client");
    const abort = new DOMException("aborted", "AbortError");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(abort),
    });

    let caught: unknown;
    try {
      await api.projects.list();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("ABORTED");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(0);
  });

  it("maps 2xx non-abort body-read failure to BAD_JSON with real status", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0")),
    });

    let caught: unknown;
    try {
      await api.projects.list();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).code).toBe("BAD_JSON");
    expect((caught as InstanceType<typeof ApiRequestError>).status).toBe(200);
    expect((caught as Error).message).toMatch(/Unexpected token/);
  });

  it("carries envelope extras on ApiRequestError when present", async () => {
    const { ApiRequestError } = await import("../api/client");
    mockFetch.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "IMAGE_IN_USE",
            message: "in use",
            chapters: [{ id: "c1", title: "Chapter 1" }],
          },
        },
        409,
      ),
    );

    let caught: unknown;
    try {
      await api.projects.get("some-slug");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as InstanceType<typeof ApiRequestError>).extras).toEqual({
      chapters: [{ id: "c1", title: "Chapter 1" }],
    });
  });

  it("ApiRequestError.extras is undefined when envelope has only code and message", async () => {
    const ClientModule = await import("../api/client");
    mockFetch.mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "gone" } }, 404),
    );
    let caught: InstanceType<typeof ClientModule.ApiRequestError> | undefined;
    try {
      await api.projects.get("slug");
    } catch (err) {
      caught = err as InstanceType<typeof ClientModule.ApiRequestError>;
    }
    expect(caught).toBeInstanceOf(ClientModule.ApiRequestError);
    expect(caught?.extras).toBeUndefined();
  });
});
