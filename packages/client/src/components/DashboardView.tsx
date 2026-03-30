import { useEffect, useState, useCallback } from "react";
import type { ChapterStatusRow } from "@smudge/shared";
import { api } from "../api/client";
import { STRINGS } from "../strings";

type DashboardChapter = {
  id: string;
  title: string;
  status: string;
  status_label: string;
  word_count: number;
  updated_at: string;
  sort_order: number;
};

type DashboardData = Awaited<ReturnType<typeof api.projects.dashboard>>;

type SortKey = "sort_order" | "title" | "status" | "word_count" | "updated_at";

interface DashboardViewProps {
  slug: string;
  statuses: ChapterStatusRow[];
  onNavigateToChapter: (chapterId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  outline: "#8B9E7C",
  rough_draft: "#C07850",
  revised: "#B8973E",
  edited: "#6B7F94",
  final: "#6B4E3D",
};

export function DashboardView({ slug, statuses, onNavigateToChapter }: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sort_order");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    api.projects.dashboard(slug).then(setData).catch(console.error);
  }, [slug]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortAsc((prev) => !prev);
      } else {
        setSortKey(key);
        setSortAsc(true);
      }
    },
    [sortKey],
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-text-muted">{STRINGS.nav.loading}</p>
      </div>
    );
  }

  const { chapters, status_summary, totals } = data;

  // Find chapter names for most/least recent edit
  const mostRecentChapter = chapters.length > 0
    ? chapters.reduce((a, b) => (a.updated_at > b.updated_at ? a : b))
    : null;
  const leastRecentChapter = chapters.length > 0
    ? chapters.reduce((a, b) => (a.updated_at < b.updated_at ? a : b))
    : null;

  // Sort chapters
  const sortedChapters = [...chapters].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    switch (sortKey) {
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "status":
        return dir * a.status.localeCompare(b.status);
      case "word_count":
        return dir * (a.word_count - b.word_count);
      case "updated_at":
        return dir * a.updated_at.localeCompare(b.updated_at);
      case "sort_order":
      default:
        return dir * (a.sort_order - b.sort_order);
    }
  });

  const totalStatusCount = Object.values(status_summary).reduce((s, n) => s + n, 0);

  // Build status label map from statuses prop
  const statusLabelMap: Record<string, string> = Object.fromEntries(
    statuses.map((s) => [s.status, s.label]),
  );

  return (
    <div className="mx-auto max-w-[720px] px-6 py-8">
      <h2 className="text-2xl font-serif text-text-primary mb-6">{STRINGS.dashboard.heading}</h2>

      {chapters.length === 0 ? (
        <div data-testid="dashboard-empty">
          <p className="text-text-muted mb-2">{STRINGS.dashboard.emptyState}</p>
          <p className="text-text-muted">{STRINGS.dashboard.totalWordCount(0)}</p>
          <p className="text-text-muted">{STRINGS.dashboard.totalChapters(0)}</p>
        </div>
      ) : (
        <>
          {/* Health bar */}
          <section aria-label="Manuscript health" className="mb-8 space-y-1">
            <p className="text-text-primary font-medium">
              {STRINGS.dashboard.totalWordCount(totals.word_count)}
            </p>
            <p className="text-text-secondary text-sm">
              {STRINGS.dashboard.totalChapters(totals.chapter_count)}
            </p>
            {totals.most_recent_edit && mostRecentChapter && (
              <p className="text-text-secondary text-sm">
                {STRINGS.dashboard.mostRecentEdit(totals.most_recent_edit, mostRecentChapter.title)}
              </p>
            )}
            {totals.least_recent_edit && leastRecentChapter && (
              <p className="text-text-secondary text-sm">
                {STRINGS.dashboard.leastRecentEdit(totals.least_recent_edit, leastRecentChapter.title)}
              </p>
            )}
          </section>

          {/* Status summary bar */}
          {totalStatusCount > 0 && (
            <section aria-label="Status summary" className="mb-8">
              <div className="flex h-4 rounded overflow-hidden mb-2">
                {Object.entries(status_summary).map(([status, count]) => {
                  if (count === 0) return null;
                  const pct = (count / totalStatusCount) * 100;
                  return (
                    <div
                      key={status}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: STATUS_COLORS[status] ?? "#999",
                      }}
                      title={`${statusLabelMap[status] ?? status}: ${count}`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
                {Object.entries(status_summary).map(([status, count]) => (
                  <span key={status} className="flex items-center gap-1">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[status] ?? "#999" }}
                    />
                    {statusLabelMap[status] ?? status}: {count}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Chapter table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-4">
                  <button
                    onClick={() => handleSort("title")}
                    className="font-medium text-text-secondary hover:text-text-primary"
                  >
                    {STRINGS.dashboard.columnTitle}
                  </button>
                </th>
                <th className="py-2 pr-4">
                  <button
                    onClick={() => handleSort("status")}
                    className="font-medium text-text-secondary hover:text-text-primary"
                  >
                    {STRINGS.dashboard.columnStatus}
                  </button>
                </th>
                <th className="py-2 pr-4">
                  <button
                    onClick={() => handleSort("word_count")}
                    className="font-medium text-text-secondary hover:text-text-primary"
                  >
                    {STRINGS.dashboard.columnWordCount}
                  </button>
                </th>
                <th className="py-2">
                  <button
                    onClick={() => handleSort("updated_at")}
                    className="font-medium text-text-secondary hover:text-text-primary"
                  >
                    {STRINGS.dashboard.columnLastEdited}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedChapters.map((chapter) => (
                <tr key={chapter.id} className="border-b border-border">
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => onNavigateToChapter(chapter.id)}
                      className="text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
                    >
                      {chapter.title}
                    </button>
                  </td>
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[chapter.status] ?? "#999" }}
                      />
                      {chapter.status_label}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-text-secondary">
                    {chapter.word_count.toLocaleString()}
                  </td>
                  <td className="py-2 text-text-secondary">
                    {new Date(chapter.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
