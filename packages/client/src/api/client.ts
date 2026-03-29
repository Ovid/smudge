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
  },

  chapters: {
    get: (id: string) => apiFetch<Chapter>(`/chapters/${id}`),

    update: (id: string, data: { title?: string; content?: Record<string, unknown> }) =>
      apiFetch<Chapter>(`/chapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
};
