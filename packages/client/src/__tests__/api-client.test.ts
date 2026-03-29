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

  it("get(id) fetches GET /api/projects/:id", async () => {
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
