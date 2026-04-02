import React, { useState, useEffect } from "react"
import { SessionList } from "./components/SessionList"
import { TopBar } from "./components/TopBar"
import { OverviewDashboard } from "./components/OverviewDashboard"
import { CostTab } from "./components/cost/CostTab"
import { ContextTab } from "./components/context/ContextTab"
import { MemoryTab } from "./components/memory/MemoryTab"
import { useSessions } from "./hooks/use-sessions"
import { useWebSocket } from "./hooks/use-websocket"
import { useConfig } from "./hooks/use-config"
import { AGENT_FEATURES, type AgentType } from "./lib/api"

type TabId = "cost" | "context" | "memory"

export function App() {
  const { sessions, refresh } = useSessions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("cost")
  const [showSettings, setShowSettings] = useState(false)
  const ws = useWebSocket()
  const { config, setPlan, isMax } = useConfig()

  // Refresh sessions on WebSocket events
  useEffect(() => {
    const unsub1 = ws.on("session_discovered", () => refresh())
    const unsub2 = ws.on("session_status_change", () => refresh())
    const unsub3 = ws.on("turn", () => refresh())
    return () => { unsub1(); unsub2(); unsub3() }
  }, [ws.on, refresh])

  const selected = sessions.find((s) => s.id === selectedId) ?? null

  // Determine which tabs are available for the selected agent
  const agentFeatures = selected
    ? AGENT_FEATURES[selected.agent_type as AgentType] ?? new Set()
    : new Set()

  const tabs: { id: TabId; label: string; available: boolean }[] = [
    { id: "cost", label: isMax ? "Usage" : "Cost", available: true },
    { id: "context", label: "Context", available: true }, // always show, but content adapts
    { id: "memory", label: "Memory", available: agentFeatures.has("memory") },
  ]

  // If current tab isn't available for this agent, switch to cost
  useEffect(() => {
    if (selected) {
      const currentAvailable = tabs.find((t) => t.id === activeTab)?.available
      if (!currentAvailable) {
        setActiveTab("cost")
      }
    }
  }, [selected?.agent_type])

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <div className="w-64 border-r border-zinc-800 flex flex-col">
        <div className="p-3 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold tracking-tight flex items-center gap-1.5">
              <span className="text-lg">🐕</span> AgentDog
            </h1>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors p-1 rounded"
              title="Settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </button>
          </div>

          {/* Plan selector — collapsed by default */}
          {showSettings && (
            <div className="mt-2 flex gap-1">
              {(["max", "pro", "api"] as const).map((plan) => (
                <button
                  key={plan}
                  onClick={() => setPlan(plan)}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors uppercase
                    ${config.plan === plan
                      ? "bg-blue-500/20 text-blue-400"
                      : "text-zinc-600 hover:text-zinc-400"}`}
                >
                  {plan}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Overview button */}
        <button
          onClick={() => setSelectedId(null)}
          className={`px-4 py-2 text-left text-sm font-medium transition-colors border-b border-zinc-800
            ${selectedId === null
              ? "text-zinc-100 bg-zinc-800/50"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"}`}
        >
          Overview
        </button>

        <SessionList
          sessions={sessions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          isMax={isMax}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <TopBar session={selected} isMax={isMax} />

            {/* Tabs */}
            <div className="border-b border-zinc-800 px-6">
              <div className="flex gap-1">
                {tabs.filter((t) => t.available).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-sm font-medium transition-colors
                      ${activeTab === tab.id
                        ? "text-zinc-100 border-b-2 border-blue-500"
                        : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto">
              {activeTab === "cost" ? (
                <CostTab sessionId={selected.id} session={selected} ws={ws} isMax={isMax} />
              ) : activeTab === "context" ? (
                <ContextTab sessionId={selected.id} session={selected} ws={ws} />
              ) : activeTab === "memory" ? (
                <MemoryTab sessionId={selected.id} ws={ws} />
              ) : null}
            </div>
          </>
        ) : (
          /* Overview dashboard — shown when no session is selected */
          sessions.length > 0 ? (
            <div className="flex-1 overflow-auto">
              <OverviewDashboard
                sessions={sessions}
                onSelectSession={setSelectedId}
                isMax={isMax}
              />
            </div>
          ) : (
            <EmptyState />
          )
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  const agents = [
    { name: "Claude Code", path: "~/.claude/projects/", color: "text-orange-400" },
    { name: "Codex CLI", path: "~/.codex/sessions/", color: "text-emerald-400" },
    { name: "OpenClaw", path: "~/.openclaw/agents/", color: "text-violet-400" },
  ]

  return (
    <div className="flex items-center justify-center h-full text-zinc-500">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4">🐕</div>
        <p className="text-lg text-zinc-300 font-medium">No sessions detected</p>
        <p className="text-sm mt-2 text-zinc-500">
          AgentDog automatically monitors AI agent sessions running on this machine.
        </p>
        <div className="mt-6 text-left space-y-2">
          {agents.map((a) => (
            <div key={a.name} className="flex items-center gap-3 px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
              <span className={`text-sm font-medium ${a.color}`}>{a.name}</span>
              <span className="text-xs text-zinc-600 font-mono truncate">{a.path}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-4">
          Start any of these agents and AgentDog will pick up the session within seconds.
        </p>
      </div>
    </div>
  )
}
