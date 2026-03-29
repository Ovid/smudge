import type {
  Project,
  ProjectListItem,
  ProjectWithChapters,
  Chapter,
  CreateProjectInput,
  ApiError,
} from "@smudge/shared";

const BASE = "/api";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = (await res.json()) as ApiError;
    throw new Error(body.error?.message ?? `Request failed: ${res.status}`);
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
  },
};
