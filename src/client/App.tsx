import React, { useState, useEffect } from "react"
import { SessionList } from "./components/SessionList"
import { TopBar } from "./components/TopBar"
import { CostTab } from "./components/cost/CostTab"
import { ContextTab } from "./components/context/ContextTab"
import { MemoryTab } from "./components/memory/MemoryTab"
import { useSessions } from "./hooks/use-sessions"
import { useWebSocket } from "./hooks/use-websocket"
import { useConfig } from "./hooks/use-config"

export function App() {
  const { sessions, refresh } = useSessions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"cost" | "context" | "memory">("cost")
  const ws = useWebSocket()
  const { config, setPlan, isMax } = useConfig()

  // Auto-select first active session
  useEffect(() => {
    if (!selectedId && sessions.length > 0) {
      setSelectedId(sessions[0].id)
    }
  }, [sessions, selectedId])

  // Refresh sessions on WebSocket events
  useEffect(() => {
    const unsub1 = ws.on("session_discovered", () => refresh())
    const unsub2 = ws.on("session_status_change", () => refresh())
    const unsub3 = ws.on("turn", () => refresh())
    return () => { unsub1(); unsub2(); unsub3() }
  }, [ws.on, refresh])

  const selected = sessions.find((s) => s.id === selectedId) ?? null

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <div className="w-72 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <span className="text-xl">🐕</span> AgentDog
          </h1>
          {/* Plan selector */}
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
        </div>
        <SessionList
          sessions={sessions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          isMax={isMax}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar session={selected} isMax={isMax} />

        {/* Tabs */}
        <div className="border-b border-zinc-800 px-6">
          <div className="flex gap-1">
            {(["cost", "context", "memory"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-colors
                  ${activeTab === tab
                    ? "text-zinc-100 border-b-2 border-blue-500"
                    : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {tab === "cost" ? (isMax ? "Usage" : "Cost") : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <div className="text-center">
                <p className="text-lg">No session selected</p>
                <p className="text-sm mt-1">
                  Start an AI coding agent to see data here
                </p>
              </div>
            </div>
          ) : activeTab === "cost" ? (
            <CostTab sessionId={selected.id} session={selected} ws={ws} isMax={isMax} />
          ) : activeTab === "context" ? (
            <ContextTab sessionId={selected.id} session={selected} ws={ws} />
          ) : (
            <MemoryTab sessionId={selected.id} ws={ws} />
          )}
        </div>
      </div>
    </div>
  )
}
