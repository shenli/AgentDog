import React, { useMemo } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import type { ContextSnapshotRow, CompactionEventRow, TurnRow } from "../../lib/api"
import { formatTokens } from "../../lib/format"

interface Props {
  snapshots: ContextSnapshotRow[]
  turns: TurnRow[]
  compactions: CompactionEventRow[]
  contextWindow: number
}

export function ContextChart({ snapshots, turns, compactions, contextWindow }: Props) {
  const data = useMemo(() => {
    // Use turn data — context_tokens_used now has the full context size
    return turns.map((t) => ({
      turn: t.turn_number,
      contextUsed: t.context_tokens_used,
      available: Math.max(contextWindow - t.context_tokens_used, 0),
    }))
  }, [turns, contextWindow])

  if (data.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
        No context data yet
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-4">
        Context Size Over Time
      </h3>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
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
            tickFormatter={(v: number) => formatTokens(v)}
            domain={[0, contextWindow]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => [
              value.toLocaleString() + " tokens",
              name,
            ]}
            labelFormatter={(label) => `Turn ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: "11px" }} />

          {/* Reference line for context window limit */}
          <ReferenceLine
            y={contextWindow}
            stroke="#52525b"
            strokeDasharray="3 3"
            label={{
              value: `${formatTokens(contextWindow)} limit`,
              fill: "#52525b",
              fontSize: 10,
              position: "right",
            }}
          />

          <Area
            type="monotone"
            dataKey="contextUsed"
            fill="#3b82f6"
            stroke="#3b82f6"
            fillOpacity={0.3}
            name="Context Used"
          />

          {compactions.map((c, i) => {
            const closest = turns.reduce((prev, curr) =>
              Math.abs(curr.timestamp - c.timestamp) < Math.abs(prev.timestamp - c.timestamp)
                ? curr
                : prev
            )
            return closest ? (
              <ReferenceLine
                key={i}
                x={closest.turn_number}
                stroke="#ef4444"
                strokeDasharray="3 3"
                label={{
                  value: "compact",
                  fill: "#ef4444",
                  fontSize: 10,
                  position: "top",
                }}
              />
            ) : null
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
