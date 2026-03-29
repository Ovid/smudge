import type {
  Project,
  ProjectListItem,
  ProjectWithChapters,
  Chapter,
  CreateProjectInput,
  ApiError,
} from "@smudge/shared";

const BASE = "/api";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as ApiError;
      message = body.error?.message ?? message;
    } catch {
      // Response body wasn't JSON (e.g., proxy HTML error page)
    }
    throw new ApiRequestError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export const api = {
  projects: {
    list: () => apiFetch<ProjectListItem[]>("/projects"),

    get: (id: string) => apiFetch<ProjectWithChapters>(`/projects/${id}`),

    create: (input: CreateProjectInput) =>
      apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    update: (id: string, data: { title?: string }) =>
      apiFetch<Project>(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    delete: (id: string) => apiFetch<undefined>(`/projects/${id}`, { method: "DELETE" }),

    reorderChapters: (projectId: string, chapterIds: string[]) =>
      apiFetch<{ message: string }>(`/projects/${projectId}/chapters/order`, {
        method: "PUT",
        body: JSON.stringify({ chapter_ids: chapterIds }),
      }),

    trash: (projectId: string) => apiFetch<Chapter[]>(`/projects/${projectId}/trash`),
  },

  chapters: {
    get: (id: string) => apiFetch<Chapter>(`/chapters/${id}`),

    create: (projectId: string) =>
      apiFetch<Chapter>(`/projects/${projectId}/chapters`, { method: "POST" }),

    update: (id: string, data: { title?: string; content?: Record<string, unknown> }) =>
      apiFetch<Chapter>(`/chapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    delete: (id: string) => apiFetch<{ message: string }>(`/chapters/${id}`, { method: "DELETE" }),

    restore: (id: string) => apiFetch<Chapter>(`/chapters/${id}/restore`, { method: "POST" }),
  },
};
