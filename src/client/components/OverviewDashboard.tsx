import React, { useState, useEffect, useMemo } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts"
import type { Session, DailyCostRow, AgentType } from "../lib/api"
import { api, AGENT_LABELS } from "../lib/api"
import { formatCost, formatTokens, formatPercent } from "../lib/format"

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

interface AgentBreakdown {
  agent: string
  label: string
  color: string
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  totalCost: number
}

export function OverviewDashboard({ sessions, onSelectSession, isMax }: Props) {
  const [dailyCost, setDailyCost] = useState<DailyCostRow[]>([])

  useEffect(() => {
    api.dailyCostSummary().then(setDailyCost).catch(() => {})
  }, [])

  const active = sessions.filter((s) => s.status === "active")
  const totalTokens = sessions.reduce((s, sess) => s + sess.total_input_tokens + sess.total_output_tokens, 0)
  const totalCost = sessions.reduce((s, sess) => s + sess.total_cost_usd, 0)

  // Agent breakdown
  const agentBreakdown = useMemo(() => {
    const map = new Map<string, AgentBreakdown>()
    for (const s of sessions) {
      const existing = map.get(s.agent_type) ?? {
        agent: s.agent_type,
        label: AGENT_LABELS[s.agent_type as AgentType] ?? s.agent_type,
        color: AGENT_COLORS[s.agent_type] ?? "#71717a",
        sessions: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        totalCost: 0,
      }
      existing.sessions++
      existing.inputTokens += s.total_input_tokens
      existing.outputTokens += s.total_output_tokens
      existing.cacheReadTokens += s.total_cache_read_tokens
      existing.totalTokens += s.total_input_tokens + s.total_output_tokens
      existing.totalCost += s.total_cost_usd
      map.set(s.agent_type, existing)
    }
    return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens)
  }, [sessions])

  // Daily chart data
  const { chartData, chartAgents } = useMemo(() => {
    const byDay = new Map<string, Record<string, number>>()
    for (const row of dailyCost) {
      const agent = row.agent_type ?? "unknown"
      const existing = byDay.get(row.day) ?? {}
      existing[agent] = (existing[agent] ?? 0) + (isMax ? row.total_input_tokens + row.total_output_tokens : row.total_cost)
      byDay.set(row.day, existing)
    }
    return {
      chartData: Array.from(byDay.entries())
        .map(([day, vals]) => ({ day: day.slice(5), ...vals }))
        .reverse()
        .slice(-14),
      chartAgents: [...new Set(dailyCost.map((d) => d.agent_type ?? "unknown"))],
    }
  }, [dailyCost, isMax])

  // Pie chart data
  const pieData = agentBreakdown.map((a) => ({
    name: a.label,
    value: isMax ? a.totalTokens : a.totalCost,
    color: a.color,
  }))

  return (
    <div className="p-6 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Active Sessions" value={`${active.length}`} sub={`${sessions.length} total`} />
        <SummaryCard
          label={isMax ? "Total Tokens" : "Total Cost"}
          value={isMax ? formatTokens(totalTokens) : formatCost(totalCost)}
          sub="across all sessions"
        />
        <SummaryCard
          label="Agents"
          value={`${agentBreakdown.length}`}
          sub={agentBreakdown.map((a) => `${a.sessions} ${a.label}`).join(", ")}
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

      {/* Agent breakdown */}
      {agentBreakdown.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">
            {isMax ? "Token" : "Cost"} Breakdown by Agent
          </h3>
          <div className="flex gap-6">
            {/* Pie chart */}
            {agentBreakdown.length > 1 && (
              <div className="flex-shrink-0">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px", fontSize: "12px" }}
                      formatter={(value: number, name: string) => [
                        isMax ? formatTokens(value) : formatCost(value), name
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Agent stats table */}
            <div className="flex-1 min-w-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                    <th className="text-left pb-2 pr-4">Agent</th>
                    <th className="text-right pb-2 pr-4">Sessions</th>
                    <th className="text-right pb-2 pr-4">Input</th>
                    <th className="text-right pb-2 pr-4">Output</th>
                    <th className="text-right pb-2 pr-4">Cache Read</th>
                    <th className="text-right pb-2 pr-4">{isMax ? "Total Tokens" : "Cost"}</th>
                    <th className="text-right pb-2">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {agentBreakdown.map((a) => {
                    const share = isMax
                      ? (totalTokens > 0 ? a.totalTokens / totalTokens : 0)
                      : (totalCost > 0 ? a.totalCost / totalCost : 0)

                    return (
                      <tr key={a.agent} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                            <span className="font-medium">{a.label}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">{a.sessions}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">{formatTokens(a.inputTokens)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">{formatTokens(a.outputTokens)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">{formatTokens(a.cacheReadTokens)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums font-medium">
                          {isMax ? formatTokens(a.totalTokens) : formatCost(a.totalCost)}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${share * 100}%`, backgroundColor: a.color }}
                              />
                            </div>
                            <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">
                              {formatPercent(share)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
              {chartAgents.map((agent) => (
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
