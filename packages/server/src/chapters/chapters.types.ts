export interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: Record<string, unknown> | null;
  content_corrupt?: boolean;
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

export interface ChapterWithLabel extends Omit<ChapterRow, "content_corrupt"> {
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

export function isCorruptChapter(chapter: { content_corrupt?: boolean }): boolean {
  return chapter.content_corrupt === true;
}

export function stripCorruptFlag(chapter: ChapterRow): Omit<ChapterRow, "content_corrupt"> {
  const { content_corrupt: _, ...rest } = chapter;
  return rest;
}

// --- Status label enrichment ---

interface StatusLabelProvider {
  getStatusLabel(status: string): Promise<string>;
  getStatusLabelMap(): Promise<Record<string, string>>;
}

export async function enrichChapterWithLabel(
  provider: StatusLabelProvider,
  chapter: ChapterRow,
): Promise<ChapterWithLabel> {
  const clean = stripCorruptFlag(chapter);
  const status_label = await provider.getStatusLabel(chapter.status);
  return { ...clean, status_label };
}

export async function enrichChaptersWithLabels<T extends { status: string }>(
  provider: StatusLabelProvider,
  chapters: T[],
): Promise<(T & { status_label: string })[]> {
  const map = await provider.getStatusLabelMap();
  return chapters.map((ch) => ({ ...ch, status_label: map[ch.status] ?? ch.status }));
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
