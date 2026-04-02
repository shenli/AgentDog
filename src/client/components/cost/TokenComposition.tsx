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
} from "recharts"
import type { TurnRow, ToolCallRow } from "../../lib/api"
import { formatTokens } from "../../lib/format"

interface Props {
  turns: TurnRow[]
  tools: ToolCallRow[]
}

export function TokenComposition({ turns, tools }: Props) {
  const data = useMemo(() => {
    // Build a map of turn_number -> estimated tool output tokens
    const toolTokensByTurn = new Map<number, number>()
    for (const tool of tools) {
      const est = Math.ceil((tool.output_size_bytes ?? 0) / 4)
      toolTokensByTurn.set(
        tool.turn_number,
        (toolTokensByTurn.get(tool.turn_number) ?? 0) + est
      )
    }

    return turns
      .filter((t) => !t.is_background_process)
      .map((t) => {
        const toolOutputTokens = toolTokensByTurn.get(t.turn_number) ?? 0
        const totalInput = t.input_tokens + t.cache_read_tokens + t.cache_write_tokens
        // Rough breakdown: tool output tokens are part of input, remainder is prompt + conversation
        const promptAndConversation = Math.max(totalInput - toolOutputTokens, 0)

        return {
          turn: t.turn_number,
          output: t.output_tokens,
          toolOutput: Math.min(toolOutputTokens, totalInput),
          promptAndConversation,
          cacheRead: t.cache_read_tokens,
        }
      })
  }, [turns, tools])

  if (data.length < 2) return null

  // Calculate waste metrics
  const totalToolTokens = data.reduce((sum, d) => sum + d.toolOutput, 0)
  const totalAllTokens = data.reduce(
    (sum, d) => sum + d.output + d.toolOutput + d.promptAndConversation,
    0
  )
  const toolPct = totalAllTokens > 0 ? (totalToolTokens / totalAllTokens) * 100 : 0

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-400">
          Token Composition per Turn
        </h3>
        {toolPct > 25 && (
          <span className="text-xs text-amber-400">
            Tool outputs: {toolPct.toFixed(0)}% of tokens
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="turn" stroke="#52525b" fontSize={11} tickLine={false} />
          <YAxis
            stroke="#52525b"
            fontSize={11}
            tickLine={false}
            tickFormatter={(v: number) => formatTokens(v)}
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
          <Area
            type="monotone"
            dataKey="promptAndConversation"
            stackId="tokens"
            fill="#3b82f6"
            stroke="#3b82f6"
            fillOpacity={0.4}
            name="Prompt + Conversation"
          />
          <Area
            type="monotone"
            dataKey="toolOutput"
            stackId="tokens"
            fill="#f59e0b"
            stroke="#f59e0b"
            fillOpacity={0.4}
            name="Tool Output"
          />
          <Area
            type="monotone"
            dataKey="output"
            stackId="tokens"
            fill="#8b5cf6"
            stroke="#8b5cf6"
            fillOpacity={0.4}
            name="Model Output"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
