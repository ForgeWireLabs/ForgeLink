use chrono::{Local, Timelike};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tauri_plugin_notification::{NotificationExt, PermissionState};

const DEFAULT_MODE: &str = "available";

#[derive(Default)]
pub struct NotificationCoordinator {
    permission_requested: Mutex<bool>,
}

impl NotificationCoordinator {
    fn mark_permission_requested(&self) -> bool {
        let Ok(mut requested) = self.permission_requested.lock() else {
            return false;
        };
        if *requested {
            return false;
        }
        *requested = true;
        true
    }
}

fn string_value(value: &Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn bool_value(value: &Value, key: &str, fallback: bool) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn urgency_rank(value: &str) -> u8 {
    match value {
        "low" => 0,
        "normal" => 1,
        "high" => 2,
        "urgent" => 3,
        _ => 1,
    }
}

fn emergency(event: &Value) -> bool {
    event
        .get("emergency")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || string_value(event, "required_authority", "") == "emergency"
        || matches!(
            string_value(event, "risk", "").as_str(),
            "emergency" | "critical"
        )
}

fn minutes(value: &str) -> u32 {
    let mut parts = value.split(':');
    let Some(hours) = parts.next().and_then(|part| part.parse::<u32>().ok()) else {
        return 0;
    };
    let Some(minutes) = parts.next().and_then(|part| part.parse::<u32>().ok()) else {
        return 0;
    };
    hours.min(23) * 60 + minutes.min(59)
}

fn in_quiet_hours(policy: &Value, current: u32) -> bool {
    if !bool_value(policy, "quiet_hours_enabled", false) {
        return false;
    }
    let start = minutes(&string_value(policy, "quiet_hours_start", "22:00"));
    let end = minutes(&string_value(policy, "quiet_hours_end", "07:00"));
    if start == end {
        return true;
    }
    if start < end {
        current >= start && current < end
    } else {
        current >= start || current < end
    }
}

fn scrub(value: &str) -> String {
    static ACCOUNT: OnceLock<Regex> = OnceLock::new();
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    static PHONE: OnceLock<Regex> = OnceLock::new();
    static URL: OnceLock<Regex> = OnceLock::new();
    let value = ACCOUNT
        .get_or_init(|| Regex::new(r"\bAC[a-fA-F0-9]{32}\b").expect("valid account regex"))
        .replace_all(value, "[redacted]");
    let value = TOKEN
        .get_or_init(|| {
            Regex::new(r"\bfl(?:mcp|chan)_[A-Za-z0-9_-]+\b").expect("valid token regex")
        })
        .replace_all(&value, "[redacted]");
    let value = PHONE
        .get_or_init(|| Regex::new(r"\+?\d[\d\s().-]{7,}\d").expect("valid phone regex"))
        .replace_all(&value, "[redacted]");
    let value = URL
        .get_or_init(|| Regex::new(r"https?://\S+").expect("valid URL regex"))
        .replace_all(&value, "[link]");
    value.chars().take(180).collect()
}

fn redacted_title(event: &Value, kind: &str, urgency: &str) -> String {
    match kind {
        "sms" => "New message".to_string(),
        "agent" if matches!(urgency, "urgent" | "high") => "Important agent update".to_string(),
        "agent" => "Agent channel update".to_string(),
        "signal" => "Signal update".to_string(),
        _ => scrub(&string_value(event, "title", "ForgeLink")),
    }
}

fn redacted_body(event: &Value, kind: &str) -> String {
    match kind {
        "sms" => "A conversation has a new message.".to_string(),
        "agent" => event
            .get("source")
            .and_then(Value::as_str)
            .map(|source| format!("From {}.", scrub(source)))
            .unwrap_or_else(|| "A local agent needs attention.".to_string()),
        "signal" => event
            .get("source_title")
            .and_then(Value::as_str)
            .map(|source| format!("From {}.", scrub(source)))
            .unwrap_or_else(|| "A trusted signal has an update.".to_string()),
        _ if string_value(event, "category", "info") == "failure" => {
            "A local action needs attention.".to_string()
        }
        _ => "ForgeLink has an update.".to_string(),
    }
}

fn source_muted(policy: &Value, event: &Value) -> bool {
    let muted = policy
        .get("muted_sources")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    ["source", "channel_id", "source_title", "thread_id"]
        .iter()
        .filter_map(|key| event.get(*key).and_then(Value::as_str))
        .any(|value| muted.contains(&value))
}

fn kind_allowed(policy: &Value, event: &Value, kind: &str, urgency: &str) -> bool {
    match kind {
        "sms" => string_value(policy, "sms_notifications", "all") == "all",
        "agent" => match string_value(policy, "agent_notifications", "high_and_urgent").as_str() {
            "off" => false,
            "all" => true,
            "urgent_only" => urgency == "urgent",
            _ => urgency_rank(urgency) >= urgency_rank("high"),
        },
        "signal" => string_value(policy, "signal_notifications", "off") == "all",
        _ => match string_value(policy, "system_notifications", "all").as_str() {
            "off" => false,
            "failures_only" => string_value(event, "category", "info") == "failure",
            _ => true,
        },
    }
}

fn mode_reason(mode: &str, event: &Value, urgency: &str) -> Option<&'static str> {
    let is_emergency = emergency(event);
    let allowed = match mode {
        "available" => true,
        "offline" | "emergency_only" => is_emergency,
        "sleeping" | "driving" => urgency_rank(urgency) >= urgency_rank("urgent") || is_emergency,
        "focus" | "family" | "work" => {
            urgency_rank(urgency) >= urgency_rank("high") || is_emergency
        }
        _ => true,
    };
    if allowed {
        return None;
    }
    Some(match mode {
        "offline" => "operator_offline",
        "emergency_only" => "emergency_only",
        "sleeping" => "sleeping_mode",
        "driving" => "driving_mode",
        "focus" => "focus_mode",
        "family" => "family_mode",
        "work" => "work_mode",
        _ => "operator_mode",
    })
}

fn escalation(mode: &str, event: &Value, emergency_bypass: bool) -> &'static str {
    if emergency(event) {
        return if emergency_bypass {
            "emergency_bypass_enabled"
        } else {
            "operator_only"
        };
    }
    if matches!(mode, "focus" | "sleeping" | "driving") {
        return "defer_or_batch";
    }
    if mode == "offline" {
        return "record_only";
    }
    "standard"
}

fn batching(mode: &str, event: &Value, urgency: &str) -> &'static str {
    if event
        .get("emergency")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || string_value(event, "required_authority", "") == "emergency"
        || urgency == "urgent"
    {
        return "send_now";
    }
    if matches!(
        mode,
        "focus" | "sleeping" | "driving" | "family" | "work" | "offline"
    ) {
        return "batch_or_defer";
    }
    "standard"
}

pub fn evaluate_attention(policy_value: &Value, event_value: &Value) -> Value {
    let now = Local::now();
    evaluate_attention_at(policy_value, event_value, now.hour() * 60 + now.minute())
}

fn evaluate_attention_at(policy_value: &Value, event_value: &Value, current_minutes: u32) -> Value {
    let defaults = crate::default_attention_policy();
    let mut policy = defaults;
    if let (Some(target), Some(source)) = (policy.as_object_mut(), policy_value.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    let mode = match string_value(&policy, "operator_mode", DEFAULT_MODE).as_str() {
        "available" | "focus" | "driving" | "sleeping" | "family" | "work" | "emergency_only"
        | "offline" => string_value(&policy, "operator_mode", DEFAULT_MODE),
        _ => DEFAULT_MODE.to_string(),
    };
    let kind = string_value(event_value, "kind", "system");
    let urgency = string_value(event_value, "urgency", "normal");
    let emergency_claim = emergency(event_value);
    let mut event = json!({ "kind": kind, "urgency": urgency, "category": string_value(event_value, "category", "info") });
    if let (Some(target), Some(source)) = (event.as_object_mut(), event_value.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }

    if !bool_value(&policy, "enabled", true) {
        return json!({ "notify": false, "reason": "disabled" });
    }
    if source_muted(&policy, &event) {
        return json!({ "notify": false, "reason": "muted_source" });
    }
    if kind == "agent"
        && event
            .get("emergency")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        && bool_value(&policy, "emergency_agent_requires_policy", true)
        && string_value(&event, "required_authority", "") != "emergency"
        && !matches!(
            string_value(&event, "risk", "").as_str(),
            "emergency" | "critical"
        )
    {
        return json!({ "notify": false, "reason": "emergency_policy_required" });
    }
    let emergency_bypass = bool_value(&policy, "emergency_contact_bypass", true);
    if let Some(reason) = mode_reason(&mode, &event, &urgency) {
        return json!({
            "notify": false,
            "reason": reason,
            "operator_mode": mode,
            "escalation": escalation(&mode, &event, emergency_bypass),
            "batching": batching(&mode, &event, &urgency)
        });
    }
    if bool_value(&policy, "presence_enabled", true)
        && bool_value(&policy, "presence_do_not_disturb", false)
        && urgency_rank(&urgency) < urgency_rank("urgent")
        && !emergency_claim
    {
        return json!({
            "notify": false,
            "reason": "presence_do_not_disturb",
            "operator_mode": mode,
            "escalation": escalation(&mode, &event, emergency_bypass),
            "batching": batching(&mode, &event, &urgency)
        });
    }
    if bool_value(&policy, "presence_enabled", true)
        && string_value(&policy, "presence_app_focus", "unknown") == "unfocused"
        && kind == "signal"
    {
        return json!({
            "notify": false,
            "reason": "presence_unfocused_signal",
            "operator_mode": mode,
            "escalation": escalation(&mode, &event, emergency_bypass),
            "batching": batching(&mode, &event, &urgency)
        });
    }
    let urgent = urgency == "urgent";
    if in_quiet_hours(&policy, current_minutes)
        && !(urgent && bool_value(&policy, "quiet_hours_allow_urgent", false))
        && !emergency_claim
    {
        return json!({
            "notify": false,
            "reason": "quiet_hours",
            "operator_mode": mode,
            "escalation": escalation(&mode, &event, emergency_bypass),
            "batching": batching(&mode, &event, &urgency)
        });
    }
    if !kind_allowed(&policy, &event, &kind, &urgency) {
        return json!({ "notify": false, "reason": "kind_policy" });
    }

    let should_redact =
        bool_value(&policy, "redact_notification_bodies", true) || mode != DEFAULT_MODE;
    let title = if should_redact {
        redacted_title(&event, &kind, &urgency)
    } else {
        scrub(&string_value(
            &event,
            "title",
            &redacted_title(&event, &kind, &urgency),
        ))
    };
    let body = if should_redact {
        redacted_body(&event, &kind)
    } else {
        scrub(&string_value(&event, "body", &redacted_body(&event, &kind)))
    };
    json!({
        "notify": true,
        "reason": "allowed",
        "title": title,
        "body": body,
        "operator_mode": mode,
        "escalation": escalation(&mode, &event, emergency_bypass),
        "batching": batching(&mode, &event, &urgency)
    })
}

pub fn deliver(
    app: &tauri::AppHandle,
    coordinator: &NotificationCoordinator,
    event: Value,
) -> Value {
    let policy_dir = crate::mobile_state_dir(app);
    let policy = crate::attention_policy_from_dir(policy_dir.as_deref());
    let mut decision = evaluate_attention(&policy, &event);
    if let Some(intent) = crate::navigation::intent_from_notification(&event) {
        decision["navigation"] = serde_json::to_value(intent).unwrap_or_else(|_| json!(null));
    }
    if decision.get("notify").and_then(Value::as_bool) != Some(true) {
        decision["os_permission"] = json!("not_checked");
        decision["delivery_result"] = json!("suppressed");
        return decision;
    }

    let mut permission_granted = matches!(
        app.notification().permission_state(),
        Ok(PermissionState::Granted)
    );
    let mut permission_label = if permission_granted {
        "granted"
    } else {
        "not_requested"
    };
    if !permission_granted && coordinator.mark_permission_requested() {
        permission_granted = matches!(
            app.notification().request_permission(),
            Ok(PermissionState::Granted)
        );
        permission_label = if permission_granted {
            "granted"
        } else {
            "denied"
        };
    }
    decision["os_permission"] = json!(permission_label);
    if !permission_granted {
        decision["delivery_result"] = json!("permission_denied");
        return decision;
    }

    let title = decision
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("ForgeLink");
    let body = decision
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("ForgeLink has an update.");
    let mut builder = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .auto_cancel();
    #[cfg(mobile)]
    {
        builder = builder.action_type_id("forgelink-navigation");
    }
    if let Some(intent) = decision.get("navigation") {
        builder = builder.extra("navigation", intent.clone());
    }
    if builder.show().is_err() {
        decision["delivery_result"] = json!("failed");
        decision["reason"] = json!("native_delivery_failed");
    } else {
        decision["delivery_result"] = json!("delivered");
    }
    decision
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirrors_attention_policy_redaction_and_gating() {
        let policy = crate::default_attention_policy();
        let decision = evaluate_attention_at(
            &policy,
            &json!({
                "kind": "sms",
                "title": "New SMS",
                "body": "Call +1 (555) 123-4567 https://private.example/secret"
            }),
            12 * 60,
        );
        assert_eq!(decision["notify"], json!(true));
        assert_eq!(decision["title"], json!("New message"));
        assert_eq!(decision["body"], json!("A conversation has a new message."));

        let mut quiet_policy = policy;
        quiet_policy["quiet_hours_enabled"] = json!(true);
        quiet_policy["quiet_hours_start"] = json!("22:00");
        quiet_policy["quiet_hours_end"] = json!("07:00");
        let quiet = evaluate_attention_at(&quiet_policy, &json!({ "kind": "system" }), 23 * 60);
        assert_eq!(quiet["reason"], json!("quiet_hours"));
    }

    #[test]
    fn emergency_agent_requires_a_real_emergency_claim() {
        let policy = crate::default_attention_policy();
        let decision = evaluate_attention_at(
            &policy,
            &json!({ "kind": "agent", "emergency": true, "required_authority": "normal" }),
            12 * 60,
        );
        assert_eq!(decision["reason"], json!("emergency_policy_required"));
    }
}
