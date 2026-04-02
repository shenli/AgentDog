use crate::config;
use crate::db::Database;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager,
};

fn format_tokens(n: i64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M tokens", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}K tokens", n as f64 / 1_000.0)
    } else {
        format!("{} tokens", n)
    }
}

fn agent_prefix(agent_type: &str) -> &str {
    match agent_type {
        "codex_cli" => "[Codex] ",
        "openclaw" => "[OC] ",
        _ => "", // Claude Code is the default, no prefix needed
    }
}

/// Build the initial tray icon.
pub fn build_tray(app: &AppHandle) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let menu = build_initial_menu(app)?;

    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("AgentDog")
        .menu(&menu)
        .on_menu_event(handle_menu_event)
        .build(app)?;

    Ok(tray)
}

fn build_initial_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let no_sessions = MenuItem::with_id(app, "no_sessions", "No active sessions", false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&no_sessions, &sep, &show, &settings, &quit])?;
    Ok(menu)
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id.0.as_str();
    match id {
        "show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "settings" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit("navigate", "settings");
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {
            if id.starts_with("session:") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let session_id = &id["session:".len()..];
                    let _ = app.emit("select_session", session_id);
                }
            }
        }
    }
}

/// Rebuild the tray menu with current session data.
/// Uses a fingerprint to avoid rebuilding when nothing changed (which closes the open menu).
pub fn update_tray_menu(
    app: &AppHandle,
    tray: &TrayIcon,
    db: &Arc<Database>,
    last_fingerprint: &mut String,
) {
    let sessions = match db.get_sessions() {
        Ok(s) => s,
        Err(e) => {
            log::error!("Tray: failed to get sessions: {}", e);
            return;
        }
    };

    let active: Vec<_> = sessions.iter().filter(|s| s.status == "active").collect();
    let idle: Vec<_> = sessions.iter().filter(|s| s.status == "idle").collect();

    // Build a fingerprint of session states to detect changes
    let fingerprint = if sessions.is_empty() {
        "empty".to_string() // Distinguish from initial empty string
    } else {
        sessions
            .iter()
            .take(10)
            .map(|s| {
                format!(
                    "{}:{}:{:.2}",
                    s.id.get(..8).unwrap_or(&s.id),
                    s.status,
                    s.total_cost_usd
                )
            })
            .collect::<Vec<_>>()
            .join("|")
    };

    if fingerprint == *last_fingerprint {
        return; // Nothing changed, don't rebuild (would close the open menu)
    }
    *last_fingerprint = fingerprint;

    let cfg = config::load_config();
    let is_max = cfg.plan == "max";

    let menu = match build_session_menu(app, &active, &idle, is_max) {
        Ok(m) => m,
        Err(e) => {
            log::error!("Tray: failed to build menu: {}", e);
            return;
        }
    };

    if let Err(e) = tray.set_menu(Some(menu)) {
        log::error!("Tray: failed to set menu: {}", e);
    }

    // Update tooltip
    let tooltip = if active.is_empty() {
        "AgentDog — no active sessions".to_string()
    } else {
        if is_max {
            let total_tokens: i64 = active.iter().map(|s| s.total_input_tokens + s.total_output_tokens).sum();
            format!("AgentDog — {} active, {}", active.len(), format_tokens(total_tokens))
        } else {
            let total_cost: f64 = active.iter().map(|s| s.total_cost_usd).sum();
            format!("AgentDog — {} active, ${:.2}", active.len(), total_cost)
        }
    };
    let _ = tray.set_tooltip(Some(&tooltip));
}

fn build_session_menu(
    app: &AppHandle,
    active: &[&crate::db::SessionRow],
    idle: &[&crate::db::SessionRow],
    is_max: bool,
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;

    if !active.is_empty() {
        let header = MenuItem::with_id(app, "header_active", "ACTIVE", false, None::<&str>)?;
        menu.append(&header)?;

        for s in active {
            let short_name = s.project_name.rsplit('/').next().unwrap_or(&s.project_name);
            let total_tokens = s.total_input_tokens + s.total_output_tokens;
            let prefix = agent_prefix(&s.agent_type);
            let label = if is_max {
                format!("● {}{}  {}",
                    prefix,
                    short_name,
                    format_tokens(total_tokens),
                )
            } else {
                format!("● {}{}  ${:.2}", prefix, short_name, s.total_cost_usd)
            };
            // Use a truncated ID for the menu item to avoid platform issues with long IDs
            let menu_id = format!("session:{}", &s.id[..s.id.len().min(64)]);
            let item = MenuItem::with_id(
                app,
                &menu_id,
                &label,
                true,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }

    if !idle.is_empty() {
        if !active.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        let header = MenuItem::with_id(app, "header_recent", "RECENT", false, None::<&str>)?;
        menu.append(&header)?;

        for s in idle.iter().take(5) {
            let short_name = s.project_name.rsplit('/').next().unwrap_or(&s.project_name);
            let total_tokens = s.total_input_tokens + s.total_output_tokens;
            let prefix = agent_prefix(&s.agent_type);
            let label = if is_max {
                format!("○ {}{}  {}", prefix, short_name, format_tokens(total_tokens))
            } else {
                format!("○ {}{}  ${:.2}", prefix, short_name, s.total_cost_usd)
            };
            let menu_id = format!("session:{}", &s.id[..s.id.len().min(64)]);
            let item = MenuItem::with_id(
                app,
                &menu_id,
                &label,
                true,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }

    if active.is_empty() && idle.is_empty() {
        let no_sessions = MenuItem::with_id(app, "no_sessions", "No active sessions", false, None::<&str>)?;
        menu.append(&no_sessions)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
    menu.append(&show)?;

    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    menu.append(&settings)?;

    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    menu.append(&quit)?;

    Ok(menu)
}
