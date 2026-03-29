import { describe, it, expect, vi, beforeEach } from "vitest";
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
    const chapter = { id: "ch-new", title: "Untitled Chapter" };
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
});
