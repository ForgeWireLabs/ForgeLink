use serde_json::{json, Value};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:5055";

fn base_url() -> String {
    std::env::var("FORGELINK_LOCAL_API_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

fn api_token() -> String {
    std::env::var("FORGELINK_LOCAL_API_TOKEN")
        .or_else(|_| std::env::var("FORGELINK_API_TOKEN"))
        .unwrap_or_else(|_| "tauri-scaffold-token".to_string())
}

fn attention_policy() -> Value {
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
            "attention_policy": attention_policy()
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
    json!({
        "channel_id": channel_id,
        "label": label,
        "enabled": false,
        "configured": false,
        "created_at": "",
        "rotated_at": "",
        "revoked_at": null,
        "last_used_at": null,
        "last_rejected_at": null,
        "rejection_count": 0,
        "rate_limited_count": 0,
        "token_file": "",
        "token_file_present": false
    })
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
    json!({ "account_name": "Tauri scaffold", "account_status": "not-validated", "phone_number": "" })
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
    json!({ "notify": true, "reason": "tauri_scaffold", "title": "ForgeLink", "body": "ForgeLink has an update." })
}

#[tauri::command]
fn forgelink_open_external(_url: String) {}

#[tauri::command]
fn forgelink_attention_policy() -> Value {
    attention_policy()
}

#[tauri::command]
fn forgelink_save_attention_policy(payload: Value) -> Value {
    payload
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
fn forgelink_agent_channels() -> Value {
    json!([])
}

#[tauri::command]
fn forgelink_create_agent_channel(payload: Value) -> Value {
    agent_channel(
        payload["channel_id"].as_str().unwrap_or("forgewire"),
        payload["label"].as_str().unwrap_or("ForgeWire Fabric"),
    )
}

#[tauri::command]
fn forgelink_rotate_agent_channel(channel_id: String) -> Value {
    agent_channel(&channel_id, &channel_id)
}

#[tauri::command]
fn forgelink_revoke_agent_channel(channel_id: String) -> Value {
    agent_channel(&channel_id, &channel_id)
}

#[tauri::command]
fn forgelink_set_agent_channel_enabled(channel_id: String, enabled: bool) -> Value {
    let mut channel = agent_channel(&channel_id, &channel_id);
    channel["enabled"] = json!(enabled);
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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            forgelink_backend_connection,
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
    fn notification_and_attention_commands_return_renderer_safe_shapes() {
        let decision = forgelink_notify_event(json!({ "kind": "system", "title": "test" }));
        assert_eq!(decision["notify"], json!(true));
        assert_eq!(decision["reason"], json!("tauri_scaffold"));

        let policy = forgelink_attention_policy();
        assert_eq!(policy["redact_notification_bodies"], json!(true));
        assert_eq!(policy["presence_paired_mobile"], json!("unknown"));
    }
}
