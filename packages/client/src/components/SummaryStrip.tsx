import type { VelocityResponse } from "../api/client";
import { STRINGS } from "../strings";

interface SummaryStripProps {
  wordsToday: number;
  dailyAverage: number;
  currentStreak: number;
  bestStreak: number;
  daysRemaining: number | null;
  projection: VelocityResponse["projection"];
  completion: VelocityResponse["completion"];
  currentTotal: number;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted font-sans uppercase tracking-wide">{label}</span>
      <span className="text-lg font-semibold text-text-primary font-sans">{value}</span>
    </div>
  );
}

export function SummaryStrip({
  wordsToday,
  dailyAverage,
  currentStreak,
  bestStreak,
  daysRemaining,
  projection,
  completion,
  currentTotal,
}: SummaryStripProps) {
  return (
    <section className="flex flex-wrap gap-6 mb-8" aria-label={STRINGS.velocity.summaryLabel}>
      <MetricCard
        label={STRINGS.velocity.wordsToday}
        value={`${wordsToday > 0 ? "+" : ""}${wordsToday.toLocaleString()}`}
      />
      <MetricCard
        label={STRINGS.velocity.dailyAverage}
        value={dailyAverage !== 0 ? dailyAverage.toLocaleString() : STRINGS.velocity.noAverage}
      />
      <MetricCard
        label={STRINGS.velocity.currentStreak}
        value={`${currentStreak} ${STRINGS.velocity.days}`}
      />
      <MetricCard
        label={STRINGS.velocity.bestStreak}
        value={`${bestStreak} ${STRINGS.velocity.days}`}
      />

      {projection.target_word_count !== null && (
        <MetricCard
          label={STRINGS.velocity.projected}
          value={
            projection.projected_date
              ? new Date(projection.projected_date + "T00:00:00").toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : STRINGS.velocity.noProjection
          }
        />
      )}

      {projection.target_word_count !== null && (
        <MetricCard
          label={STRINGS.velocity.target}
          value={`${currentTotal.toLocaleString()} / ${projection.target_word_count.toLocaleString()} (${Math.round((currentTotal / projection.target_word_count) * 100)}%)`}
        />
      )}

      {projection.target_deadline !== null && daysRemaining !== null && (
        <MetricCard label={STRINGS.velocity.daysRemaining} value={`${daysRemaining}`} />
      )}

      {completion.total_chapters > 0 && (
        <MetricCard
          label={STRINGS.velocity.chaptersComplete}
          value={`${completion.completed_chapters} of ${completion.total_chapters}${completion.threshold_status ? ` ${STRINGS.velocity.atOrBeyond(completion.threshold_status)}` : ""}`}
        />
      )}
    </section>
  );
}
