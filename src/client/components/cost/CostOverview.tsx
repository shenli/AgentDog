import React, { useState, useEffect } from "react"
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
import { api, type DailyCostRow, AGENT_LABELS } from "../../lib/api"
import { formatCost, formatTokens } from "../../lib/format"

export function CostOverview() {
  const [data, setData] = useState<DailyCostRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.dailyCostSummary().then((rows) => {
      setData(rows)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return null
  if (data.length === 0) return null

  // Aggregate by day, split by agent
  const byDay = new Map<string, Record<string, number>>()
  let totalCost = 0
  let totalTokens = 0

  for (const row of data) {
    const agent = row.agent_type ?? "unknown"
    const existing = byDay.get(row.day) ?? {}
    existing[agent] = (existing[agent] ?? 0) + row.total_cost
    existing.total = (existing.total ?? 0) + row.total_cost
    byDay.set(row.day, existing)
    totalCost += row.total_cost
    totalTokens += row.total_input_tokens + row.total_output_tokens
  }

  const chartData = Array.from(byDay.entries())
    .map(([day, costs]) => ({ day: day.slice(5), ...costs }))
    .reverse()
    .slice(-30)

  const agents = [...new Set(data.map((d) => d.agent_type ?? "unknown"))]

  const agentColors: Record<string, string> = {
    claude_code: "#f97316",
    codex_cli: "#10b981",
    openclaw: "#8b5cf6",
    unknown: "#71717a",
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-400">
          Daily Cost (All Agents)
        </h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-zinc-500">
            Total: <span className="text-zinc-300 font-medium">{formatCost(totalCost)}</span>
          </span>
          <span className="text-zinc-500">
            Tokens: <span className="text-zinc-300 font-medium">{formatTokens(totalTokens)}</span>
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="day" stroke="#52525b" fontSize={10} tickLine={false} />
          <YAxis
            stroke="#52525b"
            fontSize={10}
            tickLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => [
              formatCost(value),
              AGENT_LABELS[name as keyof typeof AGENT_LABELS] ?? name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: "10px" }}
            formatter={(value: string) => AGENT_LABELS[value as keyof typeof AGENT_LABELS] ?? value}
          />
          {agents.map((agent) => (
            <Bar
              key={agent}
              dataKey={agent}
              stackId="cost"
              fill={agentColors[agent] ?? "#71717a"}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
