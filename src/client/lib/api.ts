import { invoke } from "@tauri-apps/api/core"

export type AgentType = "claude_code" | "codex_cli" | "openclaw"

export interface Session {
  id: string
  project_dir: string
  project_name: string
  transcript_path: string
  started_at: number
  ended_at: number | null
  status: string
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_write_tokens: number
  total_cost_usd: number
  compaction_count: number
  model: string | null
  agent_type: AgentType
}

export interface TurnRow {
  id: number
  session_id: string
  turn_number: number
  timestamp: number
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number
  context_tokens_used: number
  stop_reason: string | null
  is_background_process: boolean
  background_process_type: string | null
}

export interface ToolCallRow {
  id: string
  session_id: string
  turn_number: number
  tool_name: string
  input_summary: string | null
  output_size_bytes: number | null
  timestamp: number
}

export interface AnomalyRow {
  id: number
  session_id: string
  turn_number: number
  timestamp: number
  anomaly_type: string
  description: string
  actual_cost_usd: number
  expected_cost_usd: number
  multiplier: number
}

export interface ContextSnapshotRow {
  id: number
  session_id: string
  turn_number: number
  timestamp: number
  system_prompt_tokens: number | null
  config_file_tokens: number | null
  agent_memory_tokens: number | null
  memory_topic_tokens: number | null
  conversation_tokens: number | null
  tool_result_tokens: number | null
  available_tokens: number | null
}

export interface CompactionEventRow {
  id: number
  session_id: string
  timestamp: number
  messages_before: number | null
  messages_after: number | null
  tokens_before: number | null
  tokens_after: number | null
  tokens_saved: number | null
  used_session_memory: boolean | null
}

export interface MemoryEventRow {
  id: number
  session_id: string
  timestamp: number
  event_type: string
  file_path: string
  file_name: string
  source: string | null
  memory_type: string | null
  description: string | null
  size_bytes: number | null
  age_days: number | null
}

export interface AppConfig {
  plan: string // "max" | "pro" | "api"
}

export const AGENT_FEATURES: Record<AgentType, Set<string>> = {
  claude_code: new Set(["cost", "context", "compactions", "memory", "cache_tokens"]),
  codex_cli: new Set(["cost"]),
  openclaw: new Set(["cost"]),
}

export const AGENT_LABELS: Record<AgentType, string> = {
  claude_code: "Claude Code",
  codex_cli: "Codex CLI",
  openclaw: "OpenClaw",
}

export const AGENT_COLORS: Record<AgentType, string> = {
  claude_code: "bg-orange-500",
  codex_cli: "bg-emerald-500",
  openclaw: "bg-violet-500",
}

export interface DailyCostRow {
  day: string
  agent_type: string | null
  total_cost: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  session_count: number
  turn_count: number
}

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  contextWindow: (sessionId: string) => invoke<number>("get_context_window", { sessionId }),
  setPlan: (plan: string) => invoke<AppConfig>("set_plan", { plan }),
  sessions: () => invoke<Session[]>("get_sessions"),
  session: (id: string) => invoke<Session | null>("get_session", { id }),
  turns: (sessionId: string) => invoke<TurnRow[]>("get_session_turns", { sessionId }),
  tools: (sessionId: string) => invoke<ToolCallRow[]>("get_session_tools", { sessionId }),
  anomalies: (sessionId: string) => invoke<AnomalyRow[]>("get_session_anomalies", { sessionId }),
  context: (sessionId: string) => invoke<ContextSnapshotRow[]>("get_session_context", { sessionId }),
  compactions: (sessionId: string) => invoke<CompactionEventRow[]>("get_session_compactions", { sessionId }),
  memoryEvents: (sessionId: string) => invoke<MemoryEventRow[]>("get_session_memory_events", { sessionId }),
  dailyCostSummary: () => invoke<DailyCostRow[]>("get_daily_cost_summary"),
}
