import React, { useState, useEffect } from "react"
import type { Session, TurnRow } from "../lib/api"
import { api, AGENT_LABELS, type AgentType } from "../lib/api"
import { formatCost, formatTokens, formatPercent } from "../lib/format"

interface Props {
  session: Session | null
  isMax: boolean
}

const AGENT_DOT_COLORS: Record<string, string> = {
  claude_code: "bg-orange-400",
  codex_cli: "bg-emerald-400",
  openclaw: "bg-violet-400",
}

export function TopBar({ session, isMax }: Props) {
  const [stats, setStats] = useState<TopBarStats | null>(null)

  useEffect(() => {
    if (!session) {
      setStats(null)
      return
    }

    const calc = async () => {
      try {
        const [turns, cw] = await Promise.all([
          api.turns(session.id),
          api.contextWindow(session.id),
        ])
        setStats(computeStats(session, turns, cw))
      } catch {
        setStats(null)
      }
    }

    calc()
    const interval = setInterval(calc, 15_000)
    return () => clearInterval(interval)
  }, [session?.id])

  if (!session) {
    return (
      <div className="h-12 border-b border-zinc-800 px-6 flex items-center">
        <span className="text-zinc-500 text-sm">Select a session</span>
      </div>
    )
  }

  const agentLabel = AGENT_LABELS[session.agent_type as AgentType] ?? session.agent_type
  const dotColor = AGENT_DOT_COLORS[session.agent_type] ?? "bg-zinc-400"
  const totalTokens = session.total_input_tokens + session.total_output_tokens
  const cacheTotal = session.total_input_tokens + session.total_cache_read_tokens + session.total_cache_write_tokens
  const cacheHitRate = cacheTotal > 0 ? session.total_cache_read_tokens / cacheTotal : 0

  return (
    <div className="h-12 border-b border-zinc-800 px-6 flex items-center justify-between">
      {/* Left: session identity */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-[10px] text-zinc-500 font-medium">{agentLabel}</span>
        </div>
        <span className="text-sm font-medium text-zinc-200 truncate">
          {session.project_name}
        </span>
        <span className="text-[11px] text-zinc-600 font-mono truncate">
          {session.model ?? ""}
        </span>
      </div>

      {/* Right: metrics */}
      <div className="flex items-center gap-5 flex-shrink-0">
        <Metric label="Tokens" value={formatTokens(totalTokens)} />
        <Metric
          label={isMax ? "API equiv." : "Cost"}
          value={formatCost(session.total_cost_usd)}
          dimmed={isMax}
        />
        <Metric label="Cache" value={formatPercent(cacheHitRate)} />
        {stats?.burnRate != null && stats.burnRate > 0 && (
          <Metric label="Burn" value={`${formatTokens(stats.burnRate)}/m`} />
        )}
        {stats?.contextUtil != null && stats.contextUtil > 0.7 && (
          <Metric
            label="Ctx"
            value={formatPercent(stats.contextUtil)}
            warn={stats.contextUtil > 0.85}
          />
        )}
        <StatusBadge status={session.status} />
      </div>
    </div>
  )
}

function Metric({ label, value, dimmed, warn }: {
  label: string
  value: string
  dimmed?: boolean
  warn?: boolean
}) {
  return (
    <div className={`text-xs whitespace-nowrap ${dimmed ? "opacity-40" : ""}`}>
      <span className={warn ? "text-red-400/70" : "text-zinc-500"}>{label} </span>
      <span className={`font-semibold tabular-nums ${warn ? "text-red-400" : "text-zinc-200"}`}>{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "active"
      ? "bg-green-500/15 text-green-400 ring-1 ring-green-500/20"
      : status === "idle"
        ? "bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/20"
        : "bg-zinc-800 text-zinc-500 ring-1 ring-zinc-700"
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${style}`}>
      {status}
    </span>
  )
}

interface TopBarStats {
  burnRate: number | null
  contextUtil: number | null
}

function computeStats(session: Session, turns: TurnRow[], contextWindow: number): TopBarStats {
  let burnRate: number | null = null
  let contextUtil: number | null = null

  if (turns.length >= 3) {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    const recent = turns.filter((t) => t.timestamp > fiveMinAgo)
    if (recent.length >= 2) {
      const span = recent[recent.length - 1].timestamp - recent[0].timestamp
      if (span > 0) {
        const tokens = recent.reduce((s, t) => s + t.input_tokens + t.output_tokens, 0)
        burnRate = Math.round((tokens / span) * 60_000)
      }
    }
  }

  if (turns.length > 0 && contextWindow > 0) {
    contextUtil = turns[turns.length - 1].context_tokens_used / contextWindow
  }

  return { burnRate, contextUtil }
}
