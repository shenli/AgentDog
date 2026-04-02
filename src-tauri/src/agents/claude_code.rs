use crate::agent::{AgentBackend, AgentFeature, AgentParser, AgentType, DiscoveredSession};
use crate::discovery::unsanitize_path;
use crate::parser::{truncate_str, ParseEvent, ParsedAnomaly, ParsedCompaction, ParsedContextSnapshot, ParsedToolCall, ParsedToolResult, ParsedTurn};
use crate::pricing::calculate_cost;
use serde_json::Value;
use std::path::PathBuf;
use std::time::SystemTime;

// ─── Backend ───

pub struct ClaudeCodeBackend;

impl AgentBackend for ClaudeCodeBackend {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn discover_sessions(&self) -> Vec<DiscoveredSession> {
        let projects_dir = match dirs::home_dir() {
            Some(h) => h.join(".claude").join("projects"),
            None => return vec![],
        };

        let project_dirs = match std::fs::read_dir(&projects_dir) {
            Ok(rd) => rd,
            Err(_) => return vec![],
        };

        let mut results = Vec::new();
        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        for entry in project_dirs.flatten() {
            let dir_name = entry.file_name().to_string_lossy().to_string();
            let project_name = unsanitize_path(&dir_name);

            let sessions_dir = entry.path().join("sessions");
            let search_dirs: Vec<PathBuf> = if sessions_dir.is_dir() {
                vec![sessions_dir]
            } else {
                vec![entry.path()]
            };

            for search_dir in search_dirs {
                let files = match std::fs::read_dir(&search_dir) {
                    Ok(rd) => rd,
                    Err(_) => continue,
                };

                for file_entry in files.flatten() {
                    let fname = file_entry.file_name().to_string_lossy().to_string();
                    if !fname.ends_with(".jsonl") {
                        continue;
                    }

                    let file_path = file_entry.path();
                    let metadata = match file_path.metadata() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };

                    let mtime_ms = metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);

                    let idle_ms = now_ms - mtime_ms;
                    if idle_ms > 30 * 60 * 1000 {
                        continue;
                    }

                    let session_id = fname.trim_end_matches(".jsonl").to_string();

                    results.push(DiscoveredSession {
                        session_id,
                        agent_type: AgentType::ClaudeCode,
                        project_dir: dir_name.clone(),
                        project_name: project_name.clone(),
                        transcript_path: file_path.to_string_lossy().to_string(),
                        last_modified: mtime_ms,
                        is_active: idle_ms < 5 * 60 * 1000,
                        is_recent: idle_ms < 30 * 60 * 1000,
                    });
                }
            }
        }

        results.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        results
    }

    fn create_parser(&self, session_id: &str) -> Box<dyn AgentParser> {
        Box::new(ClaudeCodeParser::new(session_id.to_string()))
    }

    fn supports_feature(&self, _feature: AgentFeature) -> bool {
        true // Claude Code supports all features
    }

    fn memory_dir(&self, project_dir: &str) -> Option<PathBuf> {
        let home = dirs::home_dir()?;
        let dir = home
            .join(".claude")
            .join("projects")
            .join(project_dir)
            .join("memory");
        if dir.exists() {
            Some(dir)
        } else {
            None
        }
    }
}

// ─── Parser ───

#[derive(Debug, Clone)]
pub struct ClaudeCodeParser {
    pub session_id: String,
    pub turn_number: i64,
    pub cumulative_input_tokens: i64,
    pub cumulative_output_tokens: i64,
    pub cumulative_cache_read_tokens: i64,
    pub cumulative_cache_write_tokens: i64,
    pub cumulative_cost_usd: f64,
    pub model: Option<String>,
    pub recent_turn_costs: Vec<f64>,
}

impl ClaudeCodeParser {
    pub fn new(session_id: String) -> Self {
        Self {
            session_id,
            turn_number: 0,
            cumulative_input_tokens: 0,
            cumulative_output_tokens: 0,
            cumulative_cache_read_tokens: 0,
            cumulative_cache_write_tokens: 0,
            cumulative_cost_usd: 0.0,
            model: None,
            recent_turn_costs: Vec::new(),
        }
    }

    fn extract_context_composition(&self, line: &Value, timestamp: i64) -> ParsedContextSnapshot {
        let content = Self::extract_text_content(line);
        let total_tokens = estimate_tokens(&content);

        let mut config_file_tokens: i64 = 0;
        let mut agent_memory_tokens: i64 = 0;

        // Detect CLAUDE.md content blocks
        let mut search_from = 0;
        while let Some(start) = content[search_from..].find("CLAUDE.md") {
            let abs_start = search_from + start;
            if let Some(content_start) = content[abs_start..].find("\n\n") {
                let abs_content_start = abs_start + content_start + 2;
                let end = content[abs_content_start..]
                    .find("\nContents of ")
                    .or_else(|| content[abs_content_start..].find("\n# "))
                    .or_else(|| content[abs_content_start..].find("\n---"))
                    .map(|e| abs_content_start + e)
                    .unwrap_or(content.len());
                config_file_tokens += estimate_tokens(&content[abs_content_start..end]);
                search_from = end;
            } else {
                break;
            }
        }

        // Detect MEMORY.md / auto memory content
        if let Some(mem_start) = content.find("# auto memory\n") {
            let section_start = mem_start + "# auto memory\n".len();
            let section_end = content[section_start..]
                .find("\n# ")
                .map(|e| section_start + e)
                .unwrap_or(content.len());
            agent_memory_tokens = estimate_tokens(&content[section_start..section_end]);
        }

        let system_prompt_tokens = total_tokens - config_file_tokens - agent_memory_tokens;
        let available_tokens = 200_000 - total_tokens;

        ParsedContextSnapshot {
            session_id: self.session_id.clone(),
            turn_number: self.turn_number,
            timestamp,
            system_prompt_tokens: system_prompt_tokens.max(0),
            config_file_tokens,
            agent_memory_tokens,
            memory_topic_tokens: 0,
            conversation_tokens: 0,
            tool_result_tokens: 0,
            available_tokens: available_tokens.max(0),
        }
    }

    fn extract_text_content(line: &Value) -> String {
        if let Some(s) = line.get("content").and_then(|v| v.as_str()) {
            return s.to_string();
        }
        if let Some(arr) = line.get("content").and_then(|v| v.as_array()) {
            return arr
                .iter()
                .filter_map(|block| block.get("text").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join("");
        }
        if let Some(msg) = line.get("message") {
            if let Some(s) = msg.get("content").and_then(|v| v.as_str()) {
                return s.to_string();
            }
            if let Some(arr) = msg.get("content").and_then(|v| v.as_array()) {
                return arr
                    .iter()
                    .filter_map(|block| block.get("text").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join("");
            }
        }
        String::new()
    }
}

impl AgentParser for ClaudeCodeParser {
    fn process_line(&mut self, line: &Value) -> Vec<ParseEvent> {
        let mut events = Vec::new();

        let line_type = line.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let timestamp = line
            .get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.timestamp_millis())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        // Assistant message with usage — this is a turn
        if line_type == "assistant" {
            if let Some(message) = line.get("message") {
                if let Some(usage) = message.get("usage") {
                    let input_tokens = usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                    let output_tokens = usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                    let cache_write_tokens = usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let cache_read_tokens = usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);

                    let model = message
                        .get("model")
                        .and_then(|v| v.as_str())
                        .or_else(|| line.get("model").and_then(|v| v.as_str()))
                        .unwrap_or("unknown")
                        .to_string();

                    let cost = calculate_cost(
                        input_tokens,
                        output_tokens,
                        cache_write_tokens,
                        cache_read_tokens,
                        &model,
                    );

                    let stop_reason = message
                        .get("stop_reason")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    self.turn_number += 1;
                    self.cumulative_input_tokens += input_tokens;
                    self.cumulative_output_tokens += output_tokens;
                    self.cumulative_cache_read_tokens += cache_read_tokens;
                    self.cumulative_cache_write_tokens += cache_write_tokens;
                    self.cumulative_cost_usd += cost;
                    self.model = Some(model.clone());

                    // Anomaly detection
                    self.recent_turn_costs.push(cost);
                    if self.recent_turn_costs.len() > 10 {
                        self.recent_turn_costs.remove(0);
                    }
                    if self.recent_turn_costs.len() >= 3 {
                        let avg: f64 =
                            self.recent_turn_costs.iter().sum::<f64>() / self.recent_turn_costs.len() as f64;
                        if avg > 0.0 && cost > avg * 3.0 {
                            events.push(ParseEvent::Anomaly(ParsedAnomaly {
                                session_id: self.session_id.clone(),
                                turn_number: self.turn_number,
                                timestamp,
                                actual_cost: cost,
                                expected_cost: avg,
                                multiplier: cost / avg,
                            }));
                        }
                    }

                    // Detect background processes
                    let agent_name = line.get("agentName").and_then(|v| v.as_str()).unwrap_or("");
                    let has_agent_id = line.get("agentId").is_some();
                    let is_background = has_agent_id
                        || agent_name.to_lowercase().contains("extract")
                        || agent_name.to_lowercase().contains("dream")
                        || agent_name.to_lowercase().contains("memory");

                    let bg_type = if is_background {
                        let lower = agent_name.to_lowercase();
                        if lower.contains("extract") {
                            Some("extract_memories".to_string())
                        } else if lower.contains("dream") || lower.contains("consolidat") {
                            Some("auto_dream".to_string())
                        } else {
                            Some("session_memory".to_string())
                        }
                    } else {
                        None
                    };

                    // Extract tool calls from content blocks
                    if let Some(content) = message.get("content").and_then(|v| v.as_array()) {
                        for block in content {
                            if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                                let tool_id = block
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let tool_name = block
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let input_str = block
                                    .get("input")
                                    .map(|v| v.to_string())
                                    .unwrap_or_default();
                                let input_summary = truncate_str(&input_str, 500).to_string();

                                events.push(ParseEvent::ToolCall(ParsedToolCall {
                                    session_id: self.session_id.clone(),
                                    id: tool_id,
                                    name: tool_name,
                                    input_summary,
                                    turn_number: self.turn_number,
                                    timestamp,
                                }));
                            }
                        }
                    }

                    events.push(ParseEvent::Turn(ParsedTurn {
                        session_id: self.session_id.clone(),
                        turn_number: self.turn_number,
                        timestamp,
                        model,
                        input_tokens,
                        output_tokens,
                        cache_read_tokens,
                        cache_write_tokens,
                        cost_usd: cost,
                        context_tokens_estimate: input_tokens + cache_read_tokens + cache_write_tokens,
                        stop_reason,
                        is_background_process: is_background,
                        background_process_type: bg_type,
                        cumulative_cost_usd: self.cumulative_cost_usd,
                    }));
                }
            }
        }

        // User message — may contain tool results
        if line_type == "user" {
            if let Some(message) = line.get("message") {
                if let Some(content) = message.get("content").and_then(|v| v.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|v| v.as_str()) == Some("tool_result") {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let content_val = block.get("content");
                            let size = match content_val {
                                Some(Value::String(s)) => s.len() as i64,
                                Some(v) => v.to_string().len() as i64,
                                None => 0,
                            };

                            events.push(ParseEvent::ToolResult(ParsedToolResult {
                                session_id: self.session_id.clone(),
                                tool_use_id,
                                output_size_bytes: size,
                                timestamp,
                            }));
                        }
                    }
                }
            }
        }

        // System prompt — extract context composition
        if line_type == "system" {
            let snapshot = self.extract_context_composition(line, timestamp);
            events.push(ParseEvent::ContextSnapshot(snapshot));
        }

        // Detect compaction via the "system" subtype
        if line_type == "system" {
            let subtype = line.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
            if subtype == "compact" || subtype.contains("compaction") {
                let tokens_before = self.cumulative_input_tokens;
                events.push(ParseEvent::Compaction(ParsedCompaction {
                    session_id: self.session_id.clone(),
                    timestamp,
                    tokens_before,
                    tokens_after: 0,
                    tokens_saved: 0,
                }));
            }
        }

        events
    }

    fn session_id(&self) -> &str {
        &self.session_id
    }

    fn turn_number(&self) -> i64 {
        self.turn_number
    }

    fn model(&self) -> Option<&str> {
        self.model.as_deref()
    }
}

fn estimate_tokens(text: &str) -> i64 {
    (text.len() as f64 / 4.0).ceil() as i64
}
