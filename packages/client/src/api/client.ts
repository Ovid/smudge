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

// S9 (2026-04-23 review): defense-in-depth URL segment encoder. Slugs
// are validated server-side to `[a-z0-9-]` and ids to UUIDs, so today
// no character would alter the URL path. `enc` pins that guarantee at
// the transport layer — if a future route adds a less-constrained path
// param, `/` or `?` in the value cannot silently change the requested
// route. Centralizing the call keeps the safety property uniform
// across every endpoint template below.
const enc = encodeURIComponent;

// ApiRequestError.message is DEVELOPER-facing only. UI callers route
// through mapApiError (errors/apiErrorMapper.ts) and never read .message
// directly — the mapper owns string-selection for the UI. Fallback
// messages populated here use a `[dev]` prefix (S3) so any log that
// accidentally surfaces them is immediately recognizable as non-
// user-facing copy instead of masquerading as product strings.
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly extras?: Record<string, unknown>,
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
    return new ApiRequestError("[dev] Request aborted", 0, "ABORTED");
  }
  // The browser's TypeError/etc. may carry a stable message like "Failed
  // to fetch" — useful in logs, but we still force the `[dev]` prefix so
  // the class-level invariant holds: every ApiRequestError.message
  // produced inside this module is identifiable as developer-only copy
  // and can't be mistaken for a user-facing string in a stray log.
  const raw = err instanceof Error ? err.message : "Network request failed";
  return new ApiRequestError(`[dev] ${raw}`, 0, "NETWORK");
}

// S4 (2026-04-23 review): defensive cap on how many non-code/non-message
// keys we lift off the error envelope into ApiRequestError.extras. The
// server contract today ships at most 1-2 extras fields (e.g. `chapters`
// on IMAGE_IN_USE), and express.json limits request bodies to 5 MB —
// but a future server bug or hostile fixture could ship an envelope
// with hundreds of keys. Bounded copy keeps a pathological payload
// from bloating every subsequent log/toString of the error.
const MAX_EXTRAS_KEYS = 16;

function extractExtras(errorBody: unknown): Record<string, unknown> | undefined {
  if (!errorBody || typeof errorBody !== "object") return undefined;
  const { code: _c, message: _m, ...rest } = errorBody as Record<string, unknown>;
  const keys = Object.keys(rest);
  if (keys.length === 0) return undefined;
  const kept = keys.slice(0, MAX_EXTRAS_KEYS);
  const out: Record<string, unknown> = {};
  for (const k of kept) out[k] = rest[k];
  return out;
}

// Parse a !ok response's JSON error envelope into message/code/extras so
// blob and multipart transports can populate ApiRequestError with the
// same fidelity as apiFetch (I1). Swallows JSON parse failures — the
// caller already has a status-only fallback message.
async function readErrorEnvelope(
  res: Response,
  fallbackMessage: string,
): Promise<{
  message: string;
  code: string | undefined;
  extras: Record<string, unknown> | undefined;
}> {
  try {
    const body = (await res.json()) as ApiError;
    const message = body.error?.message ?? fallbackMessage;
    const code = body.error?.code;
    const extras = extractExtras(body.error);
    return { message, code, extras };
  } catch {
    return { message: fallbackMessage, code: undefined, extras: undefined };
  }
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
    let message = `[dev] HTTP ${res.status}`;
    let code: string | undefined;
    let extras: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as ApiError;
      message = body.error?.message ?? message;
      code = body.error?.code;
      // Capture any non-code/non-message fields on the error envelope so
      // callers can surface structured details (e.g. `chapters` on a 409
      // IMAGE_IN_USE). Keeping this generic means every new extras field
      // on the server becomes available on ApiRequestError without a
      // transport change. Capped at MAX_EXTRAS_KEYS (S4).
      extras = extractExtras(body.error);
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
    throw new ApiRequestError(message, res.status, code, extras);
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
    const message = err instanceof Error ? err.message : "[dev] Malformed response body";
    throw new ApiRequestError(message, res.status, "BAD_JSON");
  });
}

export const api = {
  projects: {
    list: () => apiFetch<ProjectListItem[]>("/projects"),

    get: (slug: string) => apiFetch<ProjectWithChapters>(`/projects/${enc(slug)}`),

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
      apiFetch<Project>(`/projects/${enc(slug)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    velocity: (slug: string) => apiFetch<VelocityResponse>(`/projects/${enc(slug)}/velocity`),

    delete: (slug: string) =>
      apiFetch<{ message: string }>(`/projects/${enc(slug)}`, { method: "DELETE" }),

    reorderChapters: (slug: string, chapterIds: string[]) =>
      apiFetch<{ message: string }>(`/projects/${enc(slug)}/chapters/order`, {
        method: "PUT",
        body: JSON.stringify({ chapter_ids: chapterIds }),
      }),

    trash: (slug: string) => apiFetch<Chapter[]>(`/projects/${enc(slug)}/trash`),

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
      }>(`/projects/${enc(slug)}/dashboard`),

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
      // I1: route offline/DNS/CSP/AbortError through classifyFetchError so
      // export errors flow through the same NETWORK/ABORTED classification
      // as apiFetch — the mapper contract breaks if a raw TypeError or
      // DOMException escapes here.
      const res = await fetch(`${BASE}/projects/${enc(slug)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        signal,
      }).catch((err: unknown) => {
        throw classifyFetchError(err);
      });

      if (!res.ok) {
        const { message, code, extras } = await readErrorEnvelope(
          res,
          `[dev] Export HTTP ${res.status}`,
        );
        throw new ApiRequestError(message, res.status, code, extras);
      }

      return res.blob();
    },
  },

  chapters: {
    get: (id: string) => apiFetch<Chapter>(`/chapters/${enc(id)}`),

    create: (projectSlug: string) =>
      apiFetch<Chapter>(`/projects/${enc(projectSlug)}/chapters`, { method: "POST" }),

    update: (
      id: string,
      data: {
        title?: string;
        content?: Record<string, unknown>;
        status?: string;
      },
      signal?: AbortSignal,
    ) =>
      apiFetch<Chapter>(`/chapters/${enc(id)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        // Only include `signal` when one was actually provided; otherwise
        // the fetch options object differs from the no-signal callers in
        // ways that break tests asserting the options shape (and can
        // subtly differ in fetch polyfills).
        ...(signal ? { signal } : {}),
      }),

    delete: (id: string) =>
      apiFetch<{ message: string }>(`/chapters/${enc(id)}`, { method: "DELETE" }),

    restore: (id: string) =>
      apiFetch<Chapter & { project_slug: string }>(`/chapters/${enc(id)}/restore`, {
        method: "POST",
      }),
  },

  chapterStatuses: {
    list: () => apiFetch<ChapterStatusRow[]>("/chapter-statuses"),
  },

  images: {
    list(projectId: string): Promise<ImageRow[]> {
      return apiFetch(`/projects/${enc(projectId)}/images`);
    },

    async upload(projectId: string, file: File): Promise<ImageRow> {
      const formData = new FormData();
      formData.append("file", file);
      // I1: wrap fetch() in classifyFetchError so offline/DNS/CSP failures
      // and abort from an upstream AbortController bubble as
      // ApiRequestError (NETWORK/ABORTED) rather than raw TypeError/
      // DOMException — the mapper contract requires every caller to see
      // a typed ApiRequestError.
      const res = await fetch(`${BASE}/projects/${enc(projectId)}/images`, {
        method: "POST",
        body: formData,
        // No Content-Type header — browser sets multipart boundary automatically
      }).catch((err: unknown) => {
        throw classifyFetchError(err);
      });
      if (!res.ok) {
        const { message, code, extras } = await readErrorEnvelope(
          res,
          `[dev] Upload HTTP ${res.status}`,
        );
        throw new ApiRequestError(message, res.status, code, extras);
      }
      // I1: body-read failures get the same ABORTED vs. BAD_JSON treatment
      // as apiFetch. A 2xx whose JSON parse fails means the server may
      // have stored the image but the client can't read the row — route
      // through the BAD_JSON/possiblyCommitted UX instead of a raw throw.
      return (res.json() as Promise<ImageRow>).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw classifyFetchError(err);
        }
        const message = err instanceof Error ? err.message : "[dev] Malformed response body";
        throw new ApiRequestError(message, res.status, "BAD_JSON");
      });
    },

    references(id: string): Promise<{ chapters: Array<{ id: string; title: string }> }> {
      return apiFetch(`/images/${enc(id)}/references`);
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
      return apiFetch(`/images/${enc(id)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },

    delete(id: string): Promise<{ deleted: boolean }> {
      return apiFetch(`/images/${enc(id)}`, { method: "DELETE" });
    },
  },

  snapshots: {
    list: (chapterId: string) =>
      apiFetch<SnapshotListItem[]>(`/chapters/${enc(chapterId)}/snapshots`),

    create: (chapterId: string, label?: string) =>
      apiFetch<
        { status: "created"; snapshot: SnapshotRow } | { status: "duplicate"; message: string }
      >(`/chapters/${enc(chapterId)}/snapshots`, {
        method: "POST",
        body: JSON.stringify(label ? { label } : {}),
      }),

    get: (id: string) => apiFetch<SnapshotRow>(`/snapshots/${enc(id)}`),

    delete: (id: string) => apiFetch<undefined>(`/snapshots/${enc(id)}`, { method: "DELETE" }),

    restore: (id: string) => apiFetch<Chapter>(`/snapshots/${enc(id)}/restore`, { method: "POST" }),
  },

  search: {
    find: (
      projectSlug: string,
      query: string,
      options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
      signal?: AbortSignal,
    ) =>
      apiFetch<SearchResult>(`/projects/${enc(projectSlug)}/search`, {
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
      apiFetch<ReplaceResult>(`/projects/${enc(projectSlug)}/replace`, {
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
