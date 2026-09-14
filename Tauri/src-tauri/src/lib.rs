mod desktop_integration;
mod local_service;
mod navigation;
mod node_identity;
mod node_identity_lifecycle;
mod notifications;
mod protected_settings;
mod secure_store;

use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{Manager, State};

const MOBILE_STATE_DIR: &str = "mobile-runtime";
const ATTENTION_POLICY_FILE: &str = "attention-policy.json";
const LOCAL_SERVICE_CONFIG_FILE: &str = "local-service.json";

fn mobile_state_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|path| path.join(MOBILE_STATE_DIR))
}

fn local_service_config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|path| path.join(LOCAL_SERVICE_CONFIG_FILE))
}

fn local_data_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".forgelink")
}

fn load_local_service_config(app: &tauri::AppHandle) -> local_service::ServiceConfig {
    let Some(path) = local_service_config_path(app) else {
        return local_service::ServiceConfig::default();
    };
    let value = read_json(&path, json!({}));
    let config = local_service::ServiceConfig {
        host: value["host"]
            .as_str()
            .or_else(|| value["webhook_host"].as_str())
            .unwrap_or(local_service::DEFAULT_HOST)
            .to_string(),
        configured_port: value["configured_port"]
            .as_u64()
            .or_else(|| value["webhook_port"].as_u64())
            .and_then(|port| u16::try_from(port).ok())
            .unwrap_or(local_service::DEFAULT_PORT),
        onboarding_complete: value["onboarding_complete"].as_bool().unwrap_or(false),
    };
    if config.validate().is_ok() {
        config
    } else {
        local_service::ServiceConfig::default()
    }
}

fn save_local_service_config(
    app: &tauri::AppHandle,
    config: &local_service::ServiceConfig,
) -> Result<(), String> {
    let path = local_service_config_path(app)
        .ok_or_else(|| "ForgeLink application data directory is unavailable.".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "ForgeLink application data path is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "ForgeLink could not prepare its local-service configuration.".to_string())?;
    let value = json!({
        "version": 1,
        "host": config.host,
        "configured_port": config.configured_port,
        "onboarding_complete": config.onboarding_complete
    });
    let contents = serde_json::to_string_pretty(&value)
        .map_err(|_| "ForgeLink could not encode its local-service configuration.".to_string())?;
    fs::write(path, contents)
        .map_err(|_| "ForgeLink could not save its local-service configuration.".to_string())
}

fn local_service_config_from_payload(
    current: &local_service::ServiceConfig,
    payload: &Value,
    onboarding_complete: bool,
) -> Result<local_service::ServiceConfig, String> {
    let mut config = current.clone();
    if let Some(host) = payload["webhook_host"].as_str() {
        config.host = host.to_string();
    }
    if let Some(port) = payload["webhook_port"].as_u64() {
        config.configured_port = u16::try_from(port)
            .map_err(|_| "Local service port must be between 1024 and 65535.".to_string())?;
    }
    config.onboarding_complete = onboarding_complete;
    config.validate()?;
    Ok(config)
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
    dir.map(|state_dir| {
        read_json(
            &state_dir.join(ATTENTION_POLICY_FILE),
            default_attention_policy(),
        )
    })
    .unwrap_or_else(default_attention_policy)
}

fn save_attention_policy_to_dir(dir: Option<&Path>, payload: Value) -> Value {
    dir.map(|state_dir| write_json(&state_dir.join(ATTENTION_POLICY_FILE), &payload))
        .unwrap_or(payload)
}

fn local_service_status(
    manager: &local_service::LocalServiceManager,
    protected: &protected_settings::ProtectedSettingsService,
) -> Value {
    let config = manager.config();
    let snapshot = manager.snapshot();
    let protected_status = protected.public_status();
    let mut settings = protected.twilio_settings();
    if !settings.is_object() {
        settings = json!({
            "account_sid": "",
            "auth_token_configured": false,
            "twilio_number": "",
            "public_base_url": "",
            "webhook_host": config.host,
            "webhook_port": config.configured_port
        });
    }
    settings["attention_policy"] = default_attention_policy();
    json!({
        "running": snapshot.running,
        "phase": snapshot.phase,
        "service_owner": snapshot.ownership,
        "local_service_owned": snapshot.ownership == "owned",
        "runtime_available": snapshot.runtime_available,
        "mobile_runtime": snapshot.mobile_runtime,
        "baseUrl": snapshot.base_url,
        "configured": protected_status["configured"],
        "credential_source": protected_status["credential_source"],
        "environment_import_available": protected_status["environment_import_available"],
        "onboarding_complete": config.onboarding_complete,
        "needs_onboarding": !config.onboarding_complete && !snapshot.mobile_runtime,
        "configured_port": snapshot.configured_port,
        "effective_port": snapshot.effective_port,
        "backend_restarts": snapshot.backend_restarts,
        "last_exit_code": snapshot.last_exit_code,
        "recovery_message": snapshot.recovery_message,
        "port_note": snapshot.port_note,
        "settings": settings,
        "sms_provider_settings": protected_status["sms_provider_settings"],
        "email_settings": protected_status["email_settings"],
        "push_settings": protected_status["push_settings"],
        "migration": protected_status["migration"],
        "protected_storage": protected_status["protected_storage"]
    })
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
fn forgelink_create_linked_node_identity(
    manager: State<'_, local_service::LocalServiceManager>,
    payload: node_identity_lifecycle::CreateLinkedNodeIdentityRequest,
) -> Result<
    node_identity_lifecycle::LinkedNodeLifecycleResult,
    node_identity_lifecycle::LinkedNodeLifecycleFailure,
> {
    let connection = manager.backend_connection();
    node_identity_lifecycle::create_with_local_backend(
        &connection.base_url,
        &connection.api_token,
        payload,
    )
}

#[tauri::command]
fn forgelink_rotate_linked_node_identity(
    manager: State<'_, local_service::LocalServiceManager>,
    payload: node_identity_lifecycle::RotateLinkedNodeIdentityRequest,
) -> Result<
    node_identity_lifecycle::LinkedNodeLifecycleResult,
    node_identity_lifecycle::LinkedNodeLifecycleFailure,
> {
    let connection = manager.backend_connection();
    node_identity_lifecycle::rotate_with_local_backend(
        &connection.base_url,
        &connection.api_token,
        payload,
    )
}

#[tauri::command]
fn forgelink_recover_linked_node_identity(
    manager: State<'_, local_service::LocalServiceManager>,
    payload: node_identity_lifecycle::RecoverLinkedNodeIdentityRequest,
) -> Result<
    node_identity_lifecycle::LinkedNodeRecoveryResult,
    node_identity_lifecycle::LinkedNodeLifecycleFailure,
> {
    let connection = manager.backend_connection();
    node_identity_lifecycle::recover_with_local_backend(
        &connection.base_url,
        &connection.api_token,
        payload,
    )
}

#[tauri::command]
fn forgelink_desktop_linked_node_status() -> Value {
    desktop_linked_node_status()
}

#[tauri::command]
fn forgelink_backend_connection(manager: State<'_, local_service::LocalServiceManager>) -> Value {
    serde_json::to_value(manager.backend_connection())
        .unwrap_or_else(|_| json!({ "baseUrl": "", "apiToken": "" }))
}

#[tauri::command]
fn forgelink_get_status(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Value {
    local_service_status(&manager, &protected)
}

#[tauri::command]
fn forgelink_start_local_only(
    app: tauri::AppHandle,
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, manager, protected, payload);
        return Err("Mobile does not own the desktop local service. Pair or configure an authenticated operator node instead.".to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let config = local_service_config_from_payload(&manager.config(), &payload, true)?;
        save_local_service_config(&app, &config)?;
        manager.update_config(config)?;
        protected.start_local_only()?;
        manager
            .start()
            .map(|_| local_service_status(&manager, &protected))
    }
}

#[tauri::command]
fn forgelink_start_service(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    manager
        .start()
        .map(|_| local_service_status(&manager, &protected))
}

#[tauri::command]
fn forgelink_start_server(
    app: tauri::AppHandle,
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    let validation = protected.validate_twilio(&payload)?;
    protected.save_twilio(&payload)?;
    protected.select_sms_provider("twilio")?;
    let config = local_service_config_from_payload(&manager.config(), &payload, true)?;
    save_local_service_config(&app, &config)?;
    manager.update_config(config)?;
    manager.start()?;
    let mut status = local_service_status(&manager, &protected);
    status["validation"] = validation;
    Ok(status)
}

#[tauri::command]
fn forgelink_stop_server(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Value {
    let _ = manager.stop();
    local_service_status(&manager, &protected)
}

#[tauri::command]
fn forgelink_validate_settings(
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    protected.validate_twilio(&payload)
}

#[tauri::command]
fn forgelink_import_environment(
    app: tauri::AppHandle,
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    protected.import_environment()?;
    let config = local_service_config_from_payload(&manager.config(), &json!({}), true)?;
    save_local_service_config(&app, &config)?;
    manager.update_config(config)?;
    manager.start()?;
    Ok(local_service_status(&manager, &protected))
}

#[tauri::command]
fn forgelink_remove_credentials(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    protected.remove_twilio()?;
    manager.start()?;
    Ok(local_service_status(&manager, &protected))
}

#[tauri::command]
fn forgelink_sms_provider_settings(
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Value {
    protected.telnyx_status()
}

#[tauri::command]
fn forgelink_validate_telnyx_settings(
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    protected.validate_telnyx(&payload)
}

#[tauri::command]
fn forgelink_save_telnyx_settings(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    let validation = protected.validate_telnyx(&payload)?;
    protected.save_telnyx(&payload)?;
    protected.select_sms_provider("telnyx")?;
    manager.start()?;
    let mut result = protected.telnyx_status();
    result["validation"] = validation;
    Ok(result)
}

#[tauri::command]
fn forgelink_select_sms_provider(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    provider: String,
) -> Result<Value, String> {
    let result = protected.select_sms_provider(&provider)?;
    manager.start()?;
    Ok(result)
}

#[tauri::command]
fn forgelink_remove_telnyx_settings(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let result = protected.remove_telnyx()?;
    manager.start()?;
    Ok(result)
}

#[tauri::command]
fn forgelink_notify(
    app: tauri::AppHandle,
    coordinator: State<'_, notifications::NotificationCoordinator>,
    title: String,
    body: String,
) -> Value {
    notifications::deliver(
        &app,
        &coordinator,
        json!({
            "kind": "system",
            "category": "info",
            "title": title,
            "body": body
        }),
    )
}

#[tauri::command]
fn forgelink_notify_event(
    app: tauri::AppHandle,
    coordinator: State<'_, notifications::NotificationCoordinator>,
    payload: Value,
) -> Value {
    notifications::deliver(&app, &coordinator, payload)
}

#[tauri::command]
fn forgelink_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    desktop_integration::open_external(&app, &url)
}

#[tauri::command]
fn forgelink_take_navigation_intent(
    coordinator: State<'_, navigation::NavigationCoordinator>,
) -> Option<navigation::NavigationIntent> {
    coordinator.take_pending()
}

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
fn forgelink_mcp_status(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Value {
    let connection = manager.backend_connection();
    protected.mcp_status(&connection.base_url, &connection.api_token)
}

#[tauri::command]
fn forgelink_create_mcp_token(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.create_mcp_token(&connection.base_url, &connection.api_token)
}

#[tauri::command]
fn forgelink_revoke_mcp_token(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.revoke_mcp_token(&connection.base_url, &connection.api_token)
}

#[tauri::command]
fn forgelink_test_mcp_bridge(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.test_mcp_bridge(&connection.base_url, &connection.api_token)
}

#[tauri::command]
fn forgelink_agent_channels(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.agent_channels(&connection.base_url, &connection.api_token)
}

#[tauri::command]
fn forgelink_create_agent_channel(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.create_agent_channel(&connection.base_url, &connection.api_token, &payload)
}

#[tauri::command]
fn forgelink_rotate_agent_channel(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    channel_id: String,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.rotate_agent_channel(&connection.base_url, &connection.api_token, &channel_id)
}

#[tauri::command]
fn forgelink_revoke_agent_channel(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    channel_id: String,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.revoke_agent_channel(&connection.base_url, &connection.api_token, &channel_id)
}

#[tauri::command]
fn forgelink_set_agent_channel_enabled(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    channel_id: String,
    enabled: bool,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.set_agent_channel_enabled(
        &connection.base_url,
        &connection.api_token,
        &channel_id,
        enabled,
    )
}

#[tauri::command]
fn forgelink_local_integrations(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.local_integrations(&connection.base_url, &connection.api_token)
}

#[tauri::command]
fn forgelink_create_local_integration(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.create_local_integration(&connection.base_url, &connection.api_token, &payload)
}

#[tauri::command]
fn forgelink_update_local_integration(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    integration_id: String,
    payload: Value,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.update_local_integration(
        &connection.base_url,
        &connection.api_token,
        &integration_id,
        &payload,
    )
}

#[tauri::command]
fn forgelink_rotate_local_integration(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    integration_id: String,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.rotate_local_integration(&connection.base_url, &connection.api_token, &integration_id)
}

#[tauri::command]
fn forgelink_revoke_local_integration(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    integration_id: String,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.revoke_local_integration(&connection.base_url, &connection.api_token, &integration_id)
}

#[tauri::command]
fn forgelink_set_local_integration_enabled(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    integration_id: String,
    enabled: bool,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.set_local_integration_enabled(
        &connection.base_url,
        &connection.api_token,
        &integration_id,
        enabled,
    )
}

#[tauri::command]
fn forgelink_test_local_integration(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    integration_id: String,
) -> Result<Value, String> {
    let connection = manager.backend_connection();
    protected.test_local_integration(&connection.base_url, &connection.api_token, &integration_id)
}

#[tauri::command]
fn forgelink_email_settings(
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Value {
    protected.email_status()
}

#[tauri::command]
fn forgelink_save_email_settings(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    let result = protected.save_email(&payload)?;
    manager.start()?;
    Ok(result)
}

#[tauri::command]
fn forgelink_remove_email_settings(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let result = protected.remove_email()?;
    manager.start()?;
    Ok(result)
}

#[tauri::command]
fn forgelink_push_settings(
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Value {
    protected.push_status()
}

#[tauri::command]
fn forgelink_save_push_settings(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
    payload: Value,
) -> Result<Value, String> {
    let result = protected.save_push(&payload)?;
    manager.start()?;
    Ok(result)
}

#[tauri::command]
fn forgelink_remove_push_settings(
    manager: State<'_, local_service::LocalServiceManager>,
    protected: State<'_, protected_settings::ProtectedSettingsService>,
) -> Result<Value, String> {
    let result = protected.remove_push()?;
    manager.start()?;
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Err(error) = desktop_integration::activate_main_window(app) {
                eprintln!("ForgeLink could not activate its existing window: {error}");
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .setup(|app| {
            let navigation = navigation::NavigationCoordinator::default();
            app.manage(navigation.clone());
            app.manage(notifications::NotificationCoordinator::default());

            #[cfg(mobile)]
            {
                use tauri_plugin_notification::{Action, ActionType, NotificationExt};
                let action = Action::builder("open", "Open ForgeLink")
                    .foreground(true)
                    .requires_authentication(false)
                    .build();
                let action_type = ActionType::builder("forgelink-navigation")
                    .actions(vec![action])
                    .build();
                if let Err(error) = app.notification().register_action_types(vec![action_type]) {
                    eprintln!(
                        "ForgeLink could not register its mobile notification action: {error}"
                    );
                }
            }

            use tauri_plugin_deep_link::DeepLinkExt;
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    navigation.route(
                        app.handle(),
                        url.as_str(),
                        navigation::NavigationSource::Startup,
                    );
                }
            }
            let navigation_for_callback = navigation.clone();
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    navigation_for_callback.route(
                        &app_handle,
                        url.as_str(),
                        navigation::NavigationSource::DeepLink,
                    );
                }
                if let Err(error) = desktop_integration::activate_main_window(&app_handle) {
                    eprintln!("ForgeLink could not activate its deep-link window: {error}");
                }
            });

            use tauri::Listener;
            let navigation_for_notification = navigation.clone();
            let app_handle_for_notification = app.handle().clone();
            app.listen("plugin:notification|actionPerformed", move |event| {
                let payload =
                    serde_json::from_str::<Value>(event.payload()).unwrap_or_else(|_| json!({}));
                let target = payload.get("extra").unwrap_or(&payload);
                if let Some(intent) = navigation::intent_from_notification(target) {
                    navigation_for_notification.publish(&app_handle_for_notification, intent);
                    if let Err(error) =
                        desktop_integration::activate_main_window(&app_handle_for_notification)
                    {
                        eprintln!("ForgeLink could not activate its notification window: {error}");
                    }
                }
            });

            #[cfg(all(debug_assertions, windows))]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("ForgeLink could not register its development deep link: {error}");
            }

            let config = load_local_service_config(app.handle());
            let runtime = local_service::resolve_backend_runtime(app.path().resource_dir().ok());
            let legacy_roots = app
                .path()
                .app_data_dir()
                .ok()
                .into_iter()
                .collect::<Vec<_>>();
            let protected =
                protected_settings::ProtectedSettingsService::new(local_data_dir(), legacy_roots)
                    .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            let manager = local_service::LocalServiceManager::new_with_protected(
                runtime,
                config.clone(),
                local_data_dir(),
                None,
                protected.clone(),
            );
            app.manage(protected);
            app.manage(manager);
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if config.onboarding_complete {
                if let Err(error) = app.state::<local_service::LocalServiceManager>().start() {
                    eprintln!("ForgeLink local service did not start: {error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            forgelink_backend_connection,
            forgelink_create_linked_node_identity,
            forgelink_rotate_linked_node_identity,
            forgelink_recover_linked_node_identity,
            forgelink_desktop_linked_node_status,
            forgelink_get_status,
            forgelink_start_local_only,
            forgelink_start_service,
            forgelink_start_server,
            forgelink_stop_server,
            forgelink_validate_settings,
            forgelink_import_environment,
            forgelink_remove_credentials,
            forgelink_sms_provider_settings,
            forgelink_validate_telnyx_settings,
            forgelink_save_telnyx_settings,
            forgelink_select_sms_provider,
            forgelink_remove_telnyx_settings,
            forgelink_notify,
            forgelink_notify_event,
            forgelink_open_external,
            forgelink_take_navigation_intent,
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
            forgelink_local_integrations,
            forgelink_create_local_integration,
            forgelink_update_local_integration,
            forgelink_rotate_local_integration,
            forgelink_revoke_local_integration,
            forgelink_set_local_integration_enabled,
            forgelink_test_local_integration,
            forgelink_email_settings,
            forgelink_save_email_settings,
            forgelink_remove_email_settings,
            forgelink_push_settings,
            forgelink_save_push_settings,
            forgelink_remove_push_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while building ForgeLink Tauri shell")
        .run(|app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                app_handle
                    .state::<local_service::LocalServiceManager>()
                    .shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "forgelink-tauri-mobile-runtime-{}-{}",
            name,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
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
        assert_eq!(status["sync_health"]["clustering_enabled"], json!(false));

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
    fn notification_and_attention_defaults_return_renderer_safe_shapes() {
        let decision = notifications::evaluate_attention(
            &default_attention_policy(),
            &json!({ "kind": "system", "title": "test" }),
        );
        assert_eq!(decision["notify"], json!(true));
        assert_eq!(decision["reason"], json!("allowed"));

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
}
