use crate::parser::ParseEvent;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    CodexCli,
    OpenClaw,
}

impl AgentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "claude_code",
            AgentType::CodexCli => "codex_cli",
            AgentType::OpenClaw => "openclaw",
        }
    }
}

impl std::fmt::Display for AgentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum AgentFeature {
    CostTracking,
    ContextSnapshots,
    Compactions,
    MemoryFiles,
    CacheTokens,
}

/// A discovered session from an agent backend.
pub struct DiscoveredSession {
    pub session_id: String,
    pub agent_type: AgentType,
    pub project_dir: String,
    pub project_name: String,
    pub transcript_path: String,
    pub last_modified: i64,
    pub is_active: bool,
    pub is_recent: bool,
}

/// Trait for agent backends that discover sessions and create parsers.
pub trait AgentBackend: Send + Sync {
    fn agent_type(&self) -> AgentType;
    fn discover_sessions(&self) -> Vec<DiscoveredSession>;
    fn create_parser(&self, session_id: &str) -> Box<dyn AgentParser>;
    #[allow(dead_code)]
    fn supports_feature(&self, feature: AgentFeature) -> bool;
    fn memory_dir(&self, project_dir: &str) -> Option<PathBuf>;
}

/// Trait for stateful session parsers that process JSONL lines into events.
pub trait AgentParser: Send {
    fn process_line(&mut self, line: &Value) -> Vec<ParseEvent>;
    #[allow(dead_code)]
    fn session_id(&self) -> &str;
    #[allow(dead_code)]
    fn turn_number(&self) -> i64;
    fn model(&self) -> Option<&str>;
}
