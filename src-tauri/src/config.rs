use crate::agent::AgentType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Billing mode for an agent — determines how cost is displayed and whether cost warnings fire.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BillingMode {
    /// Flat subscription (e.g., Claude Max/Pro) — cost is API-equivalent only, no cost warnings
    Subscription,
    /// Pay-per-token API (e.g., Claude API, Codex) — cost is real spend, warnings enabled
    Api,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Deprecated — kept for backward compat, replaced by billing_mode
    #[serde(default = "default_plan")]
    pub plan: String,
    /// Which agent backends are enabled
    #[serde(default = "default_enabled_agents")]
    pub enabled_agents: Vec<AgentType>,
    /// Per-agent billing mode override. Agents not listed use the default for their type.
    #[serde(default)]
    pub billing: HashMap<String, BillingMode>,
    /// Custom model pricing. Key is a model name prefix (e.g. "my-model" matches "my-model-v2").
    /// Prices are per million tokens.
    #[serde(default)]
    pub custom_pricing: HashMap<String, CustomModelPricing>,
}

/// User-defined pricing for models not in the built-in table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomModelPricing {
    pub input_per_million: f64,
    pub output_per_million: f64,
    #[serde(default)]
    pub cache_read_per_million: f64,
    #[serde(default)]
    pub cache_write_per_million: f64,
    #[serde(default = "default_context_window")]
    pub context_window: i64,
}

fn default_context_window() -> i64 {
    200_000
}

fn default_plan() -> String {
    "max".to_string()
}

fn default_enabled_agents() -> Vec<AgentType> {
    vec![AgentType::ClaudeCode, AgentType::CodexCli, AgentType::OpenClaw]
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            plan: default_plan(),
            enabled_agents: default_enabled_agents(),
            billing: HashMap::new(),
            custom_pricing: HashMap::new(),
        }
    }
}

impl AppConfig {
    /// Get the billing mode for an agent type.
    /// Uses explicit config if set, otherwise falls back to sensible defaults.
    #[allow(dead_code)]
    pub fn billing_mode(&self, agent_type: &str) -> BillingMode {
        if let Some(mode) = self.billing.get(agent_type) {
            return mode.clone();
        }
        // Defaults: Claude Code = subscription (Max/Pro), others = API
        match agent_type {
            "claude_code" => BillingMode::Subscription,
            _ => BillingMode::Api,
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
