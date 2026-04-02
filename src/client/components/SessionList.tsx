import React from "react"
import type { Session, AgentType, AppConfig } from "../lib/api"
import { AGENT_LABELS, getSessionBilling } from "../lib/api"
import { formatCost, formatTokens } from "../lib/format"

interface Props {
  sessions: Session[]
  selectedId: string | null
  onSelect: (id: string) => void
  isMax: boolean
  config?: AppConfig
}

const AGENT_BADGE_COLORS: Record<string, string> = {
  claude_code: "bg-orange-500/20 text-orange-400",
  codex_cli: "bg-emerald-500/20 text-emerald-400",
  openclaw: "bg-violet-500/20 text-violet-400",
}

const AGENT_SHORT: Record<string, string> = {
  claude_code: "CC",
  codex_cli: "CX",
  openclaw: "OC",
}

export function SessionList({ sessions, selectedId, onSelect, isMax, config }: Props) {
  const active = sessions.filter((s) => s.status === "active")
  const recent = sessions.filter(
    (s) => s.status === "idle" || s.status === "ended"
  )

  return (
    <div className="flex-1 overflow-auto">
      {active.length > 0 && (
        <SessionGroup label="Active" sessions={active} selectedId={selectedId} onSelect={onSelect} isMax={isMax} config={config} />
      )}
      {recent.length > 0 && (
        <SessionGroup label="Recent" sessions={recent} selectedId={selectedId} onSelect={onSelect} isMax={isMax} config={config} />
      )}
      {sessions.length === 0 && (
        <div className="px-4 py-8 text-center text-zinc-600 text-sm">
          No sessions found.
          <br />
          Start an AI agent to begin.
        </div>
      )}
    </div>
  )
}

function SessionGroup({
  label,
  sessions,
  selectedId,
  onSelect,
  isMax,
  config,
}: {
  label: string
  sessions: Session[]
  selectedId: string | null
  onSelect: (id: string) => void
  isMax: boolean
  config?: AppConfig
}) {
  return (
    <div>
      <div className="px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
        {label}
      </div>
      {sessions.map((s) => (
        <SessionItem
          key={s.id}
          session={s}
          selected={s.id === selectedId}
          onSelect={() => onSelect(s.id)}
          isMax={isMax}
          config={config}
        />
      ))}
    </div>
  )
}

function SessionItem({
  session,
  selected,
  onSelect,
  isMax,
  config,
}: {
  session: Session
  selected: boolean
  onSelect: () => void
  isMax: boolean
  config?: AppConfig
}) {
  const billing = getSessionBilling(session, config)
  const primaryMetric = isMax
    ? formatTokens(session.total_input_tokens + session.total_output_tokens)
    : formatCost(session.total_cost_usd)

  const health = getSessionHealth(session)
  const badgeColor = AGENT_BADGE_COLORS[session.agent_type] ?? "bg-zinc-700 text-zinc-400"
  const agentShort = AGENT_SHORT[session.agent_type] ?? "?"

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-2.5 transition-colors
        ${selected ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            session.status === "active"
              ? health === "danger" ? "bg-red-400" : health === "warning" ? "bg-yellow-400" : "bg-green-400"
              : "bg-zinc-600"
          }`}
        />
        <span className={`px-1 py-0 rounded text-[9px] font-bold leading-tight flex-shrink-0 ${badgeColor}`}
              title={AGENT_LABELS[session.agent_type as AgentType] ?? session.agent_type}>
          {agentShort}
        </span>
        <span className={`text-[8px] font-medium flex-shrink-0 ${
          billing === "subscription" ? "text-zinc-600" : "text-amber-500/50"
        }`} title={billing === "subscription" ? "Subscription (flat rate)" : "Pay-per-token API"}>
          {billing === "subscription" ? "$flat" : "$api"}
        </span>
        <span className="text-sm font-medium truncate flex-1">
          {shortProjectName(session.project_name)}
        </span>
        <span className="text-xs text-zinc-400 tabular-nums">
          {primaryMetric}
        </span>
      </div>
      <div className="mt-0.5 ml-4 text-[10px] text-zinc-600 flex gap-2">
        {session.status === "active" ? (
          <span className="text-green-500/70">{formatDuration(Date.now() - session.started_at)}</span>
        ) : (
          <span>{formatTimeAgo(session.started_at)}</span>
        )}
        {session.model && (
          <span className="text-zinc-700 truncate">{session.model}</span>
        )}
      </div>
    </button>
  )
}

function shortProjectName(name: string): string {
  const parts = name.split("/")
  return parts[parts.length - 1] || name
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

type HealthStatus = "ok" | "warning" | "danger"

function getSessionHealth(session: Session): HealthStatus {
  if (session.total_cost_usd > 20) return "danger"
  if (session.total_cost_usd > 5) return "warning"
  if (session.compaction_count > 10) return "danger"
  if (session.compaction_count > 5) return "warning"
  return "ok"
}
