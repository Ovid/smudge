import { useEffect, useState } from "react";
import { calculateWordsToday } from "@smudge/shared";
import type { VelocityResponse } from "../api/client";
import { api } from "../api/client";
import { STRINGS } from "../strings";
import { SummaryStrip } from "./SummaryStrip";
import { DailyWordChart } from "./DailyWordChart";
import { BurndownChart } from "./BurndownChart";
import { RecentSessions } from "./RecentSessions";

interface VelocityViewProps {
  slug: string;
}

function computeDailyNetWords(
  snapshots: Array<{ date: string; total_word_count: number }>,
): Array<{ date: string; net_words: number }> {
  if (snapshots.length < 2) return [];
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const result: Array<{ date: string; net_words: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];
    if (!current || !previous) continue;
    result.push({
      date: current.date,
      net_words: current.total_word_count - previous.total_word_count,
    });
  }
  return result;
}

export function VelocityView({ slug }: VelocityViewProps) {
  const [data, setData] = useState<VelocityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    api.projects
      .velocity(slug)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setError(err instanceof Error ? err.message : "Failed to load velocity data");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

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

  // Empty state: no sessions and no snapshots
  if (data.sessions.length === 0 && data.daily_snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-text-muted">{STRINGS.velocity.emptyState}</p>
      </div>
    );
  }

  // `now` is captured once via useState lazy initializer (pure during render)
  const today = new Date(now).toISOString().slice(0, 10);
  const daysRemaining = data.projection.target_deadline
    ? Math.max(
        0,
        Math.ceil(
          (new Date(data.projection.target_deadline).getTime() - now) / (1000 * 60 * 60 * 24),
        ),
      )
    : null;
  const lastSnapshot = data.daily_snapshots[data.daily_snapshots.length - 1];
  const currentTotal = lastSnapshot ? lastSnapshot.total_word_count : 0;
  const wordsToday = calculateWordsToday(currentTotal, data.daily_snapshots, today);
  const dailyNetWords = computeDailyNetWords(data.daily_snapshots);
  const sortedSnapshots = [...data.daily_snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = sortedSnapshots[0]?.date ?? today;

  return (
    <div>
      <SummaryStrip
        wordsToday={wordsToday}
        dailyAverage={data.projection.daily_average_30d}
        currentStreak={data.streak.current}
        bestStreak={data.streak.best}
        daysRemaining={daysRemaining}
        projection={data.projection}
        completion={data.completion}
      />

      <DailyWordChart data={dailyNetWords} dailyAverage={data.projection.daily_average_30d} />

      <BurndownChart
        snapshots={data.daily_snapshots}
        targetWordCount={data.projection.target_word_count}
        targetDeadline={data.projection.target_deadline}
        startDate={startDate}
      />

      <RecentSessions sessions={data.sessions} />
    </div>
  );
}
