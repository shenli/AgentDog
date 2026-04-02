import React, { useMemo } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import type { TurnRow } from "../../lib/api"
import { formatPercent } from "../../lib/format"

interface Props {
  turns: TurnRow[]
}

export function CacheEfficiencyChart({ turns }: Props) {
  const data = useMemo(() => {
    return turns
      .filter((t) => !t.is_background_process)
      .map((t) => {
        const totalInput = t.input_tokens + t.cache_read_tokens + t.cache_write_tokens
        const hitRate = totalInput > 0 ? t.cache_read_tokens / totalInput : 0
        return {
          turn: t.turn_number,
          hitRate: +(hitRate * 100).toFixed(1),
          cacheRead: t.cache_read_tokens,
          inputTokens: t.input_tokens,
        }
      })
  }, [turns])

  // Detect cache invalidation events (>30pp drop between consecutive turns)
  const invalidations = useMemo(() => {
    const events: number[] = []
    for (let i = 1; i < data.length; i++) {
      const drop = data[i - 1].hitRate - data[i].hitRate
      if (drop > 30 && data[i - 1].hitRate > 40) {
        events.push(data[i].turn)
      }
    }
    return events
  }, [data])

  if (data.length < 2) return null

  const avgHitRate = data.reduce((sum, d) => sum + d.hitRate, 0) / data.length

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-400">
          Prompt Cache Efficiency
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">
            Avg: <span className="text-zinc-300 font-medium">{avgHitRate.toFixed(1)}%</span>
          </span>
          {invalidations.length > 0 && (
            <span className="text-amber-400">
              {invalidations.length} cache invalidation{invalidations.length > 1 ? "s" : ""} detected
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="turn"
            stroke="#52525b"
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            stroke="#52525b"
            fontSize={11}
            tickLine={false}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)}%`,
              "Cache Hit Rate",
            ]}
            labelFormatter={(label) => `Turn ${label}`}
          />
          <ReferenceLine
            y={avgHitRate}
            stroke="#52525b"
            strokeDasharray="3 3"
            label={{
              value: `avg ${avgHitRate.toFixed(0)}%`,
              fill: "#52525b",
              fontSize: 10,
              position: "right",
            }}
          />
          {invalidations.map((turn, i) => (
            <ReferenceLine
              key={i}
              x={turn}
              stroke="#f59e0b"
              strokeDasharray="3 3"
              label={{
                value: "cache miss",
                fill: "#f59e0b",
                fontSize: 9,
                position: "top",
              }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="hitRate"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
