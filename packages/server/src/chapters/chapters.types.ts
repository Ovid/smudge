export interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: Record<string, unknown> | null;
  content_parse_failed?: boolean;
  sort_order: number;
  word_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ChapterRawRow {
  id: string;
  project_id: string;
  title: string;
  content: string | null;
  sort_order: number;
  word_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ChapterMetadataRow {
  id: string;
  title: string;
  status: string;
  word_count: number;
  updated_at: string;
  sort_order: number;
}

export interface DeletedChapterRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  word_count: number;
  sort_order: number;
  deleted_at: string;
  created_at: string;
  updated_at: string;
  content: null;
}

export interface ChapterWithLabel extends Omit<ChapterRow, "content_parse_failed"> {
  status_label: string;
}

export interface RestoredChapterResponse extends ChapterWithLabel {
  project_slug: string;
}

export interface UpdateChapterData {
  title?: string;
  content?: string;
  word_count?: number;
  status?: string;
  updated_at: string;
}

// --- Helpers ---

export function isCorruptChapter(chapter: { content_parse_failed?: boolean }): boolean {
  return chapter.content_parse_failed === true;
}

/**
 * Drop the internal `content_parse_failed` flag before a row crosses into a wire
 * type. The single owner of the corrupt-flag surface: adding a field to that
 * surface must mean editing exactly this function.
 *
 * I5 (dedup review 2026-07-26): generic over any row carrying the optional
 * flag, rather than `ChapterRow` only. The narrow signature is why
 * enrichChaptersWithLabels' generic overload — which sees
 * `{ status: string; content_parse_failed?: unknown }` — inlined its own strip
 * instead of calling this. Rest-destructuring an ABSENT key omits nothing, so
 * one unconditional call covers rows with and without the flag alike.
 */
export function stripParseFailedFlag<T extends { content_parse_failed?: unknown }>(
  chapter: T,
): Omit<T, "content_parse_failed"> {
  const { content_parse_failed: _, ...rest } = chapter;
  return rest;
}

// --- Status label enrichment ---

export interface StatusLabelProvider {
  getStatusLabel(status: string): Promise<string>;
  getStatusLabelMap(): Promise<Record<string, string>>;
}

export async function enrichChapterWithLabel(
  provider: StatusLabelProvider,
  chapter: ChapterRow,
): Promise<ChapterWithLabel> {
  const clean = stripParseFailedFlag(chapter);
  const status_label = await provider.getStatusLabel(chapter.status);
  return { ...clean, status_label };
}

export function enrichChaptersWithLabels(
  provider: StatusLabelProvider,
  chapters: ChapterRow[],
  labelMap?: Record<string, string>,
): Promise<ChapterWithLabel[]>;
export function enrichChaptersWithLabels<T extends { status: string }>(
  provider: StatusLabelProvider,
  chapters: T[],
  labelMap?: Record<string, string>,
): Promise<(T & { status_label: string })[]>;
export async function enrichChaptersWithLabels(
  provider: StatusLabelProvider,
  chapters: { status: string; content_parse_failed?: unknown }[],
  labelMap?: Record<string, string>,
): Promise<unknown[]> {
  const map = labelMap ?? (await provider.getStatusLabelMap());
  // I5: one unconditional call replaces the `in`-guarded pair of arms. The
  // guard was behaviorally redundant — rest-destructuring an absent key omits
  // nothing — so both arms collapse into the shared helper.
  return chapters.map((ch) => ({
    ...stripParseFailedFlag(ch),
    status_label: map[ch.status] ?? ch.status,
  }));
}

export interface CreateChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: string | null;
  sort_order: number;
  word_count: number;
  status?: string;
  created_at: string;
  updated_at: string;
}
