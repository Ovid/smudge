import { useEffect, useState, useCallback } from "react";
import type { ChapterStatusRow } from "@smudge/shared";
import { api } from "../api/client";
import { STRINGS } from "../strings";
import { STATUS_COLORS } from "../statusColors";

type DashboardData = Awaited<ReturnType<typeof api.projects.dashboard>>;

type SortKey = "sort_order" | "title" | "status" | "word_count" | "updated_at";

interface DashboardViewProps {
  slug: string;
  statuses: ChapterStatusRow[];
  onNavigateToChapter: (chapterId: string) => void;
}

export function DashboardView({ slug, statuses, onNavigateToChapter }: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sort_order");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.projects
      .dashboard(slug)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setError(err instanceof Error ? err.message : STRINGS.error.loadDashboardFailed);
        }
      });
    return () => {
      cancelled = true;
    };
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

  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-status-error">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-text-muted">{STRINGS.nav.loading}</p>
      </div>
    );
  }

  const { chapters, status_summary, totals } = data;

  // Find chapter names for most/least recent edit
  const mostRecentChapter =
    chapters.length > 0 ? chapters.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)) : null;
  const leastRecentChapter =
    chapters.length > 0 ? chapters.reduce((a, b) => (a.updated_at < b.updated_at ? a : b)) : null;

  // Build status sort_order lookup from statuses prop
  const statusSortOrder: Record<string, number> = Object.fromEntries(
    statuses.map((s) => [s.status, s.sort_order]),
  );

  // Sort chapters
  const sortedChapters = [...chapters].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    switch (sortKey) {
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "status": {
        const orderA = statusSortOrder[a.status];
        const orderB = statusSortOrder[b.status];
        if (orderA != null && orderB != null) {
          return dir * (orderA - orderB);
        }
        return dir * a.status.localeCompare(b.status);
      }
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
          <section aria-label={STRINGS.dashboard.healthSectionLabel} className="mb-8 space-y-1">
            <p className="text-text-primary font-medium">
              {STRINGS.dashboard.totalWordCount(totals.word_count)}
            </p>
            <p className="text-text-secondary text-sm">
              {STRINGS.dashboard.totalChapters(totals.chapter_count)}
            </p>
            {mostRecentChapter && (
              <p className="text-text-secondary text-sm">
                {STRINGS.dashboard.mostRecentEdit(
                  mostRecentChapter.updated_at,
                  mostRecentChapter.title,
                )}
              </p>
            )}
            {leastRecentChapter && (
              <p className="text-text-secondary text-sm">
                {STRINGS.dashboard.leastRecentEdit(
                  leastRecentChapter.updated_at,
                  leastRecentChapter.title,
                )}
              </p>
            )}
          </section>

          {/* Status summary bar */}
          {totalStatusCount > 0 && (
            <section aria-label={STRINGS.dashboard.statusSummaryLabel} className="mb-8">
              <div
                className="flex h-4 rounded overflow-hidden mb-2"
                role="img"
                aria-label={STRINGS.dashboard.statusDistributionLabel}
              >
                {statuses.map((s) => {
                  const count = status_summary[s.status] ?? 0;
                  if (count === 0) return null;
                  const pct = (count / totalStatusCount) * 100;
                  return (
                    <div
                      key={s.status}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: STATUS_COLORS[s.status] ?? "#999",
                      }}
                      title={`${s.label}: ${count}`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
                {statuses.map((s) => (
                  <span key={s.status} className="flex items-center gap-1">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#999" }}
                    />
                    {s.label}: {status_summary[s.status] ?? 0}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Chapter table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {(
                  [
                    ["sort_order", STRINGS.dashboard.columnOrder, "py-2 pr-4 w-10"],
                    ["title", STRINGS.dashboard.columnTitle, "py-2 pr-4"],
                    ["status", STRINGS.dashboard.columnStatus, "py-2 pr-4"],
                    ["word_count", STRINGS.dashboard.columnWordCount, "py-2 pr-4"],
                    ["updated_at", STRINGS.dashboard.columnLastEdited, "py-2"],
                  ] as const
                ).map(([key, label, className]) => (
                  <th
                    key={key}
                    className={className}
                    aria-sort={sortKey === key ? (sortAsc ? "ascending" : "descending") : "none"}
                  >
                    <button
                      onClick={() => handleSort(key)}
                      className="font-medium text-text-secondary hover:text-text-primary"
                    >
                      {label}
                      {sortKey === key ? (sortAsc ? STRINGS.dashboard.sortAscending : STRINGS.dashboard.sortDescending) : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedChapters.map((chapter) => (
                <tr key={chapter.id} className="border-b border-border">
                  <td className="py-2 pr-4 text-text-muted text-center">
                    {chapter.sort_order + 1}
                  </td>
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
                        aria-hidden="true"
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
