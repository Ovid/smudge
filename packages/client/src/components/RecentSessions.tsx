import type { VelocityResponse } from "../api/client";
import { STRINGS } from "../strings";

interface RecentSessionsProps {
  sessions: VelocityResponse["sessions"];
  chapterNames: Record<string, string>;
}

function formatSessionDate(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const sessionDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

  let dayLabel: string;
  if (sessionDay.getTime() === today.getTime()) {
    dayLabel = STRINGS.velocity.today;
  } else if (sessionDay.getTime() === yesterday.getTime()) {
    dayLabel = STRINGS.velocity.yesterday;
  } else {
    dayLabel = startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startTime = startDate.toLocaleTimeString(undefined, timeOpts);
  const endTime = endDate.toLocaleTimeString(undefined, timeOpts);

  return `${dayLabel}, ${startTime}\u2009\u2013\u2009${endTime}`;
}

export function RecentSessions({ sessions, chapterNames }: RecentSessionsProps) {
  if (sessions.length === 0) return null;

  const recentFive = sessions.slice(-5).reverse();

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-text-muted font-sans uppercase tracking-wide mb-3">
        {STRINGS.velocity.recentSessions}
      </h2>
      <ol className="space-y-2">
        {recentFive.map((session) => {
          const dateStr = formatSessionDate(session.start, session.end);
          const sign = session.net_words >= 0 ? "+" : "";
          const chapterLabel = session.chapters_touched
            .map((id) => chapterNames[id] ?? STRINGS.velocity.unknownChapter)
            .join(", ");

          return (
            <li
              key={`${session.start}-${session.end}`}
              className="text-sm text-text-secondary font-sans"
            >
              {dateStr} &middot;{" "}
              {session.duration_minutes > 0
                ? `${session.duration_minutes} min`
                : STRINGS.velocity.lessThanOneMin}{" "}
              &middot; {sign}
              {session.net_words.toLocaleString()} {STRINGS.velocity.netWords} &middot;{" "}
              {chapterLabel}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
