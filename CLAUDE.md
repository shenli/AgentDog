# AgentDog

Cost and context monitoring tool for local AI agents.

## Architecture

- **Desktop app**: Tauri 2 (Rust backend + React/TypeScript frontend)
- **Backend**: `src-tauri/src/` — session discovery, JSONL parsing, SQLite storage, system tray
- **Frontend**: `src/client/` — React with Recharts, Tailwind CSS, Lucide icons

## Multi-Agent Support

AgentDog monitors three agent types via a pluggable backend system:

| Agent | Discovery Source | Transcript Format |
|-------|-----------------|-------------------|
| **Claude Code** | `~/.claude/projects/{project}/sessions/*.jsonl` | JSONL with `type`, `message.usage`, content blocks |
| **Codex CLI** | `~/.codex/state_5.sqlite` + `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL with `event_msg.token_count`, `response_item.function_call` |
| **OpenClaw** | `~/.openclaw/agents/{agentId}/sessions/*.jsonl` + `sessions.json` | JSONL with `message.usage.{input,output,cacheRead,cost}` |

### Agent Backend Pattern

Each agent implements `AgentBackend` + `AgentParser` traits in `src-tauri/src/agents/`:
- `discover_sessions()` — finds active sessions on disk
- `create_parser()` — returns a stateful JSONL parser
- All parsers emit the same `ParseEvent` types (Turn, ToolCall, Anomaly, etc.)

## Key Files

- `src-tauri/src/agent.rs` — Trait definitions (`AgentBackend`, `AgentParser`, `AgentType`)
- `src-tauri/src/agents/` — Per-agent implementations (claude_code, codex_cli, openclaw)
- `src-tauri/src/watcher.rs` — 5-second polling loop, discovers sessions from all backends
- `src-tauri/src/parser.rs` — Shared event types (`ParseEvent`, `ParsedTurn`, etc.)
- `src-tauri/src/db.rs` — SQLite schema + queries (sessions, turns, tool_calls, anomalies, etc.)
- `src-tauri/src/pricing.rs` — Per-model token pricing (Claude + OpenAI models)
- `src/client/App.tsx` — Main UI with tab system (Usage/Context/Memory)
- `src/client/lib/api.ts` — TypeScript types + Tauri IPC bindings

## Development

```bash
npm run dev          # Start Tauri dev (frontend + backend hot reload)
cargo build          # Build Rust backend only
npx tsc --noEmit     # TypeScript type check
npx vite build       # Frontend production build
```

## Conventions

- Rust: standard formatting, `log::info!` for logging
- Frontend: functional React components, no class components
- DB: SQLite with WAL mode, migrations in `db.rs::run_migrations()`
- All string truncation must use `truncate_str()` from `parser.rs` (UTF-8 safe)
- Agent-specific UI features use `AGENT_FEATURES` map in `api.ts` for feature gating
- Max plan shows token-based views; API/Pro plan shows cost-based views
