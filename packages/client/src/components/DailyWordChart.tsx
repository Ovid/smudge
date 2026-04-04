import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { RectangleProps } from "recharts";
import { STRINGS } from "../strings";
import { useReducedMotion } from "../hooks/useReducedMotion";

function WordBar(props: RectangleProps & { payload?: { net_words?: number } }) {
  const { x, y, width, height, payload } = props;
  const isNegative = (payload?.net_words ?? 0) < 0;
  const rx = isNegative ? 0 : 2;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={rx}
      ry={rx}
      fill="#6B4720"
      fillOpacity={isNegative ? 0.4 : 1}
    />
  );
}

interface DailyWordChartProps {
  data: Array<{ date: string; net_words: number }>;
  dailyAverage: number;
}

export function DailyWordChart({ data, dailyAverage }: DailyWordChartProps) {
  const prefersReducedMotion = useReducedMotion();

  if (data.length === 0) return null;

  const firstDate = data[0]?.date;
  const lastDate = data[data.length - 1]?.date;
  const dynamicLabel = `${STRINGS.velocity.chartDailyLabel}. ${data.length} days shown${firstDate && lastDate ? `, ${firstDate} to ${lastDate}` : ""}. 30-day average: ${Math.round(dailyAverage).toLocaleString()} words per day`;

  return (
    <div aria-label={dynamicLabel} className="mb-8">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#78716c" }}
            tickFormatter={(d: string) => {
              const date = new Date(d + "T00:00:00");
              return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
            }}
          />
          <YAxis tick={{ fontSize: 10, fill: "#78716c" }} width={50} />
          <Tooltip
            formatter={(value) => [Number(value ?? 0).toLocaleString(), STRINGS.velocity.netWords]}
          />
          <Bar dataKey="net_words" isAnimationActive={!prefersReducedMotion} shape={<WordBar />} />
          {dailyAverage > 0 && (
            <ReferenceLine
              y={dailyAverage}
              stroke="#6B4720"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
          )}
        </BarChart>
      </ResponsiveContainer>

      {/* Hidden data table for screen readers */}
      <div className="sr-only">
        <table aria-label={STRINGS.velocity.chartDailyLabel}>
          <thead>
            <tr>
              <th>{STRINGS.velocity.columnDate}</th>
              <th>{STRINGS.velocity.columnNetWords}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.net_words}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
