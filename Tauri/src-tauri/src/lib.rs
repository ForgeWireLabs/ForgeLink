use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:5055";
const MOBILE_STATE_DIR: &str = "mobile-runtime";
const ATTENTION_POLICY_FILE: &str = "attention-policy.json";
const AGENT_CHANNELS_FILE: &str = "agent-channels.json";

fn base_url() -> String {
    std::env::var("FORGELINK_LOCAL_API_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

fn api_token() -> String {
    std::env::var("FORGELINK_LOCAL_API_TOKEN")
        .or_else(|_| std::env::var("FORGELINK_API_TOKEN"))
        .unwrap_or_else(|_| "tauri-scaffold-token".to_string())
}

fn now_marker() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("unix:{}", duration.as_secs()))
        .unwrap_or_else(|_| "unix:0".to_string())
}

fn mobile_state_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|path| path.join(MOBILE_STATE_DIR))
}

fn default_attention_policy() -> Value {
    json!({
        "enabled": true,
        "operator_mode": "available",
        "quiet_hours_enabled": false,
        "quiet_hours_start": "22:00",
        "quiet_hours_end": "07:00",
        "quiet_hours_allow_urgent": false,
        "redact_notification_bodies": true,
        "sms_notifications": "all",
        "agent_notifications": "high_and_urgent",
        "signal_notifications": "off",
        "system_notifications": "all",
        "emergency_contact_bypass": true,
        "emergency_agent_requires_policy": true,
        "presence_enabled": true,
        "presence_app_focus": "unknown",
        "presence_input": "unknown",
        "presence_network": "unknown",
        "presence_do_not_disturb": false,
        "presence_paired_mobile": "unknown",
        "muted_sources": []
    })
}

fn read_json(path: &Path, fallback: Value) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .unwrap_or(fallback)
}

fn write_json(path: &Path, value: &Value) -> Value {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(contents) = serde_json::to_string_pretty(value) {
        let _ = fs::write(path, contents);
    }
    value.clone()
}

fn attention_policy_from_dir(dir: Option<&Path>) -> Value {
    dir.map(|state_dir| read_json(&state_dir.join(ATTENTION_POLICY_FILE), default_attention_policy()))
        .unwrap_or_else(default_attention_policy)
}

fn save_attention_policy_to_dir(dir: Option<&Path>, payload: Value) -> Value {
    dir.map(|state_dir| write_json(&state_dir.join(ATTENTION_POLICY_FILE), &payload))
        .unwrap_or(payload)
}

fn desktop_status() -> Value {
    json!({
        "running": true,
        "baseUrl": base_url(),
        "configured": false,
        "credential_source": "none",
        "onboarding_complete": true,
        "needs_onboarding": false,
        "settings": {
            "account_sid": "",
            "auth_token_configured": false,
            "twilio_number": "",
            "public_base_url": "",
            "webhook_host": "127.0.0.1",
            "webhook_port": 5055,
            "attention_policy": default_attention_policy()
        }
    })
}

fn mcp_status() -> Value {
    json!({
        "configured": false,
        "created_at": null,
        "rotated_at": null,
        "revoked_at": null,
        "last_used_at": null,
        "last_test_at": null,
        "last_test_status": null,
        "token_file": "",
        "token_file_present": false,
        "bridge_server": "",
        "bridge_built": false,
        "base_url": base_url(),
        "install_commands": {}
    })
}

fn agent_channel(channel_id: &str, label: &str) -> Value {
    let now = now_marker();
    json!({
        "channel_id": channel_id,
        "label": label,
        "enabled": true,
        "configured": true,
        "created_at": now,
        "rotated_at": now,
        "revoked_at": null,
        "last_used_at": null,
        "last_rejected_at": null,
        "rejection_count": 0,
        "rate_limited_count": 0,
        "token_file": "",
        "token_file_present": false
    })
}

fn channels_from_dir(dir: Option<&Path>) -> Vec<Value> {
    let value = dir
        .map(|state_dir| read_json(&state_dir.join(AGENT_CHANNELS_FILE), json!([])))
        .unwrap_or_else(|| json!([]));
    value.as_array().cloned().unwrap_or_default()
}

fn save_channels_to_dir(dir: Option<&Path>, channels: &[Value]) -> Vec<Value> {
    if let Some(state_dir) = dir {
        let _ = write_json(&state_dir.join(AGENT_CHANNELS_FILE), &json!(channels));
    }
    channels.to_vec()
}

fn upsert_channel(mut channels: Vec<Value>, channel: Value) -> Vec<Value> {
    let channel_id = channel["channel_id"].as_str().unwrap_or_default().to_string();
    if let Some(existing) = channels.iter_mut().find(|candidate| candidate["channel_id"].as_str() == Some(channel_id.as_str())) {
        *existing = channel;
    } else {
        channels.push(channel);
    }
    channels
}

fn update_channel(mut channels: Vec<Value>, channel_id: &str, updater: impl FnOnce(&mut Value)) -> (Vec<Value>, Value) {
    if let Some(existing) = channels.iter_mut().find(|candidate| candidate["channel_id"].as_str() == Some(channel_id)) {
        updater(existing);
        let updated = existing.clone();
        return (channels.clone(), updated);
    }

    let mut created = agent_channel(channel_id, channel_id);
    updater(&mut created);
    channels.push(created.clone());
    (channels, created)
}

fn desktop_linked_node_status() -> Value {
    json!({
        "schema_version": 1,
        "authority_node_id": "desktop-authority-node",
        "linked_nodes": [],
        "sync_health": {
            "state": "local_only",
            "redacted": true,
            "detail": "Desktop linked-node status exposes redacted metadata only and accepts no private change sets.",
            "last_checked_at": null,
            "accepts_private_change_sets": false,
            "private_data_sync_enabled": false,
            "broad_background_sync_enabled": false,
            "clustering_enabled": false
        },
        "accepted_data_classes": [
            "node_link_status",
            "capability_cache",
            "sync_checkpoint_metadata",
            "redacted_sync_health",
            "wipe_status"
        ],
        "forbidden_data_classes": [
            "raw_private_data",
            "raw_messages",
            "contacts",
            "calls",
            "signal_content",
            "attachments",
            "credentials",
            "provider_secrets",
            "tokens"
        ],
        "capability_claims": [
            "linked_nodes.list",
            "node.capabilities.read",
            "sync.health.redacted",
            "change_sets.private.reject"
        ],
        "detail": "Desktop authority metadata command. Android can query linked-node status and redacted sync health without private data, credentials, provider secrets, broad background sync, or clustering."
    })
}

#[tauri::command]
fn forgelink_desktop_linked_node_status() -> Value {
    desktop_linked_node_status()
}

#[tauri::command]
fn forgelink_backend_connection() -> Value {
    json!({ "baseUrl": base_url(), "apiToken": api_token() })
}

#[tauri::command]
fn forgelink_get_status() -> Value {
    desktop_status()
}

#[tauri::command]
fn forgelink_start_local_only(_payload: Value) -> Value {
    desktop_status()
}

#[tauri::command]
fn forgelink_start_server(_payload: Value) -> Value {
    desktop_status()
}

#[tauri::command]
fn forgelink_stop_server() -> Value {
    let mut status = desktop_status();
    status["running"] = json!(false);
    status
}

#[tauri::command]
fn forgelink_validate_settings(_payload: Value) -> Value {
    json!({ "account_name": "Tauri mobile runtime", "account_status": "mobile-local", "phone_number": "" })
}

#[tauri::command]
fn forgelink_import_environment() -> Value {
    desktop_status()
}

#[tauri::command]
fn forgelink_remove_credentials() -> Value {
    desktop_status()
}

#[tauri::command]
fn forgelink_notify(_title: String, _body: String) {}

#[tauri::command]
fn forgelink_notify_event(_payload: Value) -> Value {
    json!({ "notify": true, "reason": "tauri_mobile_local", "title": "ForgeLink", "body": "ForgeLink has an update." })
}

#[tauri::command]
fn forgelink_open_external(_url: String) {}

#[tauri::command]
fn forgelink_attention_policy(app: tauri::AppHandle) -> Value {
    let dir = mobile_state_dir(&app);
    attention_policy_from_dir(dir.as_deref())
}

#[tauri::command]
fn forgelink_save_attention_policy(app: tauri::AppHandle, payload: Value) -> Value {
    let dir = mobile_state_dir(&app);
    save_attention_policy_to_dir(dir.as_deref(), payload)
}

#[tauri::command]
fn forgelink_mcp_status() -> Value {
    mcp_status()
}

#[tauri::command]
fn forgelink_create_mcp_token() -> Value {
    mcp_status()
}

#[tauri::command]
fn forgelink_revoke_mcp_token() -> Value {
    mcp_status()
}

#[tauri::command]
fn forgelink_test_mcp_bridge() -> Value {
    mcp_status()
}

#[tauri::command]
fn forgelink_agent_channels(app: tauri::AppHandle) -> Value {
    let dir = mobile_state_dir(&app);
    json!(channels_from_dir(dir.as_deref()))
}

#[tauri::command]
fn forgelink_create_agent_channel(app: tauri::AppHandle, payload: Value) -> Value {
    let dir = mobile_state_dir(&app);
    let channel = agent_channel(
        payload["channel_id"].as_str().unwrap_or("forgewire"),
        payload["label"].as_str().unwrap_or("ForgeWire Fabric"),
    );
    let channels = upsert_channel(channels_from_dir(dir.as_deref()), channel.clone());
    let _ = save_channels_to_dir(dir.as_deref(), &channels);
    channel
}

#[tauri::command]
fn forgelink_rotate_agent_channel(app: tauri::AppHandle, channel_id: String) -> Value {
    let dir = mobile_state_dir(&app);
    let (channels, channel) = update_channel(channels_from_dir(dir.as_deref()), &channel_id, |existing| {
        existing["configured"] = json!(true);
        existing["revoked_at"] = json!(null);
        existing["rotated_at"] = json!(now_marker());
        existing["token_file_present"] = json!(false);
    });
    let _ = save_channels_to_dir(dir.as_deref(), &channels);
    channel
}

#[tauri::command]
fn forgelink_revoke_agent_channel(app: tauri::AppHandle, channel_id: String) -> Value {
    let dir = mobile_state_dir(&app);
    let (channels, channel) = update_channel(channels_from_dir(dir.as_deref()), &channel_id, |existing| {
        existing["enabled"] = json!(false);
        existing["configured"] = json!(false);
        existing["revoked_at"] = json!(now_marker());
        existing["token_file_present"] = json!(false);
    });
    let _ = save_channels_to_dir(dir.as_deref(), &channels);
    channel
}

#[tauri::command]
fn forgelink_set_agent_channel_enabled(app: tauri::AppHandle, channel_id: String, enabled: bool) -> Value {
    let dir = mobile_state_dir(&app);
    let (channels, channel) = update_channel(channels_from_dir(dir.as_deref()), &channel_id, |existing| {
        existing["enabled"] = json!(enabled);
    });
    let _ = save_channels_to_dir(dir.as_deref(), &channels);
    channel
}

#[tauri::command]
fn forgelink_email_settings() -> Value {
    json!({ "configured": false, "host": "", "port": 465, "secure": true, "user": "", "from": "", "password_present": false, "inbound_secret_present": false, "action_secret_present": false })
}

#[tauri::command]
fn forgelink_save_email_settings(_payload: Value) -> Value {
    forgelink_email_settings()
}

#[tauri::command]
fn forgelink_remove_email_settings() -> Value {
    forgelink_email_settings()
}

#[tauri::command]
fn forgelink_push_settings() -> Value {
    json!({ "configured": false, "provider": "ntfy", "url": "https://ntfy.sh", "profile": "lock_screen_safe", "topic_present": false, "token_present": false })
}

#[tauri::command]
fn forgelink_save_push_settings(_payload: Value) -> Value {
    forgelink_push_settings()
}

#[tauri::command]
fn forgelink_remove_push_settings() -> Value {
    forgelink_push_settings()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            forgelink_backend_connection,
            forgelink_desktop_linked_node_status,
            forgelink_get_status,
            forgelink_start_local_only,
            forgelink_start_server,
            forgelink_stop_server,
            forgelink_validate_settings,
            forgelink_import_environment,
            forgelink_remove_credentials,
            forgelink_notify,
            forgelink_notify_event,
            forgelink_open_external,
            forgelink_attention_policy,
            forgelink_save_attention_policy,
            forgelink_mcp_status,
            forgelink_create_mcp_token,
            forgelink_revoke_mcp_token,
            forgelink_test_mcp_bridge,
            forgelink_agent_channels,
            forgelink_create_agent_channel,
            forgelink_rotate_agent_channel,
            forgelink_revoke_agent_channel,
            forgelink_set_agent_channel_enabled,
            forgelink_email_settings,
            forgelink_save_email_settings,
            forgelink_remove_email_settings,
            forgelink_push_settings,
            forgelink_save_push_settings,
            forgelink_remove_push_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running ForgeLink Tauri shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("forgelink-tauri-mobile-runtime-{}-{}", name, now_marker().replace(':', "-")));
        path
    }

    #[test]
    fn desktop_linked_node_status_returns_redacted_metadata_only() {
        let status = desktop_linked_node_status();

        assert_eq!(status["schema_version"], json!(1));
        assert_eq!(status["authority_node_id"], json!("desktop-authority-node"));
        assert_eq!(status["linked_nodes"], json!([]));
        assert_eq!(status["sync_health"]["state"], json!("local_only"));
        assert_eq!(status["sync_health"]["redacted"], json!(true));
        assert_eq!(
            status["sync_health"]["accepts_private_change_sets"],
            json!(false)
        );
        assert_eq!(
            status["sync_health"]["private_data_sync_enabled"],
            json!(false)
        );
        assert_eq!(
            status["sync_health"]["broad_background_sync_enabled"],
            json!(false)
        );
        assert_eq!(
            status["sync_health"]["clustering_enabled"],
            json!(false)
        );

        let accepted = status["accepted_data_classes"]
            .as_array()
            .expect("accepted metadata classes");
        assert!(accepted.contains(&json!("node_link_status")));
        assert!(accepted.contains(&json!("capability_cache")));
        assert!(accepted.contains(&json!("sync_checkpoint_metadata")));
        assert!(accepted.contains(&json!("redacted_sync_health")));
        assert!(accepted.contains(&json!("wipe_status")));

        let forbidden = status["forbidden_data_classes"]
            .as_array()
            .expect("forbidden private data classes");
        assert!(forbidden.contains(&json!("raw_private_data")));
        assert!(forbidden.contains(&json!("raw_messages")));
        assert!(forbidden.contains(&json!("contacts")));
        assert!(forbidden.contains(&json!("credentials")));
        assert!(forbidden.contains(&json!("provider_secrets")));
        assert!(forbidden.contains(&json!("tokens")));
    }

    #[test]
    fn desktop_linked_node_command_rejects_private_change_sets() {
        let status = forgelink_desktop_linked_node_status();

        assert_eq!(
            status["sync_health"]["accepts_private_change_sets"],
            json!(false)
        );
        assert_eq!(
            status["capability_claims"],
            json!([
                "linked_nodes.list",
                "node.capabilities.read",
                "sync.health.redacted",
                "change_sets.private.reject"
            ])
        );

        let serialized = serde_json::to_string(&status).expect("serialize status");
        assert!(!serialized.contains("message_body"));
        assert!(!serialized.contains("contact_number"));
        assert!(!serialized.contains("credential_value"));
        assert!(!serialized.contains("provider_secret_value"));
    }

    #[test]
    fn backend_connection_uses_loopback_and_scaffold_token() {
        let connection = forgelink_backend_connection();
        assert_eq!(connection["baseUrl"], json!("http://127.0.0.1:5055"));
        assert_eq!(connection["apiToken"], json!("tauri-scaffold-token"));
    }

    #[test]
    fn desktop_status_is_local_only_and_does_not_require_onboarding() {
        let status = forgelink_get_status();
        assert_eq!(status["running"], json!(true));
        assert_eq!(status["configured"], json!(false));
        assert_eq!(status["credential_source"], json!("none"));
        assert_eq!(status["needs_onboarding"], json!(false));
        assert_eq!(status["settings"]["webhook_host"], json!("127.0.0.1"));
    }

    #[test]
    fn stop_server_reports_stopped_without_mutating_private_data() {
        let status = forgelink_stop_server();
        assert_eq!(status["running"], json!(false));
        assert_eq!(status["settings"]["auth_token_configured"], json!(false));
    }

    #[test]
    fn notification_and_attention_defaults_return_renderer_safe_shapes() {
        let decision = forgelink_notify_event(json!({ "kind": "system", "title": "test" }));
        assert_eq!(decision["notify"], json!(true));
        assert_eq!(decision["reason"], json!("tauri_mobile_local"));

        let policy = default_attention_policy();
        assert_eq!(policy["redact_notification_bodies"], json!(true));
        assert_eq!(policy["presence_paired_mobile"], json!("unknown"));
    }

    #[test]
    fn attention_policy_persists_to_mobile_state_dir() {
        let dir = test_state_dir("attention");
        let mut policy = default_attention_policy();
        policy["operator_mode"] = json!("focus");
        policy["quiet_hours_enabled"] = json!(true);

        let saved = save_attention_policy_to_dir(Some(&dir), policy.clone());
        assert_eq!(saved["operator_mode"], json!("focus"));

        let loaded = attention_policy_from_dir(Some(&dir));
        assert_eq!(loaded["operator_mode"], json!("focus"));
        assert_eq!(loaded["quiet_hours_enabled"], json!(true));
    }

    #[test]
    fn agent_channels_persist_metadata_without_secret_files() {
        let dir = test_state_dir("channels");
        let channel = agent_channel("forgewire", "ForgeWire Fabric");
        let channels = upsert_channel(channels_from_dir(Some(&dir)), channel.clone());
        save_channels_to_dir(Some(&dir), &channels);

        let loaded = channels_from_dir(Some(&dir));
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0]["channel_id"], json!("forgewire"));
        assert_eq!(loaded[0]["label"], json!("ForgeWire Fabric"));
        assert_eq!(loaded[0]["configured"], json!(true));
        assert_eq!(loaded[0]["token_file_present"], json!(false));
    }

    #[test]
    fn agent_channel_revoke_and_enable_update_existing_record() {
        let dir = test_state_dir("channel-update");
        let channels = upsert_channel(channels_from_dir(Some(&dir)), agent_channel("forgewire", "ForgeWire Fabric"));
        save_channels_to_dir(Some(&dir), &channels);

        let (channels, revoked) = update_channel(channels_from_dir(Some(&dir)), "forgewire", |existing| {
            existing["enabled"] = json!(false);
            existing["configured"] = json!(false);
            existing["revoked_at"] = json!(now_marker());
        });
        assert_eq!(revoked["enabled"], json!(false));
        assert_eq!(revoked["configured"], json!(false));
        assert!(revoked["revoked_at"].as_str().unwrap_or_default().starts_with("unix:"));

        let (channels, enabled) = update_channel(channels, "forgewire", |existing| {
            existing["enabled"] = json!(true);
        });
        save_channels_to_dir(Some(&dir), &channels);
        assert_eq!(enabled["enabled"], json!(true));

        let loaded = channels_from_dir(Some(&dir));
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0]["enabled"], json!(true));
    }
}
