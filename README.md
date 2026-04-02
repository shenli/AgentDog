# AgentDog

Real-time monitoring dashboard for local AI agents.

AgentDog watches your Claude Code, OpenAI Codex CLI, and OpenClaw sessions as they run, giving you live visibility into token usage, costs, context window pressure, and tool call patterns — all from a single desktop app.

## Why

AI agents burn through tokens with no visibility. You don't know how much a session costs until it's over. You can't see when context is about to overflow. You don't know which tool calls are eating your budget. AgentDog fixes this by reading agent transcript files directly from disk — no API keys, no config, no agent modifications needed.

## Features

- **Multi-agent support** — Claude Code, Codex CLI, OpenClaw in one dashboard
- **Live session tracking** — 5-second polling picks up new turns as they happen
- **Token & cost monitoring** — per-turn breakdown of input, output, cache read/write
- **Context overflow prediction** — warns before compaction hits, estimates turns remaining
- **Prompt cache efficiency** — charts hit rate over time, detects invalidation events
- **Token waste identification** — shows what percentage of tokens go to tool output vs conversation
- **Cross-session cost overview** — daily spending trends across all agents
- **Anomaly detection** — flags turns that cost 3x+ the running average
- **Tool cost ranking** — which tools consume the most tokens
- **System tray** — always-on status with quick session access
- **Max plan aware** — shows token-based views for Max, cost-based for API/Pro

## Install

Requires [Rust](https://rustup.rs/) and [Node.js](https://nodejs.org/) (18+).

```bash
git clone https://github.com/shenli/AgentDog.git
cd AgentDog
npm install
npm run dev
```

This starts the Tauri dev server with hot reload for both frontend and backend.

## How it works

AgentDog reads transcript files that agents already write to disk:

| Agent | What it reads |
|-------|--------------|
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex CLI | `~/.codex/state_5.sqlite` + `~/.codex/sessions/**/*.jsonl` |
| OpenClaw | `~/.openclaw/agents/*/sessions/*.jsonl` + `sessions.json` |

No modifications to the agents. No API keys. No network calls. AgentDog is read-only — it never writes to agent directories.

Session data is stored locally in `~/.agentdog/data.sqlite`.

## Architecture

Tauri 2 desktop app: Rust backend + React/TypeScript frontend.

```
src-tauri/src/
├── agent.rs          # AgentBackend + AgentParser traits
├── agents/           # Per-agent implementations
│   ├── claude_code.rs
│   ├── codex_cli.rs
│   └── openclaw.rs
├── watcher.rs        # Session discovery polling loop
├── parser.rs         # Shared event types (ParsedTurn, ParsedToolCall, etc.)
├── db.rs             # SQLite storage
├── pricing.rs        # Token pricing (Claude + OpenAI models)
└── tray.rs           # System tray

src/client/
├── components/
│   ├── cost/         # Usage/Cost tab (charts, anomalies, tool ranking)
│   ├── context/      # Context tab (utilization, cache efficiency, compactions)
│   └── memory/       # Memory tab (file tracking, stale detection)
├── hooks/            # React hooks (sessions, websocket, config)
└── lib/              # API types, formatters
```

### Adding a new agent

1. Create `src-tauri/src/agents/your_agent.rs`
2. Implement `AgentBackend` (discovery) and `AgentParser` (JSONL parsing)
3. Register in `agents/mod.rs`
4. Add pricing to `pricing.rs` if applicable
5. Add to `AgentType` enum and frontend `AGENT_FEATURES` map

All agents produce the same `ParseEvent` types, so the UI works automatically.

## License

MIT
