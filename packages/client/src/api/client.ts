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
  ReplaceResult,
} from "@smudge/shared";

export type { VelocityResponse };

const BASE = "/api";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

// Map a fetch/DOM failure to an ApiRequestError with a stable code. An
// AbortError can surface either from the initial `fetch()` call or from
// body reads after headers have arrived (res.json/res.blob) — both need
// the same ABORTED classification so every caller can rely on err.code.
function classifyFetchError(err: unknown): ApiRequestError {
  if (err instanceof DOMException && err.name === "AbortError") {
    return new ApiRequestError("Request aborted", 0, "ABORTED");
  }
  const message = err instanceof Error ? err.message : "Network request failed";
  return new ApiRequestError(message, 0, "NETWORK");
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  }).catch((err: unknown) => {
    // Surface AbortController cancellation as a typed error so callers can
    // distinguish "request aborted" from real network failure.
    // Network failures (offline, DNS, CSP) come through as TypeError from
    // fetch. Wrap so every call site can rely on ApiRequestError rather
    // than seeing a bare TypeError and falling back to generic copy on
    // exactly the path that most needs clear messaging.
    throw classifyFetchError(err);
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as ApiError;
      message = body.error?.message ?? message;
      code = body.error?.code;
    } catch (err: unknown) {
      // Body read can ALSO abort (e.g. controller cancelled after headers
      // arrived). Propagate as ABORTED so callers that key on err.code
      // don't see a generic "Request failed: 4xx" status-only message
      // and mis-surface it as a retryable network fault. Any other JSON
      // parse failure (e.g. proxy HTML error page) falls through to the
      // status-only envelope below.
      if (err instanceof DOMException && err.name === "AbortError") {
        throw classifyFetchError(err);
      }
    }
    throw new ApiRequestError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  // A caller abort after a 2xx response and before json() resolves would
  // otherwise bubble a raw DOMException — map to ABORTED so callers can
  // key on err.code. For other body-read failures (non-JSON 2xx bodies
  // from a reverse proxy, truncated responses), preserve the real HTTP
  // status so the error isn't mistaken for a network fault.
  return (res.json() as Promise<T>).catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw classifyFetchError(err);
    }
    const message = err instanceof Error ? err.message : "Malformed response body";
    throw new ApiRequestError(message, res.status, "BAD_JSON");
  });
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
      signal?: AbortSignal,
    ) =>
      apiFetch<Chapter>(`/chapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        // Only include `signal` when one was actually provided; otherwise
        // the fetch options object differs from the no-signal callers in
        // ways that break tests asserting the options shape (and can
        // subtly differ in fetch polyfills).
        ...(signal ? { signal } : {}),
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
      apiFetch<
        { status: "created"; snapshot: SnapshotRow } | { status: "duplicate"; message: string }
      >(`/chapters/${chapterId}/snapshots`, {
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
      signal?: AbortSignal,
    ) =>
      apiFetch<SearchResult>(`/projects/${projectSlug}/search`, {
        method: "POST",
        body: JSON.stringify({ query, options }),
        ...(signal ? { signal } : {}),
      }),

    replace: (
      projectSlug: string,
      search: string,
      replace: string,
      options: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean } | undefined,
      scope: { type: "project" } | { type: "chapter"; chapter_id: string; match_index?: number },
      signal?: AbortSignal,
    ) =>
      apiFetch<ReplaceResult>(`/projects/${projectSlug}/replace`, {
        method: "POST",
        body: JSON.stringify({ search, replace, options, scope }),
        ...(signal ? { signal } : {}),
      }),
  },

  settings: {
    // Server returns Record<string, string>; narrowed here to the fields the client uses.
    // Update this type when new settings are added.
    get: () => apiFetch<{ timezone?: string }>("/settings"),

    update: (settings: Array<{ key: string; value: string }>, signal?: AbortSignal) =>
      apiFetch<{ message: string }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings }),
        ...(signal ? { signal } : {}),
      }),
  },
};
