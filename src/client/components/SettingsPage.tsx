import React from "react"
import type { AppConfig, AgentType, BillingMode } from "../lib/api"
import { api, AGENT_LABELS } from "../lib/api"

interface Props {
  config: AppConfig
  onConfigChange: () => void
}

const AGENTS: { type: AgentType; description: string; path: string }[] = [
  { type: "claude_code", description: "Monitors sessions from Claude Code CLI and IDE extensions. Supports Anthropic and third-party API providers.", path: "~/.claude/projects/" },
  { type: "codex_cli", description: "Monitors sessions from OpenAI Codex CLI.", path: "~/.codex/sessions/" },
  { type: "openclaw", description: "Monitors sessions from OpenClaw agents. Supports any LLM provider — cost reported per message.", path: "~/.openclaw/agents/" },
]

const BUILTIN_PRICING: { key: string; label: string; detail: string }[] = [
  { key: "claude-opus-4", label: "Claude Opus 4", detail: "$15 / $75 per M tokens" },
  { key: "claude-sonnet-4", label: "Claude Sonnet 4", detail: "$3 / $15 per M tokens" },
  { key: "claude-haiku-4", label: "Claude Haiku 4", detail: "$0.80 / $4 per M tokens" },
  { key: "gpt-5", label: "GPT-5", detail: "$2 / $8 per M tokens" },
  { key: "o3", label: "o3", detail: "$2 / $8 per M tokens" },
  { key: "gpt-4o", label: "GPT-4o", detail: "$2.50 / $10 per M tokens" },
  { key: "o4-mini", label: "o4-mini", detail: "$1.10 / $4.40 per M tokens" },
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

  const setPricingProfile = async (agentType: string, profile: string) => {
    await api.setPricingProfile(agentType, profile)
    onConfigChange()
  }

  // Build pricing options: auto + built-in + custom
  const customKeys = Object.keys(config.custom_pricing ?? {})
  const pricingOptions = [
    { key: "auto", label: "Auto-detect from model name", detail: "" },
    ...BUILTIN_PRICING,
    ...customKeys.map((k) => {
      const p = config.custom_pricing![k]
      return { key: k, label: k, detail: `$${p.input_per_million} / $${p.output_per_million} per M tokens (custom)` }
    }),
  ]

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
            const currentProfile = config.pricing_profile?.[agent.type] ?? "auto"

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
                  <span className="text-xs text-zinc-600 font-mono">{agent.path}</span>
                </div>
                <p className="text-xs text-zinc-500 mb-3">{agent.description}</p>

                {/* Billing mode */}
                <div className="mb-3">
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

                {/* Pricing profile dropdown — shown when Pay-per-token */}
                {!isSubscription && (
                  <div>
                    <div className="text-xs text-zinc-500 mb-1">Pricing</div>
                    <select
                      value={currentProfile}
                      onChange={(e) => setPricingProfile(agent.type, e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-600"
                    >
                      {pricingOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}{opt.detail ? ` — ${opt.detail}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <p className="text-[10px] text-zinc-600 mt-2">
                  {isSubscription
                    ? "Cost shown as estimate for reference. No cost warnings."
                    : currentProfile === "auto"
                      ? "Pricing auto-detected from model name in session transcript."
                      : `Using fixed pricing: ${currentProfile}`}
                </p>
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
            Add custom pricing for third-party providers
            in <span className="font-mono text-zinc-400">~/.agentdog/config.json</span>.
            Custom entries appear in the pricing dropdown above.
          </p>
          <pre className="text-[11px] text-zinc-400 bg-zinc-950 rounded p-3 overflow-x-auto">{`{
  "custom_pricing": {
    "bedrock-claude-sonnet": {
      "input_per_million": 3.0,
      "output_per_million": 15.0,
      "cache_read_per_million": 0.3,
      "context_window": 200000
    }
  }
}`}</pre>
          <p className="text-[10px] text-zinc-600 mt-2">
            When pricing is set to "Auto-detect", keys match by model name prefix from the transcript.
            When a specific pricing profile is selected, that rate is used for all sessions of that agent.
          </p>
          {customKeys.length > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <div className="text-xs text-zinc-500 mb-2">Active custom pricing:</div>
              {Object.entries(config.custom_pricing ?? {}).map(([prefix, p]) => (
                <div key={prefix} className="flex items-center gap-3 text-xs py-1">
                  <span className="font-mono text-zinc-300">{prefix}</span>
                  <span className="text-zinc-500">
                    ${p.input_per_million}/M in, ${p.output_per_million}/M out
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
