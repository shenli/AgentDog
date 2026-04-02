import React, { useState, useEffect } from "react"
import type { Session, ProviderStatus, AppConfig } from "../lib/api"
import { api } from "../lib/api"
import type { Warning } from "../lib/warnings"
import { computeOverviewWarnings } from "../lib/warnings"

interface Props {
  sessions: Session[]
  config?: AppConfig
  onSelectSession?: (id: string) => void
}

const SEVERITY_STYLES = {
  critical: "bg-red-500/10 border-red-500/30 text-red-400",
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  info: "bg-blue-500/10 border-blue-500/30 text-blue-400",
}

const SEVERITY_ICON = {
  critical: "!!",
  warning: "!",
  info: "i",
}

const STATUS_DOT: Record<string, string> = {
  operational: "bg-green-400",
  degraded_performance: "bg-amber-400",
  partial_outage: "bg-amber-400",
  major_outage: "bg-red-400",
  under_maintenance: "bg-blue-400",
  unknown: "bg-zinc-500",
}

const STATUS_LABEL: Record<string, string> = {
  operational: "OK",
  degraded_performance: "Degraded",
  partial_outage: "Partial outage",
  major_outage: "Outage",
  under_maintenance: "Maintenance",
}

export function WarningsBanner({ sessions, config, onSelectSession }: Props) {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const fetch = () => api.providerStatus().then(setProviders).catch(() => {})
    fetch()
    const interval = setInterval(fetch, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const warnings = computeOverviewWarnings(sessions, config)
  const issues = providers.filter((p) => p.status !== "operational")
  const hasWarnings = warnings.length > 0

  return (
    <div className="space-y-3">
      {/* Provider status — only show details when there's an issue */}
      {providers.length > 0 && issues.length === 0 && (
        <div className="flex items-center gap-1.5 px-1 text-xs text-zinc-600">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          All systems operational
        </div>
      )}

      {/* Outage alerts for non-operational components */}
      {issues.length > 0 && (
        <div className="rounded-lg p-3 border bg-amber-500/10 border-amber-500/30">
          <div className="space-y-1">
            {issues.map((p) => {
              const severity = p.status === "major_outage" ? "critical" : "warning"
              const dot = STATUS_DOT[p.status] ?? STATUS_DOT.unknown
              return (
                <div key={`${p.provider}-${p.component}`} className="flex items-center gap-2 text-sm text-amber-400">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                  <span className="text-zinc-400">{p.provider}</span>
                  <span className="font-medium">{p.component}</span>
                  <span className="text-amber-400/70">— {STATUS_LABEL[p.status] ?? p.status}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Session warnings */}
      {hasWarnings && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-400">
              Warnings ({warnings.length})
            </h3>
            {warnings.length > 3 && (
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="text-xs text-zinc-500 hover:text-zinc-400"
              >
                {collapsed ? "Show all" : "Show less"}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(collapsed ? warnings.slice(0, 3) : warnings).map((w) => (
              <WarningRow key={w.id} warning={w} onSelect={onSelectSession} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function WarningRow({ warning, onSelect }: { warning: Warning; onSelect?: (id: string) => void }) {
  const style = SEVERITY_STYLES[warning.severity]
  const icon = SEVERITY_ICON[warning.severity]

  return (
    <div className={`rounded-md px-3 py-2 border ${style} flex items-start gap-2`}>
      <span className="font-bold text-xs mt-0.5 w-4 text-center flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{warning.title}</p>
        <p className="text-xs opacity-70 mt-0.5">{warning.detail}</p>
      </div>
      {warning.sessionId && onSelect && (
        <button
          onClick={() => onSelect(warning.sessionId!)}
          className="text-xs opacity-60 hover:opacity-100 flex-shrink-0"
        >
          View
        </button>
      )}
    </div>
  )
}

/** Compact version for session detail pages */
export function SessionWarningsList({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null

  return (
    <div className="space-y-2">
      {warnings.map((w) => {
        const style = SEVERITY_STYLES[w.severity]
        const icon = SEVERITY_ICON[w.severity]
        return (
          <div key={w.id} className={`rounded-md px-3 py-2 border ${style} flex items-start gap-2`}>
            <span className="font-bold text-xs mt-0.5 w-4 text-center flex-shrink-0">{icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{w.title}</p>
              <p className="text-xs opacity-70 mt-0.5">{w.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
