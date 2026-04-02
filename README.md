# AgentDog

Real-time monitoring dashboard for local AI agents. macOS only.

AgentDog is a lightweight desktop app that sits in your menu bar and watches your AI agent sessions as they run — Claude Code, OpenAI Codex CLI, and OpenClaw. It gives you live visibility into token usage, costs, context window health, and tool call patterns by reading transcript files directly from disk. No API keys needed. No agent modifications. Just install and it starts tracking.

## About

AgentDog was built out of frustration with flying blind while running AI agents. There's no easy way to know how much a session is costing, when context is about to overflow, or which tool calls are wasting tokens. Existing solutions require instrumenting your agent, setting up tracing infrastructure, or waiting for features that never ship (looking at you, OpenClaw OTEL PR #21290).

AgentDog takes a different approach: it reads the transcript files that agents already write to disk, parses them in real-time, and surfaces the insights in a clean dashboard. It's read-only, runs locally, and works with multiple agents simultaneously.

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
- **Provider status** — monitors Anthropic and OpenAI status pages for agent-related outages
- **Warnings** — proactive alerts for context pressure, cache instability, cost spikes, session stalls
- **System tray** — always-on menu bar icon with quick session access and settings
- **Plan-aware** — auto-detects subscription vs API billing per agent, configurable in settings
- **Custom pricing** — define your own per-token rates for third-party LLM providers

## Requirements

- **macOS** (Windows and Linux are not supported yet)
- [Rust](https://rustup.rs/) (for building the backend)
- [Node.js](https://nodejs.org/) 18+

## Install

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

No modifications to the agents. No API keys. No network calls (except optional status page checks). AgentDog is read-only — it never writes to agent directories.

Session data is stored locally in `~/.agentdog/data.sqlite`. Configuration in `~/.agentdog/config.json`.

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
└── lib/              # API types, formatters, warnings
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
