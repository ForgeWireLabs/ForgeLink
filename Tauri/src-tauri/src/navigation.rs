use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub const NAVIGATION_EVENT: &str = "forgelink://navigation-intent";
const MAX_DEEP_LINK_BYTES: usize = 512;
const MAX_LOCAL_ID_BYTES: usize = 80;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NavigationSurface {
    Decisions,
    People,
    Agents,
    Channels,
    Settings,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NavigationSource {
    Startup,
    SecondInstance,
    DeepLink,
    Notification,
    Restore,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct NavigationIntent {
    pub surface: NavigationSurface,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_id: Option<String>,
    pub source: NavigationSource,
}

#[derive(Clone, Default)]
pub struct NavigationCoordinator {
    pending: Arc<Mutex<Option<NavigationIntent>>>,
}

impl NavigationCoordinator {
    pub fn queue(&self, intent: NavigationIntent) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.replace(intent);
        }
    }

    pub fn take_pending(&self) -> Option<NavigationIntent> {
        self.pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.take())
    }

    pub fn route(
        &self,
        app: &tauri::AppHandle,
        raw: &str,
        source: NavigationSource,
    ) -> Option<NavigationIntent> {
        let intent = match parse_deep_link(raw, source) {
            Ok(intent) => intent,
            Err(error) => {
                eprintln!("ForgeLink ignored an invalid navigation link: {error}");
                return None;
            }
        };

        self.publish(app, intent.clone());
        Some(intent)
    }

    pub fn publish(&self, app: &tauri::AppHandle, intent: NavigationIntent) {
        self.queue(intent.clone());
        if let Err(error) = app.emit(NAVIGATION_EVENT, &intent) {
            eprintln!("ForgeLink could not publish a navigation intent: {error}");
        }
    }
}

pub fn parse_deep_link(raw: &str, source: NavigationSource) -> Result<NavigationIntent, String> {
    if raw.len() > MAX_DEEP_LINK_BYTES {
        return Err("link is too long".to_string());
    }
    if !raw.is_ascii() {
        return Err("link contains non-ASCII data".to_string());
    }
    if raw
        .contains(|character: char| character.is_ascii_control() || character.is_ascii_whitespace())
    {
        return Err("link contains whitespace or control data".to_string());
    }
    if !raw.starts_with("forgelink://open/") {
        return Err("link must use the forgelink://open/ route".to_string());
    }

    let route = &raw["forgelink://open/".len()..];
    if route.is_empty() || route.contains(['?', '#', '\\', '%', ':']) {
        return Err("link contains an unsupported URL component".to_string());
    }

    let parts = route.split('/').collect::<Vec<_>>();
    if parts.len() > 2
        || parts
            .iter()
            .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err("link contains an invalid route".to_string());
    }

    let surface = match parts[0] {
        "decisions" => NavigationSurface::Decisions,
        "people" => NavigationSurface::People,
        "agents" => NavigationSurface::Agents,
        "channels" => NavigationSurface::Channels,
        "settings" => NavigationSurface::Settings,
        _ => return Err("link targets an unknown ForgeLink surface".to_string()),
    };
    let local_id = parts.get(1).map(|value| (*value).to_string());
    if matches!(surface, NavigationSurface::Settings) && local_id.is_some() {
        return Err("settings does not accept a local identifier".to_string());
    }
    if let Some(local_id) = &local_id {
        if local_id.len() > MAX_LOCAL_ID_BYTES
            || !local_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err("link contains an invalid local identifier".to_string());
        }
    }

    Ok(NavigationIntent {
        surface,
        local_id,
        source,
    })
}

pub fn intent_from_notification(value: &serde_json::Value) -> Option<NavigationIntent> {
    let navigation = value.get("navigation")?;
    let surface = match navigation.get("surface")?.as_str()? {
        "decisions" => NavigationSurface::Decisions,
        "people" => NavigationSurface::People,
        "agents" => NavigationSurface::Agents,
        "channels" => NavigationSurface::Channels,
        "settings" => NavigationSurface::Settings,
        _ => return None,
    };
    let local_id = navigation
        .get("local_id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    if matches!(surface, NavigationSurface::Settings) && local_id.is_some() {
        return None;
    }
    if local_id.as_deref().is_some_and(|value| {
        value.is_empty()
            || value.len() > MAX_LOCAL_ID_BYTES
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    }) {
        return None;
    }
    Some(NavigationIntent {
        surface,
        local_id,
        source: NavigationSource::Notification,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_bounded_navigation_routes() {
        assert_eq!(
            parse_deep_link(
                "forgelink://open/channels/thread-17",
                NavigationSource::DeepLink
            ),
            Ok(NavigationIntent {
                surface: NavigationSurface::Channels,
                local_id: Some("thread-17".to_string()),
                source: NavigationSource::DeepLink,
            })
        );
        assert_eq!(
            parse_deep_link("forgelink://open/settings", NavigationSource::Startup),
            Ok(NavigationIntent {
                surface: NavigationSurface::Settings,
                local_id: None,
                source: NavigationSource::Startup,
            })
        );
    }

    #[test]
    fn rejects_secret_bearing_or_ambiguous_routes() {
        for raw in [
            "https://example.test/open/channels/1",
            "forgelink://open/channels/1?token=secret",
            "forgelink://open/channels/../settings",
            "forgelink://open/channels/%2Fsecret",
            "forgelink://open/channels/1/approve",
            "forgelink://open/settings/1",
        ] {
            assert!(
                parse_deep_link(raw, NavigationSource::DeepLink).is_err(),
                "{raw}"
            );
        }
    }

    #[test]
    fn notification_targets_are_selection_hints_only() {
        let intent = intent_from_notification(&serde_json::json!({
            "navigation": { "surface": "decisions", "local_id": "agent-1" }
        }))
        .expect("valid notification target");
        assert_eq!(intent.source, NavigationSource::Notification);
        assert!(intent_from_notification(&serde_json::json!({
            "navigation": { "surface": "decisions", "local_id": "approve" },
            "action": "approve"
        }))
        .is_some());
    }
}
