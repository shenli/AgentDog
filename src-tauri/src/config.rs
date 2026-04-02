use crate::agent::AgentType;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// "max" | "pro" | "api"
    pub plan: String,
    /// Which agent backends are enabled
    #[serde(default = "default_enabled_agents")]
    pub enabled_agents: Vec<AgentType>,
}

fn default_enabled_agents() -> Vec<AgentType> {
    vec![AgentType::ClaudeCode, AgentType::CodexCli, AgentType::OpenClaw]
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            plan: "max".to_string(),
            enabled_agents: default_enabled_agents(),
        }
    }
}

fn config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agentdog")
        .join("config.json")
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => {
            let config = AppConfig::default();
            save_config(&config);
            config
        }
    }
}

pub fn save_config(config: &AppConfig) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = std::fs::write(path, json);
    }
}
