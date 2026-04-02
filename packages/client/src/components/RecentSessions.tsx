import type { VelocityResponse } from "../api/client";
import { STRINGS } from "../strings";

interface RecentSessionsProps {
  sessions: VelocityResponse["sessions"];
}

export function RecentSessions({ sessions }: RecentSessionsProps) {
  if (sessions.length === 0) return null;

  const recentFive = sessions.slice(0, 5);

  return (
    <section className="mb-8">
      <h3 className="text-sm font-medium text-text-muted font-sans uppercase tracking-wide mb-3">
        {STRINGS.velocity.recentSessions}
      </h3>
      <ol className="space-y-2">
        {recentFive.map((session, i) => {
          const date = new Date(session.start);
          const dateStr = date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          const sign = session.net_words >= 0 ? "+" : "";

          return (
            <li key={i} className="text-sm text-text-secondary font-sans">
              {dateStr} &middot; {session.duration_minutes} min &middot;{" "}
              {sign}{session.net_words.toLocaleString()} {STRINGS.velocity.netWords} &middot;{" "}
              {session.chapters_touched.length}{" "}
              {session.chapters_touched.length === 1 ? "chapter" : "chapters"}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
