import React from "react"
import type { AppConfig, AgentType, BillingMode } from "../lib/api"
import { api, AGENT_LABELS } from "../lib/api"

interface Props {
  config: AppConfig
  onConfigChange: () => void
}

const AGENTS: { type: AgentType; description: string; path: string }[] = [
  { type: "claude_code", description: "Monitors sessions from Claude Code CLI and IDE extensions", path: "~/.claude/projects/" },
  { type: "codex_cli", description: "Monitors sessions from OpenAI Codex CLI", path: "~/.codex/sessions/" },
  { type: "openclaw", description: "Monitors sessions from OpenClaw agents", path: "~/.openclaw/agents/" },
]

export function SettingsPage({ config, onConfigChange }: Props) {
  const toggleBilling = async (agentType: string) => {
    const current = config.billing?.[agentType]
    const defaultMode: BillingMode = agentType === "claude_code" ? "subscription" : "api"
    const currentMode = current ?? defaultMode
    const next: BillingMode = currentMode === "subscription" ? "api" : "subscription"
    await api.setBillingMode(agentType, next)
    onConfigChange()
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold mb-6">Settings</h2>

      {/* Agent configuration */}
      <section className="mb-8">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Agent Configuration</h3>
        <div className="space-y-3">
          {AGENTS.map((agent) => {
            const defaultMode: BillingMode = agent.type === "claude_code" ? "subscription" : "api"
            const billing = config.billing?.[agent.type] ?? defaultMode
            const isSubscription = billing === "subscription"

            return (
              <div key={agent.type} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      agent.type === "claude_code" ? "bg-orange-400" :
                      agent.type === "codex_cli" ? "bg-emerald-400" : "bg-violet-400"
                    }`} />
                    <span className="font-medium">{AGENT_LABELS[agent.type]}</span>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mb-3">{agent.description}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Billing mode</div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => !isSubscription && toggleBilling(agent.type)}
                        className={`px-3 py-1 text-xs font-medium rounded-l-md transition-colors
                          ${isSubscription
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-zinc-800 text-zinc-500 hover:text-zinc-400"
                          }`}
                      >
                        Subscription
                      </button>
                      <button
                        onClick={() => isSubscription && toggleBilling(agent.type)}
                        className={`px-3 py-1 text-xs font-medium rounded-r-md transition-colors
                          ${!isSubscription
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-zinc-800 text-zinc-500 hover:text-zinc-400"
                          }`}
                      >
                        Pay-per-token
                      </button>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-zinc-600">Data path</div>
                    <div className="text-xs text-zinc-500 font-mono">{agent.path}</div>
                  </div>
                </div>
                {isSubscription && (
                  <p className="text-[10px] text-zinc-600 mt-2">
                    Cost shown as "API equivalent" for reference. No cost warnings.
                  </p>
                )}
                {!isSubscription && (
                  <p className="text-[10px] text-zinc-600 mt-2">
                    Cost tracked as real spend. Warnings enabled for high cost and spikes.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* About */}
      <section>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">About</h3>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-500">
          <p>AgentDog v0.1.0</p>
          <p className="mt-1 text-xs text-zinc-600">
            Config: ~/.agentdog/config.json &middot; Data: ~/.agentdog/data.sqlite
          </p>
        </div>
      </section>
    </div>
  )
}
