# OpenClaw Monitoring Improvements Plan

## Background

Research into OpenClaw GitHub issues reveals severe monitoring gaps that AgentDog is positioned to fill. The OpenClaw community has been requesting observability for months — an OpenTelemetry PR (#21290, 19 reactions) has been stuck in review since Feb 2026, with users running custom builds just to get tracing.

The key insight: **OpenClaw transcripts already contain all the data we need** (`usage.input`, `usage.output`, `usage.cacheRead`, `usage.cost.total` per assistant message), plus `sessions.json` has aggregated metadata. The problem isn't missing data — it's that no tool surfaces it.

## Pain Points → Features

### P0: Context Window Utilization (Critical)

**Problem:** `openclaw status` shows `Context: 0/1.0m (0%)` always (Issue #44184). Users have zero visibility into how close they are to overflow. Sessions silently die when context fills up (Issue #2254, 20 reactions).

**What we have now:** The OpenClaw parser extracts `input_tokens` per turn and computes `context_tokens_estimate`. The Context tab shows a utilization chart.

**What's missing:**
1. OpenClaw's `sessions.json` has `contextTokens` (total context snapshot) and `model` — we should read these during discovery for an accurate initial context size.
2. The context window size needs to be model-aware for OpenAI models (GPT-5.4 = 258K, o3 = 200K) and Anthropic models that OpenClaw routes to.
3. Need an **overflow prediction** — extrapolate from burn rate to estimate when context will fill.
4. Need a **context danger alert** — banner when >80% full, urgent at >90%.

**Implementation:**
- **Backend:** In `OpenClawBackend::discover_sessions()`, read `contextTokens` from `sessions.json` and pass to the parser as initial context state. Extend `DiscoveredSession` or the parser init with context metadata.
- **Backend:** Add `model_context_window` extraction from the `turn_context`/`event_msg` events (Codex has this; OpenClaw stores it in `sessions.json` metadata).
- **Frontend:** The `ContextWarning` component already exists. Wire it to show for OpenClaw sessions using `context_tokens_used` from turns.
- **Frontend:** Add overflow time prediction to TopBar (similar to existing burn rate, but for context).

### P1: Per-Session Cost Tracking (High)

**Problem:** OpenClaw has zero cost display (Issue #9244). Users independently estimated $100+/month. One built their own gateway out of frustration.

**What we have now:** The parser extracts `usage.cost.total` directly from each assistant message. Turns are stored with `cost_usd`. The Cost tab shows charts, summaries, anomaly detection.

**What's missing:**
1. OpenClaw provides cost per-message directly — we should trust this over our pricing table calculations since OpenClaw sessions can use any provider/model.
2. Need **cross-session cost aggregation** — daily/weekly/monthly totals across all OpenClaw sessions.
3. Need **cost-by-model breakdown** — OpenClaw users switch models mid-session (fallback routing).

**Implementation:**
- **Backend:** The parser already reads `usage.cost.total` — use it as `cost_usd` (already done).
- **Backend:** New DB query `get_daily_cost_summary(agent_type)` — aggregate cost by day across sessions.
- **Frontend:** Add a "Cost Overview" view or section showing cross-session spending trends.
- **Frontend:** In CostSummaryCards, show model breakdown when session uses multiple models.

### P2: Token Waste Identification (High)

**Problem:** Workspace files injected every turn (~35K tokens, ~$1.51/100 messages). Tool outputs consume 30-40% of context. Users had to manually measure this waste (Issues #9157, #37057).

**What we have now:** We track tool calls with `input_summary` and `output_size_bytes`. We have context snapshot breakdown (system_prompt_tokens, config_file_tokens, etc.).

**What's missing:**
1. **Token composition pie chart** — break each turn into: system prompt, conversation history, tool inputs, tool outputs, cache overhead.
2. **Waste detection heuristic** — flag when system prompt tokens are abnormally high or when a single tool output exceeds a threshold (e.g., >10K tokens).
3. **Tool output size ranking** — which tools are the biggest token consumers?

**Implementation:**
- **Backend:** For OpenClaw, estimate token composition from content sizes. The `input_tokens` field includes everything; approximate breakdown from tool output sizes already tracked.
- **Frontend:** New `TokenComposition` component — stacked bar or pie chart per turn showing token sources. Add to ContextTab.
- **Frontend:** Extend `ToolCostRanking` to also show token consumption per tool, not just cost.
- **Frontend:** Add a "Waste Alerts" section flagging turns where tool output tokens > 50% of total input.

### P3: Prompt Cache Efficiency (High)

**Problem:** Context engine bugs break prompt caching, causing cost spikes (PRs #59058, #20597). Users have no way to monitor cache health.

**What we have now:** We track `cache_read_tokens` and `cache_write_tokens` per turn. CostSummaryCards shows a cache hit rate.

**What's missing:**
1. **Cache efficiency over time** — line chart of cache hit rate per turn, so users can spot when caching breaks.
2. **Cache invalidation alerts** — detect when cache hit rate drops sharply (e.g., from 80% to 10%) and flag it.
3. **Cache savings calculation** — show how much money was saved by caching vs. what it would have cost without.

**Implementation:**
- **Frontend:** New `CacheEfficiencyChart` component — line chart of `cache_read / (input + cache_read + cache_write)` per turn.
- **Frontend:** Anomaly detection on cache rate: if rate drops >50 percentage points between consecutive turns, emit an alert (reuse anomaly system).
- **Frontend:** In CostSummaryCards, add "Cache Savings" card: `(cache_read_tokens * input_price - cache_read_tokens * cache_read_price)`.

### P4: Compaction Monitoring (Medium-High)

**Problem:** Auto-compaction fails silently, producing "Summary unavailable" fallback text. Agent loses all memory (Issue #3479, 9 reactions). Sessions become unresponsive after failed compaction (Issue #2254).

**What we have now:** We track compaction events with `tokens_before`, `tokens_after`, `tokens_saved`. CompactionLog component exists.

**What's missing:**
1. OpenClaw parser doesn't emit compaction events yet — need to detect them from transcript markers.
2. **Compaction success/failure indicator** — did the compaction actually reduce context, or did it fail?
3. **Pre-compaction warning** — alert when context is approaching the threshold that triggers compaction.

**Implementation:**
- **Backend:** In `OpenClawParser`, detect compaction markers in transcripts (lines with `"type": "compaction"` or system messages about compaction). Emit `ParseEvent::Compaction`.
- **Frontend:** Enhance CompactionLog to show success/failure status. Red for `tokens_saved <= 0`, green for successful compactions.
- **Frontend:** Add compaction prediction: "Compaction likely in ~N turns" based on context growth rate.

### P5: Session Health Dashboard (Medium)

**Problem:** Silent failures — agent loses tools, stops responding, no diagnostics (Issues #34810, #5030, #45173).

**What we have now:** Session status tracking (active/idle/ended), TopBar with basic stats.

**What's missing:**
1. **Session health score** — composite metric: context utilization, cost anomalies, error rate, cache efficiency.
2. **Error/failure detection** — detect when tool calls fail (error responses), when turns stop coming (stall detection), when model changes unexpectedly (fallback routing).
3. **Multi-session overview** — at-a-glance health of all active sessions, not just the selected one.

**Implementation:**
- **Backend:** Add error detection in parsers: tool call failures (error content), model changes between turns, stall detection (gap > N minutes).
- **Frontend:** Health indicator in SessionList — green/yellow/red dot based on composite health.
- **Frontend:** New "Overview" tab or dashboard showing all sessions with key metrics.

## Implementation Priority

| Phase | Feature | Effort | Impact |
|-------|---------|--------|--------|
| A | Context overflow prediction + danger alerts | Low | Critical — #1 pain point |
| A | Cache efficiency chart + invalidation alerts | Medium | High — unique insight |
| B | Cross-session cost overview | Medium | High — #2 pain point |
| B | Token composition breakdown | Medium | High — waste visibility |
| C | Compaction detection in OpenClaw parser | Low | Medium-High |
| C | Session health score + multi-session overview | High | Medium |

Phase A is the highest-ROI work: it addresses the top 2 pain points (context blindness, cache instability) with moderate implementation effort, using data we already collect.

## Files to Modify

### Backend (Rust)
- `src-tauri/src/agents/openclaw.rs` — Read `sessions.json` metadata, detect compactions
- `src-tauri/src/pricing.rs` — Ensure OpenAI model context windows are correct
- `src-tauri/src/db.rs` — Add `get_daily_cost_summary()` query

### Frontend (React/TS)
- `src/client/components/context/ContextTab.tsx` — Overflow prediction, danger alerts
- `src/client/components/context/ContextChart.tsx` — Threshold lines, compaction markers
- `src/client/components/cost/CostSummaryCards.tsx` — Cache savings card, model breakdown
- `src/client/components/cost/CacheEfficiencyChart.tsx` — New component
- `src/client/components/cost/TokenComposition.tsx` — New component
- `src/client/components/TopBar.tsx` — Context overflow ETA, agent-specific stats
- `src/client/App.tsx` — Feature gating per agent type
