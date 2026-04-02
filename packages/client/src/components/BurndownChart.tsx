import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { STRINGS } from "../strings";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface BurndownChartProps {
  snapshots: Array<{ date: string; total_word_count: number }>;
  targetWordCount: number | null;
  targetDeadline: string | null;
  startDate: string;
}

export function BurndownChart({
  snapshots,
  targetWordCount,
  targetDeadline,
  startDate,
}: BurndownChartProps) {
  const prefersReducedMotion = useReducedMotion();

  if (targetWordCount === null || targetDeadline === null) return null;
  if (snapshots.length === 0) return null;

  // Build planned pace data: linear from start to target
  const startMs = new Date(startDate + "T00:00:00").getTime();
  const endMs = new Date(targetDeadline + "T00:00:00").getTime();
  const startWordCount = snapshots[0].total_word_count;
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)));

  // Generate planned pace points for each snapshot date plus the deadline
  const allDates = new Set(snapshots.map((s) => s.date));
  allDates.add(targetDeadline);

  const chartData = Array.from(allDates)
    .sort()
    .map((date) => {
      const dateMs = new Date(date + "T00:00:00").getTime();
      const dayIndex = Math.ceil((dateMs - startMs) / (1000 * 60 * 60 * 24));
      const planned = startWordCount + ((targetWordCount - startWordCount) * dayIndex) / totalDays;

      const snapshot = snapshots.find((s) => s.date === date);

      return {
        date,
        planned: Math.round(planned),
        actual: snapshot ? snapshot.total_word_count : undefined,
      };
    });

  return (
    <div aria-label={STRINGS.velocity.chartBurndownLabel} className="mb-8">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#78716c" }}
            tickFormatter={(d: string) => {
              const dt = new Date(d + "T00:00:00");
              return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
            }}
          />
          <YAxis tick={{ fontSize: 10, fill: "#78716c" }} width={60} />
          <Tooltip
            formatter={(value: number, name: string) => [
              value.toLocaleString(),
              name === "planned" ? "Planned" : "Actual",
            ]}
          />
          <Line
            type="monotone"
            dataKey="planned"
            stroke="#6B4720"
            strokeOpacity={0.4}
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={!prefersReducedMotion}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#6B4720"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={!prefersReducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Hidden data table for screen readers */}
      <div className="sr-only">
        <table aria-label={STRINGS.velocity.chartBurndownLabel}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Planned</th>
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.planned}</td>
                <td>{d.actual ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
