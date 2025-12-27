"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export function MetricChart({
  data,
  label,
}: {
  data: { ts: string; count: number }[];
  label: string;
}) {
  return (
    <div className="h-64 w-full rounded-xl border border-white/10 p-4">
      <h3 className="mb-2 text-sm font-medium text-white/80">{label}</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis
            dataKey="ts"
            tickFormatter={v => new Date(v).getHours().toString()}
          />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey="count" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
