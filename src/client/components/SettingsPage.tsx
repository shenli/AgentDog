import React from "react"
import type { AppConfig, AgentType, BillingMode } from "../lib/api"
import { api, AGENT_LABELS } from "../lib/api"

interface Props {
  config: AppConfig
  onConfigChange: () => void
}

const AGENTS: { type: AgentType; description: string; path: string; costSource: string }[] = [
  { type: "claude_code", description: "Monitors sessions from Claude Code CLI and IDE extensions. Supports Anthropic and third-party API providers.", path: "~/.claude/projects/", costSource: "Estimated from model pricing table. May not match third-party provider rates." },
  { type: "codex_cli", description: "Monitors sessions from OpenAI Codex CLI.", path: "~/.codex/sessions/", costSource: "Estimated from OpenAI pricing table." },
  { type: "openclaw", description: "Monitors sessions from OpenClaw agents. Supports any LLM provider configured in OpenClaw.", path: "~/.openclaw/agents/", costSource: "Reported by OpenClaw per message — accurate for any provider." },
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
                  <div className="text-right text-xs">
                    <div className="text-zinc-500 font-mono">{agent.path}</div>
                  </div>
                </div>
                <div className="mt-2 space-y-0.5">
                  <p className="text-[10px] text-zinc-600">
                    {isSubscription
                      ? "Cost shown as estimate for reference. No cost warnings."
                      : "Cost tracked as real spend. Warnings enabled for high cost and spikes."}
                  </p>
                  <p className="text-[10px] text-zinc-700">
                    Pricing: {agent.costSource}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Custom pricing */}
      <section className="mb-8">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">Custom Model Pricing</h3>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-xs text-zinc-500 mb-3">
            Using a third-party API (AWS Bedrock, Azure, custom proxy) with different rates?
            Add custom pricing to <span className="font-mono text-zinc-400">~/.agentdog/config.json</span>.
            Pricing is matched by <strong>model name</strong> from the session transcript — no per-agent config needed.
          </p>
          <pre className="text-[11px] text-zinc-400 bg-zinc-950 rounded p-3 overflow-x-auto">{`{
  "custom_pricing": {
    "anthropic.claude-3-sonnet": {
      "input_per_million": 3.0,
      "output_per_million": 15.0,
      "cache_read_per_million": 0.3,
      "context_window": 200000
    }
  }
}`}</pre>
          <p className="text-[10px] text-zinc-600 mt-2">
            Keys match by model name prefix from the transcript.
            For example, if a session uses <span className="font-mono">"anthropic.claude-3-sonnet-20240229"</span>,
            the key <span className="font-mono">"anthropic.claude-3-sonnet"</span> will match.
            Custom pricing takes priority over built-in prices.
          </p>
          {Object.keys(config.custom_pricing ?? {}).length > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <div className="text-xs text-zinc-500 mb-2">Active custom pricing:</div>
              {Object.entries(config.custom_pricing ?? {}).map(([prefix, p]) => (
                <div key={prefix} className="flex items-center gap-3 text-xs py-1">
                  <span className="font-mono text-zinc-300">{prefix}</span>
                  <span className="text-zinc-500">
                    ${(p as any).input_per_million}/M in, ${(p as any).output_per_million}/M out
                  </span>
                </div>
              ))}
            </div>
          )}
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
