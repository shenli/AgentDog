import React from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import type { TurnRow } from "../../lib/api"
import { formatTokens } from "../../lib/format"

interface Props {
  turns: TurnRow[]
  isMax: boolean
}

export function CostChart({ turns, isMax }: Props) {
  if (turns.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
        No turn data yet
      </div>
    )
  }

  const data = turns.map((t) => {
    if (isMax) {
      // Max plan: show token breakdown per turn
      return {
        turn: t.turn_number,
        input: t.input_tokens,
        output: t.output_tokens,
        cacheWrite: t.cache_write_tokens,
        cacheRead: t.cache_read_tokens,
        isBackground: !!t.is_background_process,
      }
    } else {
      // API/Pro plan: show cost breakdown per turn
      const totalTokens =
        t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens
      const inputRatio = totalTokens > 0 ? t.input_tokens / totalTokens : 0
      const outputRatio = totalTokens > 0 ? t.output_tokens / totalTokens : 0
      const cacheWriteRatio = totalTokens > 0 ? t.cache_write_tokens / totalTokens : 0
      const cacheReadRatio = totalTokens > 0 ? t.cache_read_tokens / totalTokens : 0

      return {
        turn: t.turn_number,
        input: +(t.cost_usd * inputRatio).toFixed(6),
        output: +(t.cost_usd * outputRatio).toFixed(6),
        cacheWrite: +(t.cost_usd * cacheWriteRatio).toFixed(6),
        cacheRead: +(t.cost_usd * cacheReadRatio).toFixed(6),
        isBackground: !!t.is_background_process,
      }
    }
  })

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-4">
        {isMax ? "Tokens per Turn" : "Cost per Turn"}
      </h3>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
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
            tickFormatter={isMax
              ? (v: number) => formatTokens(v)
              : (v: number) => `$${v.toFixed(3)}`
            }
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => [
              isMax
                ? `${value.toLocaleString()} tokens`
                : `$${value.toFixed(5)}`,
              name,
            ]}
            labelFormatter={(label) => `Turn ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: "11px" }} />
          <Bar
            dataKey="input"
            stackId="a"
            fill="#3b82f6"
            name="Input"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="output"
            stackId="a"
            fill="#8b5cf6"
            name="Output"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="cacheWrite"
            stackId="a"
            fill="#f59e0b"
            name="Cache Write"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="cacheRead"
            stackId="a"
            fill="#22c55e"
            name="Cache Read"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
