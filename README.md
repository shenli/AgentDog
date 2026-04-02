# 🐕 AgentDog

**Real-time monitoring dashboard for local AI agents.**

Currently supports macOS. Built with [Tauri](https://tauri.app/).

AgentDog is a lightweight menu bar app that watches your [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenAI Codex](https://openai.com/index/codex/), and [OpenClaw](https://github.com/openclaw/openclaw) sessions as they run. It gives you live visibility into token usage, costs, context window health, and tool call patterns — by reading transcript files directly from disk. No API keys. No agent modifications. Just install and go.

## Screenshots

**Overview dashboard** — aggregate stats, agent breakdown, daily trends, provider status

![Overview dashboard](docs/screenshots/overview.png)

**Session detail** — per-turn token usage, warnings, cache efficiency, cost breakdown

![Session detail](docs/screenshots/session-detail.png)

## Why AgentDog

If you run AI agents regularly, you've hit these problems:

- **Cost blindness.** A Claude Code session burns through tokens for hours and you only find out you've hit 94% of your quota when the agent starts throttling. Codex runs a review and you have no idea what it consumed. OpenClaw routes to different providers and you can't tell which one is expensive.

- **Silent context overflow.** Your agent stops working mid-task because the context window filled up. No warning, no graceful degradation — it just breaks. You don't know compaction happened, or that it failed.

- **Invisible cache invalidation.** A config change or a tool output in the wrong position breaks prompt caching, and your costs spike 5x. You don't notice until it's too late.

- **Token waste from tool calls.** A single `git log --stat` eats 30% of your context. Workspace files get injected on every turn. Nobody tells you.

- **No unified view across agents.** You're running Claude Code, Codex, and OpenClaw across different projects. Each has its own (or no) monitoring. You can't see total spend, compare efficiency, or spot patterns.

AgentDog fixes this. It reads the transcript files that agents already write to disk, parses them in real-time, and surfaces everything in one dashboard. Read-only. Runs locally. Works across agents.

## Features

- **Multi-agent support** — Claude Code, OpenAI Codex, OpenClaw in one dashboard
- **Live session tracking** — 5-second polling, picks up new turns as they happen
- **Token and cost monitoring** — per-turn breakdown of input, output, cache read/write
- **Context overflow prediction** — warns before compaction, estimates turns remaining
- **Prompt cache efficiency** — charts hit rate over time, detects invalidation events
- **Token waste identification** — shows tool output vs. conversation token share
- **Cross-session cost overview** — daily spending trends across all agents
- **Anomaly detection** — flags turns that cost 3x+ the running average
- **Tool cost ranking** — identifies which tools consume the most tokens
- **Provider status** — monitors Anthropic and OpenAI status pages for outages
- **Warnings** — proactive alerts for context pressure, cache drops, cost spikes, stalled sessions
- **Menu bar app** — always-on system tray icon with quick session access
- **Plan-aware billing** — auto-detects subscription vs. pay-per-token per agent
- **Custom pricing** — bring your own per-token rates for third-party LLM providers

## Requirements

- **macOS** (Windows and Linux not yet supported)
- [Rust](https://rustup.rs/)
- [Node.js](https://nodejs.org/) 18+

## Getting Started

```bash
git clone https://github.com/shenli/AgentDog.git
cd AgentDog
npm install
npm run dev
```

This starts the Tauri dev server with hot reload for both the Rust backend and the React frontend.

## How It Works

AgentDog reads transcript files that agents already write to disk:

| Agent | Data source |
|-------|------------|
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| OpenAI Codex | `~/.codex/state_5.sqlite` + `~/.codex/sessions/**/*.jsonl` |
| OpenClaw | `~/.openclaw/agents/*/sessions/*.jsonl` + `sessions.json` |

No modifications to the agents. No API keys required. AgentDog is read-only — it never writes to agent directories.

All session data is stored locally in `~/.agentdog/data.sqlite`. Configuration lives in `~/.agentdog/config.json`.

## Architecture

Tauri 2 desktop app with a Rust backend and React/TypeScript frontend.

```
src-tauri/src/
├── agent.rs          # AgentBackend + AgentParser traits
├── agents/           # Per-agent implementations
│   ├── claude_code.rs
│   ├── codex_cli.rs
│   └── openclaw.rs
├── watcher.rs        # Session discovery polling loop
├── parser.rs         # Shared event types (ParsedTurn, ParsedToolCall, etc.)
├── db.rs             # SQLite storage and queries
├── pricing.rs        # Token pricing (Claude + OpenAI models)
└── tray.rs           # System tray

src/client/
├── components/
│   ├── cost/         # Usage/Cost tab (charts, anomalies, tool ranking)
│   ├── context/      # Context tab (utilization, cache efficiency, compactions)
│   └── memory/       # Memory tab (file tracking, stale detection)
├── hooks/            # React hooks (sessions, events, config)
└── lib/              # Types, formatters, warning logic
```

### Adding a New Agent

1. Create `src-tauri/src/agents/your_agent.rs`
2. Implement `AgentBackend` (discovery) and `AgentParser` (transcript parsing)
3. Register in `agents/mod.rs`
4. Add model pricing to `pricing.rs` if applicable
5. Add to `AgentType` enum and frontend `AGENT_FEATURES` map

All agents produce the same `ParseEvent` types, so the dashboard works automatically.

## Contributing

Contributions are welcome. Please [open an issue](https://github.com/shenli/AgentDog/issues) before submitting large changes so we can discuss the approach.

## License

[Apache 2.0](LICENSE)
