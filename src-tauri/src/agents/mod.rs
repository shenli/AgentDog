pub mod claude_code;
pub mod codex_cli;
pub mod openclaw;

use crate::agent::{AgentBackend, AgentType};
use crate::config::AppConfig;

pub fn all_backends(config: &AppConfig) -> Vec<Box<dyn AgentBackend>> {
    let mut backends: Vec<Box<dyn AgentBackend>> = Vec::new();

    for agent_type in &config.enabled_agents {
        match agent_type {
            AgentType::ClaudeCode => {
                backends.push(Box::new(claude_code::ClaudeCodeBackend));
            }
            AgentType::CodexCli => {
                backends.push(Box::new(codex_cli::CodexCliBackend));
            }
            AgentType::OpenClaw => {
                backends.push(Box::new(openclaw::OpenClawBackend));
            }
        }
    }

    backends
}
