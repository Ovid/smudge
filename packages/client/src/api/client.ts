import type {
  Project,
  ProjectListItem,
  ProjectWithChapters,
  Chapter,
  ChapterStatusRow,
  CreateProjectInput,
  ApiError,
  VelocityResponse,
  ExportFormatType,
  ImageRow,
  SnapshotRow,
  SnapshotListItem,
  SearchResult,
} from "@smudge/shared";

export type { VelocityResponse };

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
        author_name?: string | null;
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

    export: async (
      slug: string,
      config: {
        format: ExportFormatType;
        include_toc?: boolean;
        chapter_ids?: string[];
        epub_cover_image_id?: string;
      },
      signal?: AbortSignal,
    ): Promise<Blob> => {
      const res = await fetch(`${BASE}/projects/${slug}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        signal,
      });

      if (!res.ok) {
        let message = `Export failed: ${res.status}`;
        try {
          const body = (await res.json()) as ApiError;
          message = body.error?.message ?? message;
        } catch {
          // Response body wasn't JSON
        }
        throw new ApiRequestError(message, res.status);
      }

      return res.blob();
    },
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
      },
    ) =>
      apiFetch<Chapter>(`/chapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    delete: (id: string) => apiFetch<{ message: string }>(`/chapters/${id}`, { method: "DELETE" }),

    restore: (id: string) =>
      apiFetch<Chapter & { project_slug: string }>(`/chapters/${id}/restore`, { method: "POST" }),
  },

  chapterStatuses: {
    list: () => apiFetch<ChapterStatusRow[]>("/chapter-statuses"),
  },

  images: {
    list(projectId: string): Promise<ImageRow[]> {
      return apiFetch(`/projects/${projectId}/images`);
    },

    async upload(projectId: string, file: File): Promise<ImageRow> {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/projects/${projectId}/images`, {
        method: "POST",
        body: formData,
        // No Content-Type header — browser sets multipart boundary automatically
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiRequestError(
          body?.error?.message ?? `Upload failed (${res.status})`,
          res.status,
        );
      }
      return res.json();
    },

    references(id: string): Promise<{ chapters: Array<{ id: string; title: string }> }> {
      return apiFetch(`/images/${id}/references`);
    },

    update(
      id: string,
      data: {
        alt_text?: string;
        caption?: string;
        source?: string;
        license?: string;
      },
    ): Promise<ImageRow> {
      return apiFetch(`/images/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },

    async delete(id: string): Promise<
      | { deleted: boolean }
      | {
          error: {
            code: string;
            message: string;
            chapters: Array<{ id: string; title: string }>;
          };
        }
    > {
      const res = await fetch(`${BASE}/images/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (res.status === 409) {
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          body.error &&
          typeof body.error === "object" &&
          "chapters" in body.error &&
          Array.isArray(body.error.chapters)
        ) {
          return body;
        }
        throw new ApiRequestError("Delete blocked (conflict)", 409);
      }
      if (!res.ok) {
        throw new ApiRequestError(
          body?.error?.message ?? `Delete failed (${res.status})`,
          res.status,
        );
      }
      if (
        !body ||
        typeof body !== "object" ||
        !("deleted" in body) ||
        typeof body.deleted !== "boolean"
      ) {
        throw new ApiRequestError(`Delete failed (${res.status})`, res.status);
      }
      return body;
    },
  },

  snapshots: {
    list: (chapterId: string) => apiFetch<SnapshotListItem[]>(`/chapters/${chapterId}/snapshots`),

    create: (chapterId: string, label?: string) =>
      apiFetch<SnapshotRow | { message: string }>(`/chapters/${chapterId}/snapshots`, {
        method: "POST",
        body: JSON.stringify(label ? { label } : {}),
      }),

    get: (id: string) => apiFetch<SnapshotRow>(`/snapshots/${id}`),

    delete: (id: string) => apiFetch<undefined>(`/snapshots/${id}`, { method: "DELETE" }),

    restore: (id: string) => apiFetch<Chapter>(`/snapshots/${id}/restore`, { method: "POST" }),
  },

  search: {
    find: (
      projectSlug: string,
      query: string,
      options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
    ) =>
      apiFetch<SearchResult>(`/projects/${projectSlug}/search`, {
        method: "POST",
        body: JSON.stringify({ query, options }),
      }),

    replace: (
      projectSlug: string,
      search: string,
      replace: string,
      options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
      scope?: { type: "project" } | { type: "chapter"; chapter_id: string; match_index?: number },
    ) =>
      apiFetch<{ replaced_count: number; affected_chapter_ids: string[] }>(
        `/projects/${projectSlug}/replace`,
        {
          method: "POST",
          body: JSON.stringify({ search, replace, options, scope }),
        },
      ),
  },

  settings: {
    // Server returns Record<string, string>; narrowed here to the fields the client uses.
    // Update this type when new settings are added.
    get: () => apiFetch<{ timezone?: string }>("/settings"),

    update: (settings: Array<{ key: string; value: string }>, signal?: AbortSignal) =>
      apiFetch<{ message: string }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings }),
        signal,
      }),
  },
};
