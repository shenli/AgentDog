import React, { useState, useEffect } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts"
import type { Session, DailyCostRow, AgentType } from "../lib/api"
import { api, AGENT_LABELS } from "../lib/api"
import { formatCost, formatTokens } from "../lib/format"

interface Props {
  sessions: Session[]
  onSelectSession: (id: string) => void
  isMax: boolean
}

const AGENT_COLORS: Record<string, string> = {
  claude_code: "#f97316",
  codex_cli: "#10b981",
  openclaw: "#8b5cf6",
  unknown: "#71717a",
}

export function OverviewDashboard({ sessions, onSelectSession, isMax }: Props) {
  const [dailyCost, setDailyCost] = useState<DailyCostRow[]>([])

  useEffect(() => {
    api.dailyCostSummary().then(setDailyCost).catch(() => {})
  }, [])

  const active = sessions.filter((s) => s.status === "active")
  const totalTokensToday = sessions.reduce((s, sess) => s + sess.total_input_tokens + sess.total_output_tokens, 0)
  const totalCostToday = sessions.reduce((s, sess) => s + sess.total_cost_usd, 0)

  // Aggregate agents
  const agentCounts = new Map<string, number>()
  for (const s of sessions) {
    agentCounts.set(s.agent_type, (agentCounts.get(s.agent_type) ?? 0) + 1)
  }

  // Daily chart data
  const byDay = new Map<string, Record<string, number>>()
  for (const row of dailyCost) {
    const agent = row.agent_type ?? "unknown"
    const existing = byDay.get(row.day) ?? {}
    existing[agent] = (existing[agent] ?? 0) + (isMax ? row.total_input_tokens + row.total_output_tokens : row.total_cost)
    byDay.set(row.day, existing)
  }
  const chartData = Array.from(byDay.entries())
    .map(([day, vals]) => ({ day: day.slice(5), ...vals }))
    .reverse()
    .slice(-14)
  const agents = [...new Set(dailyCost.map((d) => d.agent_type ?? "unknown"))]

  return (
    <div className="p-6 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Active Sessions" value={`${active.length}`} sub={`${sessions.length} total`} />
        <SummaryCard
          label={isMax ? "Total Tokens" : "Total Cost"}
          value={isMax ? formatTokens(totalTokensToday) : formatCost(totalCostToday)}
          sub="across all sessions"
        />
        <SummaryCard
          label="Agents"
          value={`${agentCounts.size}`}
          sub={Array.from(agentCounts.entries()).map(([a, c]) =>
            `${c} ${AGENT_LABELS[a as AgentType] ?? a}`
          ).join(", ")}
        />
        <SummaryCard
          label="Sessions Today"
          value={`${sessions.filter(s => {
            const today = new Date().toDateString()
            return new Date(s.started_at).toDateString() === today
          }).length}`}
          sub={active.length > 0 ? `${active.length} running now` : "none running"}
        />
      </div>

      {/* Daily trend */}
      {chartData.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">
            {isMax ? "Daily Token Usage" : "Daily Cost"} (Last 14 Days)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="day" stroke="#52525b" fontSize={10} tickLine={false} />
              <YAxis
                stroke="#52525b" fontSize={10} tickLine={false}
                tickFormatter={isMax ? (v: number) => formatTokens(v) : (v: number) => `$${v.toFixed(1)}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", fontSize: "12px" }}
                formatter={(value: number, name: string) => [
                  isMax ? formatTokens(value) : formatCost(value),
                  AGENT_LABELS[name as AgentType] ?? name,
                ]}
              />
              <Legend wrapperStyle={{ fontSize: "10px" }}
                formatter={(v: string) => AGENT_LABELS[v as AgentType] ?? v} />
              {agents.map((agent) => (
                <Bar key={agent} dataKey={agent} stackId="a"
                  fill={AGENT_COLORS[agent] ?? "#71717a"} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Active sessions list */}
      {active.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Active Sessions</h3>
          <div className="space-y-1">
            {active.map((s) => {
              const elapsed = Date.now() - s.started_at
              const mins = Math.floor(elapsed / 60000)
              const duration = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
              const tokens = s.total_input_tokens + s.total_output_tokens

              return (
                <button
                  key={s.id}
                  onClick={() => onSelectSession(s.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors text-left"
                >
                  <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-sm font-medium flex-1 truncate">
                    {s.project_name.split("/").pop()}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {AGENT_LABELS[s.agent_type as AgentType] ?? s.agent_type}
                  </span>
                  <span className="text-xs text-zinc-400 tabular-nums w-16 text-right">
                    {formatTokens(tokens)}
                  </span>
                  <span className="text-xs text-zinc-500 tabular-nums w-12 text-right">
                    {duration}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-zinc-600 mt-1 truncate">{sub}</div>
    </div>
  )
}
