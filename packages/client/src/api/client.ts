import type {
  Project,
  ProjectListItem,
  ProjectWithChapters,
  Chapter,
  ChapterStatusRow,
  CreateProjectInput,
  ApiError,
} from "@smudge/shared";

export interface VelocityResponse {
  daily_snapshots: Array<{ date: string; total_word_count: number }>;
  sessions: Array<{
    start: string;
    end: string;
    duration_minutes: number;
    chapters_touched: string[];
    net_words: number;
  }>;
  streak: { current: number; best: number };
  projection: {
    target_word_count: number | null;
    target_deadline: string | null;
    projected_date: string | null;
    daily_average_30d: number;
  };
  completion: {
    threshold_status: string;
    total_chapters: number;
    completed_chapters: number;
  };
}

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

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  projects: {
    list: () => apiFetch<ProjectListItem[]>("/projects"),

    get: (slug: string) => apiFetch<ProjectWithChapters>(`/projects/${slug}`),

    create: (input: CreateProjectInput) =>
      apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    update: (
      slug: string,
      data: {
        title?: string;
        target_word_count?: number | null;
        target_deadline?: string | null;
        completion_threshold?: string;
      },
    ) =>
      apiFetch<Project>(`/projects/${slug}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    velocity: (slug: string) => apiFetch<VelocityResponse>(`/projects/${slug}/velocity`),

    delete: (slug: string) =>
      apiFetch<{ message: string }>(`/projects/${slug}`, { method: "DELETE" }),

    reorderChapters: (slug: string, chapterIds: string[]) =>
      apiFetch<{ message: string }>(`/projects/${slug}/chapters/order`, {
        method: "PUT",
        body: JSON.stringify({ chapter_ids: chapterIds }),
      }),

    trash: (slug: string) => apiFetch<Chapter[]>(`/projects/${slug}/trash`),

    dashboard: (slug: string) =>
      apiFetch<{
        chapters: Array<{
          id: string;
          title: string;
          status: string;
          status_label: string;
          word_count: number;
          target_word_count: number | null;
          updated_at: string;
          sort_order: number;
        }>;
        status_summary: Record<string, number>;
        totals: {
          word_count: number;
          chapter_count: number;
          most_recent_edit: string | null;
          least_recent_edit: string | null;
        };
      }>(`/projects/${slug}/dashboard`),
  },

  chapters: {
    get: (id: string) => apiFetch<Chapter>(`/chapters/${id}`),

    create: (projectSlug: string) =>
      apiFetch<Chapter>(`/projects/${projectSlug}/chapters`, { method: "POST" }),

    update: (
      id: string,
      data: {
        title?: string;
        content?: Record<string, unknown>;
        status?: string;
        target_word_count?: number | null;
      },
    ) =>
      apiFetch<Chapter>(`/chapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    delete: (id: string) => apiFetch<{ message: string }>(`/chapters/${id}`, { method: "DELETE" }),

    restore: (id: string) =>
      apiFetch<Chapter & { project_slug?: string }>(`/chapters/${id}/restore`, { method: "POST" }),
  },

  chapterStatuses: {
    list: () => apiFetch<ChapterStatusRow[]>("/chapter-statuses"),
  },

  settings: {
    get: () => apiFetch<Record<string, string>>("/settings"),

    update: (settings: Array<{ key: string; value: string }>) =>
      apiFetch<{ message: string }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings }),
      }),
  },
};
