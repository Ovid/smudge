import type { VelocityResponse } from "@smudge/shared";
import { STRINGS } from "../strings";

interface ProgressStripProps {
  data: VelocityResponse | null;
  loading: boolean;
}

export function ProgressStrip({ data, loading }: ProgressStripProps) {
  if (loading && !data) {
    return (
      <section aria-label={STRINGS.velocity.progressLabel} className="mb-8">
        <div className="h-6 bg-bg-secondary/50 rounded animate-pulse" />
      </section>
    );
  }

  if (!data) {
    return (
      <section aria-label={STRINGS.velocity.progressLabel} className="mb-8">
        <p className="text-text-muted text-sm font-sans">{STRINGS.velocity.emptyState}</p>
      </section>
    );
  }

  const targetWc = data.target_word_count;
  const hasTarget = targetWc !== null;
  const percentage = hasTarget ? Math.min(100, (data.current_total / targetWc) * 100) : 0;

  const segments: string[] = [];

  if (hasTarget) {
    segments.push(STRINGS.velocity.wordsOfTarget(data.current_total, targetWc));
  } else {
    segments.push(STRINGS.velocity.wordsTotal(data.current_total));
  }

  if (data.days_until_deadline !== null) {
    segments.push(STRINGS.velocity.daysRemaining(data.days_until_deadline));
  }

  if (data.required_pace !== null) {
    segments.push(STRINGS.velocity.requiredPace(data.required_pace));
  }

  const recentPace =
    data.daily_average_30d !== null && data.daily_average_30d > 0
      ? data.daily_average_30d
      : data.daily_average_7d;
  if (recentPace !== null && recentPace > 0) {
    segments.push(STRINGS.velocity.dailyAverage(recentPace));
  }

  return (
    <section aria-label={STRINGS.velocity.progressLabel} className="mb-8">
      {hasTarget && (
        <div
          role="progressbar"
          aria-valuenow={data.current_total}
          aria-valuemin={0}
          aria-valuemax={targetWc}
          aria-label={STRINGS.velocity.wordsOfTarget(data.current_total, targetWc)}
          className="h-3 rounded-full overflow-hidden bg-bg-secondary mb-3"
        >
          <div
            className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
            style={{
              width: `${percentage}%`,
              backgroundColor: "var(--color-accent, #6B4720)",
            }}
          />
        </div>
      )}
      <p className="text-sm text-text-secondary font-sans">{segments.join(". ")}.</p>
    </section>
  );
}
