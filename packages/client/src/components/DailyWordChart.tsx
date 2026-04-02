import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { STRINGS } from "../strings";

interface DailyWordChartProps {
  data: Array<{ date: string; net_words: number }>;
  dailyAverage: number;
}

export function DailyWordChart({ data, dailyAverage }: DailyWordChartProps) {
  if (data.length === 0) return null;

  return (
    <div aria-label={STRINGS.velocity.chartDailyLabel} className="mb-8">
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
            formatter={(value: number) => [value.toLocaleString(), STRINGS.velocity.netWords]}
          />
          <Bar dataKey="net_words" fill="#6B4720" radius={[2, 2, 0, 0]} />
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
    </div>
  );
}
