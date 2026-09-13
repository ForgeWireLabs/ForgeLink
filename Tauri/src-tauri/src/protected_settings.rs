//! Tauri's single protected-settings boundary.
//!
//! Provider metadata is persisted separately from secret material.  Secret
//! material is encrypted by `secure_store` with an OS-keyring wrapping key and
//! a per-record AES-GCM nonce/AAD.  The only plaintext hand-off is the
//! short-lived environment of the child backend process.  Renderer commands
//! return presence and redacted metadata only.

use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::secure_store::{
    ensure_private_directory, move_file, EncryptedFileSecretStore, OsWrappingKeyProvider,
    SecureStoreError, PROTECTED_SETTINGS_MAGIC,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use reqwest::blocking::Client;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use sha2::Digest;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use zeroize::Zeroizing;

const SETTINGS_VERSION: u32 = 1;
const METADATA_FILE: &str = "protected-settings.json";
const PROTECTED_VAULT_DIR: &str = "protected-vault";
const KEYRING_SERVICE: &str = "com.forgewirelabs.forgelink.protected-settings";
const KEYRING_ACCOUNT: &str = "protected-settings-wrapping-key-v1";

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct SecretRef {
    reference: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct TwilioMetadata {
    account_sid: String,
    twilio_number: String,
    public_base_url: String,
    webhook_host: String,
    webhook_port: u16,
    auth_token: SecretRef,
    source: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct TelnyxMetadata {
    phone_number: String,
    public_key: SecretRef,
    messaging_profile_id: String,
    api_key: SecretRef,
    source: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct FaxMetadata {
    connection_id: String,
    phone_number: String,
    public_key: SecretRef,
    api_key: SecretRef,
    source: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct EmailMetadata {
    host: String,
    port: u16,
    secure: bool,
    user: String,
    from: String,
    pass: SecretRef,
    inbound_secret: SecretRef,
    action_secret: SecretRef,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct PushMetadata {
    provider: String,
    url: String,
    profile: String,
    topic: SecretRef,
    token: SecretRef,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct TokenMetadata {
    token: SecretRef,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct ChannelMetadata {
    label: String,
    token: SecretRef,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
struct LocalIntegrationMetadata {
    label: String,
    scopes: Vec<String>,
    token: SecretRef,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct ProtectedMetadata {
    version: u32,
    twilio: TwilioMetadata,
    preferred_sms_provider: String,
    telnyx: TelnyxMetadata,
    fax: FaxMetadata,
    email: EmailMetadata,
    push: PushMetadata,
    mcp: TokenMetadata,
    agent_channels: BTreeMap<String, ChannelMetadata>,
    local_integrations: BTreeMap<String, LocalIntegrationMetadata>,
}

impl Default for ProtectedMetadata {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            twilio: TwilioMetadata {
                webhook_host: "127.0.0.1".to_string(),
                webhook_port: 5055,
                ..Default::default()
            },
            preferred_sms_provider: "none".to_string(),
            telnyx: TelnyxMetadata::default(),
            fax: FaxMetadata::default(),
            email: EmailMetadata {
                port: 465,
                secure: true,
                ..Default::default()
            },
            push: PushMetadata {
                provider: "ntfy".to_string(),
                url: "https://ntfy.sh".to_string(),
                profile: "lock_screen_safe".to_string(),
                ..Default::default()
            },
            mcp: TokenMetadata::default(),
            agent_channels: BTreeMap::new(),
            local_integrations: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Default)]
struct MigrationState {
    required: bool,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct DesktopProtectedState {
    data_dir: PathBuf,
    metadata: ProtectedMetadata,
    store: EncryptedFileSecretStore<OsWrappingKeyProvider>,
    metadata_corrupt: bool,
    migration: MigrationState,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
struct DesktopProtectedState;

#[derive(Clone)]
pub struct ProtectedSettingsService {
    inner: Arc<Mutex<DesktopProtectedState>>,
}

fn now_suffix() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn bounded_error() -> String {
    "ForgeLink protected settings are unavailable. Check the operating-system credential store and retry.".to_string()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn store_error(error: SecureStoreError) -> String {
    match error {
        SecureStoreError::InvalidReference => {
            "ForgeLink protected setting reference is invalid.".to_string()
        }
        SecureStoreError::AlreadyExists => {
            "ForgeLink protected setting rotation conflicted; retry.".to_string()
        }
        SecureStoreError::Corrupt => {
            "ForgeLink protected setting could not be authenticated.".to_string()
        }
        SecureStoreError::Unavailable => bounded_error(),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn env_or_default(value: &str, key: &str, default: &str) -> String {
    if value.trim().is_empty() {
        std::env::var(key).unwrap_or_else(|_| default.to_string())
    } else {
        value.to_string()
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn env_u16_or_default(value: u16, key: &str) -> u16 {
    std::env::var(key)
        .ok()
        .and_then(|candidate| candidate.parse::<u16>().ok())
        .unwrap_or(value)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn env_bool_or_default(value: bool, key: &str) -> bool {
    match std::env::var(key).ok().as_deref() {
        Some("0") | Some("false") | Some("FALSE") => false,
        Some("1") | Some("true") | Some("TRUE") => true,
        _ => value,
    }
}

fn valid_id(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
}

fn normalize_phone(value: &str) -> Result<String, String> {
    let raw = value.trim();
    if raw.starts_with('+')
        && raw.len() >= 9
        && raw.len() <= 16
        && raw[1..].bytes().all(|byte| byte.is_ascii_digit())
    {
        return Ok(raw.to_string());
    }
    let digits = raw
        .chars()
        .filter(|value| value.is_ascii_digit())
        .collect::<String>();
    if digits.len() == 10 {
        return Ok(format!("+1{digits}"));
    }
    if digits.len() == 11 && digits.starts_with('1') {
        return Ok(format!("+{digits}"));
    }
    Err("Enter the phone number in E.164 format, such as +15551234567.".to_string())
}

fn valid_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

fn read_value(path: &Path) -> Result<Option<Value>, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map(Some)
            .map_err(|_| "ForgeLink protected settings metadata is corrupt.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("ForgeLink protected settings metadata could not be read.".to_string()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn write_metadata(path: &Path, metadata: &ProtectedMetadata) -> Result<(), String> {
    let parent = path.parent().ok_or_else(bounded_error)?;
    ensure_private_directory(parent).map_err(store_error)?;
    let contents = serde_json::to_vec_pretty(metadata)
        .map_err(|_| "ForgeLink protected settings metadata could not be encoded.".to_string())?;
    let temporary = parent.join(format!(".{METADATA_FILE}.{}.tmp", now_suffix()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| bounded_error())?;
    if file
        .write_all(&contents)
        .and_then(|_| file.sync_all())
        .is_err()
    {
        drop(file);
        let _ = std::fs::remove_file(&temporary);
        return Err(bounded_error());
    }
    drop(file);
    if move_file(&temporary, path, true).is_err() {
        let _ = std::fs::remove_file(&temporary);
        return Err(bounded_error());
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn legacy_candidates(explicit: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots = explicit.to_vec();
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let base = PathBuf::from(app_data);
        roots.push(base.join("ForgeLink"));
        roots.push(base.join("forgelink"));
    }
    let names = [
        "settings.json",
        "email-settings.json",
        "push-settings.json",
        "sms-provider-settings.json",
        "telnyx-fax-settings.json",
    ];
    roots
        .into_iter()
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .filter(|path| path.is_file())
        .collect()
}

impl ProtectedSettingsService {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn new(data_dir: PathBuf, legacy_roots: Vec<PathBuf>) -> Result<Self, String> {
        if !data_dir.is_absolute() {
            return Err(
                "ForgeLink protected settings require an absolute local data directory."
                    .to_string(),
            );
        }
        ensure_private_directory(&data_dir.join(PROTECTED_VAULT_DIR)).map_err(store_error)?;
        let metadata_path = data_dir.join(METADATA_FILE);
        let (metadata, metadata_corrupt) = match read_value(&metadata_path)? {
            None => (ProtectedMetadata::default(), false),
            Some(value) => match serde_json::from_value::<ProtectedMetadata>(value) {
                Ok(value) if value.version == SETTINGS_VERSION => (value, false),
                Ok(_) | Err(_) => (ProtectedMetadata::default(), true),
            },
        };
        let store = EncryptedFileSecretStore::with_magic(
            data_dir.join(PROTECTED_VAULT_DIR),
            OsWrappingKeyProvider::new(KEYRING_SERVICE, KEYRING_ACCOUNT),
            PROTECTED_SETTINGS_MAGIC,
        )
        .map_err(store_error)?;
        let migration_required = !legacy_candidates(&legacy_roots).is_empty();
        Ok(Self {
            inner: Arc::new(Mutex::new(DesktopProtectedState {
                data_dir,
                metadata,
                store,
                metadata_corrupt,
                migration: MigrationState {
                    required: migration_required,
                },
            })),
        })
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn new(_data_dir: PathBuf, _legacy_roots: Vec<PathBuf>) -> Result<Self, String> {
        Ok(Self {
            inner: Arc::new(Mutex::new(DesktopProtectedState)),
        })
    }

    #[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
    pub fn unavailable() -> Self {
        let path = std::env::temp_dir().join(format!(
            "forgelink-protected-unavailable-{}",
            std::process::id()
        ));
        Self::new(path, Vec::new()).unwrap_or_else(|_| Self {
            inner: Arc::new(Mutex::new(DesktopProtectedState {
                data_dir: PathBuf::new(),
                metadata: ProtectedMetadata::default(),
                store: EncryptedFileSecretStore::with_magic(
                    std::env::temp_dir(),
                    OsWrappingKeyProvider::new(KEYRING_SERVICE, KEYRING_ACCOUNT),
                    PROTECTED_SETTINGS_MAGIC,
                )
                .expect("temporary protected store"),
                metadata_corrupt: true,
                migration: MigrationState::default(),
            })),
        })
    }

    #[cfg(all(test, any(target_os = "android", target_os = "ios")))]
    pub fn unavailable() -> Self {
        Self::new(PathBuf::new(), Vec::new()).expect("mobile protected settings")
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn lock(&self) -> std::sync::MutexGuard<'_, DesktopProtectedState> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn persist(state: &DesktopProtectedState) -> Result<(), String> {
        write_metadata(&state.data_dir.join(METADATA_FILE), &state.metadata)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn persist_metadata(
        state: &DesktopProtectedState,
        metadata: &ProtectedMetadata,
    ) -> Result<(), String> {
        write_metadata(&state.data_dir.join(METADATA_FILE), metadata)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn read_ref(
        state: &DesktopProtectedState,
        reference: &Option<String>,
    ) -> Result<Option<Zeroizing<String>>, String> {
        let Some(reference) = reference else {
            return Ok(None);
        };
        let clear = state
            .store
            .read_secret(reference)
            .map_err(store_error)?
            .ok_or_else(|| "ForgeLink protected setting is missing.".to_string())?;
        String::from_utf8(clear.to_vec())
            .map(|value| Some(Zeroizing::new(value)))
            .map_err(|_| "ForgeLink protected setting is corrupt.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn delete_refs(
        store: &EncryptedFileSecretStore<OsWrappingKeyProvider>,
        references: impl IntoIterator<Item = Option<String>>,
    ) -> Result<(), String> {
        for reference in references.into_iter().flatten() {
            store.delete(&reference).map_err(store_error)?;
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn storage_state(state: &DesktopProtectedState) -> &'static str {
        if state.metadata_corrupt {
            return "metadata_corrupt";
        }
        let mut references = vec![
            state.metadata.twilio.auth_token.reference.as_deref(),
            state.metadata.telnyx.api_key.reference.as_deref(),
            state.metadata.telnyx.public_key.reference.as_deref(),
            state.metadata.fax.api_key.reference.as_deref(),
            state.metadata.fax.public_key.reference.as_deref(),
            state.metadata.email.pass.reference.as_deref(),
            state.metadata.email.inbound_secret.reference.as_deref(),
            state.metadata.email.action_secret.reference.as_deref(),
            state.metadata.push.topic.reference.as_deref(),
            state.metadata.push.token.reference.as_deref(),
            state.metadata.mcp.token.reference.as_deref(),
        ];
        references.extend(
            state
                .metadata
                .agent_channels
                .values()
                .map(|entry| entry.token.reference.as_deref()),
        );
        references.extend(
            state
                .metadata
                .local_integrations
                .values()
                .map(|entry| entry.token.reference.as_deref()),
        );
        for reference in references.into_iter().flatten() {
            match state.store.contains(reference) {
                Ok(true) => {}
                Ok(false) => return "missing",
                Err(SecureStoreError::Corrupt | SecureStoreError::InvalidReference) => {
                    return "corrupt"
                }
                Err(SecureStoreError::Unavailable | SecureStoreError::AlreadyExists) => {
                    return "unavailable"
                }
            }
        }
        "ready"
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn env_or_ref(
        state: &DesktopProtectedState,
        reference: &Option<String>,
        key: &str,
    ) -> Result<String, String> {
        Ok(Self::read_ref(state, reference)?
            .map(|value| value.to_string())
            .or_else(|| std::env::var(key).ok())
            .unwrap_or_default())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn create_secret(
        state: &DesktopProtectedState,
        namespace: &str,
        value: &str,
    ) -> Result<String, String> {
        let reference = format!("forgelink:protected:{namespace}:v{}", now_suffix());
        state
            .store
            .create(&reference, value.as_bytes())
            .map_err(store_error)?;
        Ok(reference)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn replace_secret(
        store: &EncryptedFileSecretStore<OsWrappingKeyProvider>,
        old: &mut SecretRef,
        value: Option<&str>,
        required: bool,
    ) -> Result<Option<String>, String> {
        let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            if required && old.reference.is_none() {
                return Err(bounded_error());
            }
            return Ok(None);
        };
        let next = format!("forgelink:protected:setting:v{}", now_suffix());
        store.create(&next, value.as_bytes()).map_err(store_error)?;
        Ok(old.reference.replace(next))
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn backend_env(&self) -> Result<BTreeMap<String, String>, String> {
        let state = self.lock();
        if state.metadata_corrupt {
            return Err("ForgeLink protected settings metadata is corrupt; re-enter credentials before starting the local service.".to_string());
        }
        let mut env = BTreeMap::new();
        let twilio_auth = Self::env_or_ref(
            &state,
            &state.metadata.twilio.auth_token.reference,
            "TWILIO_AUTH_TOKEN",
        )?;
        let sid = if state.metadata.twilio.account_sid.is_empty() {
            std::env::var("TWILIO_ACCOUNT_SID").unwrap_or_default()
        } else {
            state.metadata.twilio.account_sid.clone()
        };
        let number = if state.metadata.twilio.twilio_number.is_empty() {
            std::env::var("TWILIO_PHONE_NUMBER").unwrap_or_default()
        } else {
            state.metadata.twilio.twilio_number.clone()
        };
        if !sid.is_empty() {
            env.insert("TWILIO_ACCOUNT_SID".to_string(), sid);
        }
        if !twilio_auth.is_empty() {
            env.insert("TWILIO_AUTH_TOKEN".to_string(), twilio_auth);
        }
        if !number.is_empty() {
            env.insert("TWILIO_PHONE_NUMBER".to_string(), number);
        }
        let public_url = if state.metadata.twilio.public_base_url.is_empty() {
            std::env::var("TWILIO_PUBLIC_BASE_URL").unwrap_or_default()
        } else {
            state.metadata.twilio.public_base_url.clone()
        };
        if !public_url.is_empty() {
            env.insert("TWILIO_PUBLIC_BASE_URL".to_string(), public_url);
        }
        let sms_provider = if state.metadata.preferred_sms_provider == "none" {
            std::env::var("FORGELINK_SMS_PROVIDER").unwrap_or_else(|_| "none".to_string())
        } else {
            state.metadata.preferred_sms_provider.clone()
        };
        env.insert("FORGELINK_SMS_PROVIDER".to_string(), sms_provider);

        let telnyx_api = Self::env_or_ref(
            &state,
            &state.metadata.telnyx.api_key.reference,
            "TELNYX_API_KEY",
        )?;
        let telnyx_public = Self::env_or_ref(
            &state,
            &state.metadata.telnyx.public_key.reference,
            "TELNYX_PUBLIC_KEY",
        )?;
        let telnyx_phone = if state.metadata.telnyx.phone_number.is_empty() {
            std::env::var("TELNYX_PHONE_NUMBER").unwrap_or_default()
        } else {
            state.metadata.telnyx.phone_number.clone()
        };
        let telnyx_profile = if state.metadata.telnyx.messaging_profile_id.is_empty() {
            std::env::var("TELNYX_MESSAGING_PROFILE_ID").unwrap_or_default()
        } else {
            state.metadata.telnyx.messaging_profile_id.clone()
        };
        for (key, value) in [
            ("TELNYX_API_KEY", telnyx_api),
            ("TELNYX_PUBLIC_KEY", telnyx_public),
            ("TELNYX_PHONE_NUMBER", telnyx_phone),
            ("TELNYX_MESSAGING_PROFILE_ID", telnyx_profile),
        ] {
            if !value.is_empty() {
                env.insert(key.to_string(), value);
            }
        }

        let fax_api = Self::env_or_ref(
            &state,
            &state.metadata.fax.api_key.reference,
            "TELNYX_FAX_API_KEY",
        )?;
        let fax_public = Self::env_or_ref(
            &state,
            &state.metadata.fax.public_key.reference,
            "TELNYX_FAX_PUBLIC_KEY",
        )?;
        for (key, value) in [
            ("TELNYX_FAX_API_KEY", fax_api),
            ("TELNYX_FAX_PUBLIC_KEY", fax_public),
        ] {
            if !value.is_empty() {
                env.insert(key.to_string(), value);
            }
        }
        for (key, value) in [
            (
                "TELNYX_FAX_CONNECTION_ID",
                env_or_default(
                    &state.metadata.fax.connection_id,
                    "TELNYX_FAX_CONNECTION_ID",
                    "",
                ),
            ),
            (
                "TELNYX_FAX_PHONE_NUMBER",
                env_or_default(
                    &state.metadata.fax.phone_number,
                    "TELNYX_FAX_PHONE_NUMBER",
                    "",
                ),
            ),
        ] {
            if !value.is_empty() {
                env.insert(key.to_string(), value);
            }
        }

        let email = &state.metadata.email;
        let email_pass = Self::env_or_ref(&state, &email.pass.reference, "FORGELINK_SMTP_PASS")?;
        let inbound = Self::env_or_ref(
            &state,
            &email.inbound_secret.reference,
            "FORGELINK_EMAIL_INBOUND_SECRET",
        )?;
        let action = Self::env_or_ref(
            &state,
            &email.action_secret.reference,
            "FORGELINK_EMAIL_ACTION_SECRET",
        )?;
        let email_host = env_or_default(&email.host, "FORGELINK_SMTP_HOST", "");
        let email_port = env_u16_or_default(email.port, "FORGELINK_SMTP_PORT");
        let email_secure = env_bool_or_default(email.secure, "FORGELINK_SMTP_SECURE");
        let email_user = env_or_default(&email.user, "FORGELINK_SMTP_USER", "");
        let email_from = env_or_default(&email.from, "FORGELINK_SMTP_FROM", &email_user);
        for (key, value) in [
            ("FORGELINK_SMTP_HOST", email_host),
            ("FORGELINK_SMTP_PORT", email_port.to_string()),
            (
                "FORGELINK_SMTP_SECURE",
                if email_secure {
                    "1".to_string()
                } else {
                    "0".to_string()
                },
            ),
            ("FORGELINK_SMTP_USER", email_user),
            ("FORGELINK_SMTP_FROM", email_from),
            ("FORGELINK_SMTP_PASS", email_pass),
            ("FORGELINK_EMAIL_INBOUND_SECRET", inbound),
            ("FORGELINK_EMAIL_ACTION_SECRET", action),
        ] {
            if !value.is_empty() {
                env.insert(key.to_string(), value);
            }
        }

        let push = &state.metadata.push;
        let topic = Self::env_or_ref(&state, &push.topic.reference, "FORGELINK_PUSH_TOPIC")?;
        let token = Self::env_or_ref(&state, &push.token.reference, "FORGELINK_PUSH_TOKEN")?;
        let push_provider = env_or_default(&push.provider, "FORGELINK_PUSH_PROVIDER", "ntfy");
        let push_url = env_or_default(&push.url, "FORGELINK_PUSH_URL", "https://ntfy.sh");
        let push_profile =
            env_or_default(&push.profile, "FORGELINK_PUSH_PROFILE", "lock_screen_safe");
        for (key, value) in [
            ("FORGELINK_PUSH_PROVIDER", push_provider),
            ("FORGELINK_PUSH_URL", push_url),
            ("FORGELINK_PUSH_PROFILE", push_profile),
            ("FORGELINK_PUSH_TOPIC", topic),
            ("FORGELINK_PUSH_TOKEN", token),
        ] {
            if !value.is_empty() {
                env.insert(key.to_string(), value);
            }
        }
        Ok(env)
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn backend_env(&self) -> Result<BTreeMap<String, String>, String> {
        Err("Mobile never receives or injects desktop provider secrets.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn public_secret(
        state: &DesktopProtectedState,
        reference: &Option<String>,
        key: &str,
    ) -> String {
        if reference.is_some() {
            Self::read_ref(state, reference)
                .ok()
                .flatten()
                .map(|value| value.to_string())
                .unwrap_or_default()
        } else {
            std::env::var(key).unwrap_or_default()
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn public_status(&self) -> Value {
        let state = self.lock();
        let twilio_auth = Self::public_secret(
            &state,
            &state.metadata.twilio.auth_token.reference,
            "TWILIO_AUTH_TOKEN",
        );
        let telnyx_api = Self::public_secret(
            &state,
            &state.metadata.telnyx.api_key.reference,
            "TELNYX_API_KEY",
        );
        let telnyx_public = Self::public_secret(
            &state,
            &state.metadata.telnyx.public_key.reference,
            "TELNYX_PUBLIC_KEY",
        );
        let email_pass = Self::public_secret(
            &state,
            &state.metadata.email.pass.reference,
            "FORGELINK_SMTP_PASS",
        );
        let push_topic = Self::public_secret(
            &state,
            &state.metadata.push.topic.reference,
            "FORGELINK_PUSH_TOPIC",
        );
        let push_token = Self::public_secret(
            &state,
            &state.metadata.push.token.reference,
            "FORGELINK_PUSH_TOKEN",
        );
        let twilio_sid =
            env_or_default(&state.metadata.twilio.account_sid, "TWILIO_ACCOUNT_SID", "");
        let twilio_number = env_or_default(
            &state.metadata.twilio.twilio_number,
            "TWILIO_PHONE_NUMBER",
            "",
        );
        let telnyx_phone = env_or_default(
            &state.metadata.telnyx.phone_number,
            "TELNYX_PHONE_NUMBER",
            "",
        );
        let telnyx_profile = env_or_default(
            &state.metadata.telnyx.messaging_profile_id,
            "TELNYX_MESSAGING_PROFILE_ID",
            "",
        );
        let email_host = env_or_default(&state.metadata.email.host, "FORGELINK_SMTP_HOST", "");
        let email_port = env_u16_or_default(state.metadata.email.port, "FORGELINK_SMTP_PORT");
        let email_secure =
            env_bool_or_default(state.metadata.email.secure, "FORGELINK_SMTP_SECURE");
        let email_user = env_or_default(&state.metadata.email.user, "FORGELINK_SMTP_USER", "");
        let email_from = env_or_default(
            &state.metadata.email.from,
            "FORGELINK_SMTP_FROM",
            &email_user,
        );
        let push_provider = env_or_default(
            &state.metadata.push.provider,
            "FORGELINK_PUSH_PROVIDER",
            "ntfy",
        );
        let push_url = env_or_default(
            &state.metadata.push.url,
            "FORGELINK_PUSH_URL",
            "https://ntfy.sh",
        );
        let push_profile = env_or_default(
            &state.metadata.push.profile,
            "FORGELINK_PUSH_PROFILE",
            "lock_screen_safe",
        );
        let environment_available = std::env::var("TWILIO_ACCOUNT_SID")
            .ok()
            .is_some_and(|value| !value.is_empty())
            && std::env::var("TWILIO_AUTH_TOKEN")
                .ok()
                .is_some_and(|value| !value.is_empty())
            && std::env::var("TWILIO_PHONE_NUMBER")
                .ok()
                .is_some_and(|value| !value.is_empty());
        let configured =
            !twilio_sid.is_empty() && !twilio_auth.is_empty() && !twilio_number.is_empty();
        let source = if configured && state.metadata.twilio.auth_token.reference.is_some() {
            "stored"
        } else if environment_available {
            "environment"
        } else {
            "none"
        };
        json!({
            "configured": configured || environment_available,
            "credential_source": source,
            "environment_import_available": environment_available,
            "settings": { "account_sid": mask_identifier(&twilio_sid), "auth_token_configured": !twilio_auth.is_empty(), "twilio_number": twilio_number, "public_base_url": env_or_default(&state.metadata.twilio.public_base_url, "TWILIO_PUBLIC_BASE_URL", ""), "webhook_host": state.metadata.twilio.webhook_host, "webhook_port": state.metadata.twilio.webhook_port },
            "sms_provider_settings": { "preferred_provider": state.metadata.preferred_sms_provider, "telnyx": { "configured": !telnyx_api.is_empty() && !telnyx_phone.is_empty(), "inbound_configured": !telnyx_public.is_empty() && !telnyx_profile.is_empty(), "source": if state.metadata.telnyx.api_key.reference.is_some() { "stored" } else if !telnyx_api.is_empty() { "environment" } else { "none" }, "environment_available": std::env::var("TELNYX_API_KEY").is_ok() && std::env::var("TELNYX_PHONE_NUMBER").is_ok(), "phone_number": telnyx_phone, "messaging_profile_id": telnyx_profile, "api_key_present": !telnyx_api.is_empty(), "public_key_present": !telnyx_public.is_empty() } },
            "email_settings": { "configured": !email_host.is_empty() && !email_user.is_empty() && !email_pass.is_empty(), "host": email_host, "port": email_port, "secure": email_secure, "user": email_user, "from": email_from, "password_present": !email_pass.is_empty(), "inbound_secret_present": state.metadata.email.inbound_secret.reference.is_some() || std::env::var("FORGELINK_EMAIL_INBOUND_SECRET").is_ok(), "action_secret_present": state.metadata.email.action_secret.reference.is_some() || std::env::var("FORGELINK_EMAIL_ACTION_SECRET").is_ok() },
            "push_settings": { "configured": !push_url.is_empty() && !push_topic.is_empty(), "provider": push_provider, "url": push_url, "profile": push_profile, "topic_present": !push_topic.is_empty(), "token_present": !push_token.is_empty() },
            "migration": { "strategy": "manual_reentry", "required": state.migration.required, "metadata_corrupt": state.metadata_corrupt },
            "protected_storage": { "format": "FLPSV001", "keyring": "os-keyring", "state": Self::storage_state(&state), "secret_material_in_renderer": false, "mobile_secret_replication": false }
        })
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn public_status(&self) -> Value {
        json!({ "configured": false, "credential_source": "none", "environment_import_available": false, "migration": { "strategy": "manual_reentry", "required": false, "metadata_corrupt": false }, "protected_storage": { "format": "FLPSV001", "keyring": "unavailable_on_mobile", "secret_material_in_renderer": false, "mobile_secret_replication": false } })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn twilio_settings(&self) -> Value {
        let status = self.public_status();
        status["settings"].clone()
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn twilio_settings(&self) -> Value {
        json!({ "account_sid": "", "auth_token_configured": false, "twilio_number": "", "public_base_url": "", "webhook_host": "127.0.0.1", "webhook_port": 5055 })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn start_local_only(&self) -> Result<Value, String> {
        let mut state = self.lock();
        let previous_auth = state.metadata.twilio.auth_token.reference.clone();
        state.metadata.twilio = TwilioMetadata {
            webhook_host: state.metadata.twilio.webhook_host.clone(),
            webhook_port: state.metadata.twilio.webhook_port,
            ..Default::default()
        };
        state.metadata.preferred_sms_provider = "none".to_string();
        Self::persist(&state)?;
        Self::delete_refs(&state.store, [previous_auth])?;
        drop(state);
        Ok(self.public_status())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn start_local_only(&self) -> Result<Value, String> {
        Err("Mobile does not own desktop provider settings.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn twilio_candidate(
        &self,
        payload: &Value,
    ) -> Result<(String, String, String, String, String, u16), String> {
        let state = self.lock();
        let sid_input = payload["account_sid"].as_str().unwrap_or_default().trim();
        let sid = if sid_input.contains('•') || sid_input.is_empty() {
            state.metadata.twilio.account_sid.clone()
        } else {
            sid_input.to_string()
        };
        let auth = payload["auth_token"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
            .or_else(|| {
                Self::read_ref(&state, &state.metadata.twilio.auth_token.reference)
                    .ok()
                    .flatten()
                    .map(|value| value.to_string())
            })
            .or_else(|| std::env::var("TWILIO_AUTH_TOKEN").ok())
            .unwrap_or_default();
        let phone = normalize_phone(
            payload["twilio_number"]
                .as_str()
                .unwrap_or(&state.metadata.twilio.twilio_number),
        )?;
        let public_url = payload["public_base_url"]
            .as_str()
            .unwrap_or(&state.metadata.twilio.public_base_url)
            .trim()
            .trim_end_matches('/')
            .to_string();
        let host = payload["webhook_host"]
            .as_str()
            .unwrap_or(if state.metadata.twilio.webhook_host.is_empty() {
                "127.0.0.1"
            } else {
                &state.metadata.twilio.webhook_host
            })
            .to_string();
        let port = payload["webhook_port"]
            .as_u64()
            .or_else(|| Some(u64::from(state.metadata.twilio.webhook_port)))
            .and_then(|value| u16::try_from(value).ok())
            .ok_or_else(|| "Local service port must be between 1024 and 65535.".to_string())?;
        if !valid_id(&sid, 40)
            || !sid.starts_with("AC")
            || sid.len() != 34
            || !sid[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("Enter a valid Twilio Account SID beginning with AC.".to_string());
        }
        if auth.is_empty() {
            return Err("Enter the Twilio auth token.".to_string());
        }
        if !public_url.is_empty() && !public_url.starts_with("https://") {
            return Err("The public webhook URL must use HTTPS.".to_string());
        }
        if !matches!(host.as_str(), "127.0.0.1" | "localhost") || !(1024..=u16::MAX).contains(&port)
        {
            return Err("Local service settings must remain on loopback with a port between 1024 and 65535.".to_string());
        }
        Ok((sid, auth, phone, public_url, host, port))
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn validate_twilio(&self, payload: &Value) -> Result<Value, String> {
        let (sid, auth, phone, _public_url, _host, _port) = self.twilio_candidate(payload)?;
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|_| "Twilio validation could not start.".to_string())?;
        let account_response = client
            .get(format!(
                "https://api.twilio.com/2010-04-01/Accounts/{sid}.json"
            ))
            .basic_auth(&sid, Some(&auth))
            .send()
            .map_err(|_| "Twilio account validation could not reach Twilio.".to_string())?;
        if !account_response.status().is_success() {
            return Err(if account_response.status().as_u16() == 401 {
                "Twilio rejected the Account SID or auth token.".to_string()
            } else {
                format!(
                    "Twilio account validation failed ({}).",
                    account_response.status().as_u16()
                )
            });
        }
        let account: Value = account_response
            .json()
            .map_err(|_| "Twilio returned an invalid account response.".to_string())?;
        let numbers_response = client.get(format!("https://api.twilio.com/2010-04-01/Accounts/{sid}/IncomingPhoneNumbers.json?PhoneNumber={phone}&PageSize=1")).basic_auth(&sid, Some(&auth)).send().map_err(|_| "Twilio phone-number validation could not reach Twilio.".to_string())?;
        if !numbers_response.status().is_success() {
            return Err(format!(
                "Twilio phone-number validation failed ({}).",
                numbers_response.status().as_u16()
            ));
        }
        let numbers: Value = numbers_response
            .json()
            .map_err(|_| "Twilio returned an invalid phone-number response.".to_string())?;
        if !numbers["incoming_phone_numbers"]
            .as_array()
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item["phone_number"].as_str() == Some(phone.as_str()))
            })
        {
            return Err("That phone number was not found in this Twilio account.".to_string());
        }
        Ok(
            json!({ "account_name": account["friendly_name"].as_str().unwrap_or("Twilio account"), "account_status": account["status"].as_str().unwrap_or("active"), "phone_number": phone }),
        )
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn validate_twilio(&self, _payload: &Value) -> Result<Value, String> {
        Err("Mobile does not validate or store desktop provider credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn save_twilio(&self, payload: &Value) -> Result<(), String> {
        let (sid, _auth, phone, public_url, host, port) = self.twilio_candidate(payload)?;
        let mut state = self.lock();
        state.metadata.twilio.account_sid = sid;
        state.metadata.twilio.twilio_number = phone;
        state.metadata.twilio.public_base_url = public_url;
        state.metadata.twilio.webhook_host = host;
        state.metadata.twilio.webhook_port = port;
        let provided = payload["auth_token"].as_str();
        let mut next = state.metadata.clone();
        let previous =
            Self::replace_secret(&state.store, &mut next.twilio.auth_token, provided, true)?;
        next.twilio.source = "stored".to_string();
        Self::persist_metadata(&state, &next)?;
        state.metadata = next;
        if let Some(previous) = previous {
            let _ = state.store.delete(&previous);
        }
        Ok(())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn save_twilio(&self, _payload: &Value) -> Result<(), String> {
        Err("Mobile does not store desktop provider credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn import_environment(&self) -> Result<(), String> {
        let payload = json!({ "account_sid": std::env::var("TWILIO_ACCOUNT_SID").unwrap_or_default(), "auth_token": std::env::var("TWILIO_AUTH_TOKEN").unwrap_or_default(), "twilio_number": std::env::var("TWILIO_PHONE_NUMBER").unwrap_or_default(), "public_base_url": std::env::var("TWILIO_PUBLIC_BASE_URL").unwrap_or_default(), "webhook_host": std::env::var("TWILIO_PHONE_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()), "webhook_port": std::env::var("TWILIO_PHONE_PORT").ok().and_then(|value| value.parse::<u16>().ok()).unwrap_or(5055) });
        self.validate_twilio(&payload)?;
        self.save_twilio(&payload)
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn import_environment(&self) -> Result<(), String> {
        Err("Mobile does not import desktop provider credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn remove_twilio(&self) -> Result<(), String> {
        self.start_local_only().map(|_| ())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn remove_twilio(&self) -> Result<(), String> {
        Err("Mobile does not remove desktop provider credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn telnyx_status(&self) -> Value {
        self.public_status()["sms_provider_settings"].clone()
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn telnyx_status(&self) -> Value {
        json!({ "preferred_provider": "none", "telnyx": { "configured": false, "inbound_configured": false, "source": "none", "environment_available": false, "phone_number": "", "messaging_profile_id": "", "api_key_present": false, "public_key_present": false } })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn telnyx_candidate(
        &self,
        payload: &Value,
    ) -> Result<(String, String, String, String), String> {
        let state = self.lock();
        let api = payload["api_key"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
            .or_else(|| {
                Self::read_ref(&state, &state.metadata.telnyx.api_key.reference)
                    .ok()
                    .flatten()
                    .map(|value| value.to_string())
            })
            .or_else(|| std::env::var("TELNYX_API_KEY").ok())
            .unwrap_or_default();
        let phone = normalize_phone(
            payload["phone_number"]
                .as_str()
                .unwrap_or(&state.metadata.telnyx.phone_number),
        )?;
        let public = payload["public_key"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
            .or_else(|| {
                Self::read_ref(&state, &state.metadata.telnyx.public_key.reference)
                    .ok()
                    .flatten()
                    .map(|value| value.to_string())
            })
            .or_else(|| std::env::var("TELNYX_PUBLIC_KEY").ok())
            .unwrap_or_default();
        let profile = payload["messaging_profile_id"]
            .as_str()
            .unwrap_or(&state.metadata.telnyx.messaging_profile_id)
            .trim()
            .to_string();
        if api.is_empty() {
            return Err("Telnyx requires an API key.".to_string());
        }
        if !valid_uuid(&profile) {
            return Err("Enter a valid Telnyx messaging profile ID.".to_string());
        }
        let decoded = STANDARD
            .decode(public.as_bytes())
            .map_err(|_| "Enter the 32-byte base64 Telnyx webhook public key.".to_string())?;
        if decoded.len() != 32 {
            return Err("Enter the 32-byte base64 Telnyx webhook public key.".to_string());
        }
        Ok((api, phone, public, profile))
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn validate_telnyx(&self, payload: &Value) -> Result<Value, String> {
        let (api, phone, public, profile) = self.telnyx_candidate(payload)?;
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|_| "Telnyx validation could not start.".to_string())?;
        let number = client
            .get(format!(
                "https://api.telnyx.com/v2/messaging_phone_numbers/{phone}"
            ))
            .bearer_auth(&api)
            .send()
            .map_err(|_| "Telnyx validation could not reach Telnyx.".to_string())?;
        if !number.status().is_success() {
            return Err(format!("Telnyx validation failed ({}). Check the API key, phone number, and messaging profile.", number.status().as_u16()));
        }
        let number_json: Value = number
            .json()
            .map_err(|_| "Telnyx returned an invalid phone-number response.".to_string())?;
        if number_json["data"]["phone_number"].as_str() != Some(phone.as_str()) {
            return Err("Telnyx did not return the selected phone number.".to_string());
        }
        if number_json["data"]["messaging_profile_id"].as_str() != Some(profile.as_str()) {
            return Err(
                "The Telnyx phone number is not assigned to the selected messaging profile."
                    .to_string(),
            );
        }
        let profile_response = client
            .get(format!(
                "https://api.telnyx.com/v2/messaging_profiles/{profile}"
            ))
            .bearer_auth(&api)
            .send()
            .map_err(|_| "Telnyx profile validation could not reach Telnyx.".to_string())?;
        if !profile_response.status().is_success() {
            return Err(format!("Telnyx validation failed ({}). Check the API key, phone number, and messaging profile.", profile_response.status().as_u16()));
        }
        let profile_json: Value = profile_response
            .json()
            .map_err(|_| "Telnyx returned an invalid messaging-profile response.".to_string())?;
        if profile_json["data"]["id"].as_str() != Some(profile.as_str()) {
            return Err("Telnyx did not return the selected messaging profile.".to_string());
        }
        if profile_json["data"]["enabled"] == false {
            return Err("The selected Telnyx messaging profile is disabled.".to_string());
        }
        Ok(
            json!({ "provider": "telnyx", "account_name": profile_json["data"]["name"].as_str().unwrap_or("Telnyx messaging"), "account_status": "active", "phone_number": phone, "messaging_profile_id": profile, "messaging_profile_name": profile_json["data"]["name"].as_str().unwrap_or(""), "webhook_configured": profile_json["data"]["webhook_url"].as_str().is_some_and(|value| !value.is_empty()), "public_key_valid": !public.is_empty() }),
        )
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn validate_telnyx(&self, _payload: &Value) -> Result<Value, String> {
        Err("Mobile does not validate desktop provider credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn save_telnyx(&self, payload: &Value) -> Result<(), String> {
        let (_api, phone, _public, profile) = self.telnyx_candidate(payload)?;
        let mut state = self.lock();
        let mut next = state.metadata.clone();
        next.telnyx.phone_number = phone;
        next.telnyx.messaging_profile_id = profile;
        let old_api = Self::replace_secret(
            &state.store,
            &mut next.telnyx.api_key,
            payload["api_key"].as_str(),
            true,
        )?;
        let old_public = Self::replace_secret(
            &state.store,
            &mut next.telnyx.public_key,
            payload["public_key"].as_str(),
            true,
        )?;
        next.telnyx.source = "stored".to_string();
        if let Some(provider) = payload["preferred_provider"].as_str() {
            next.preferred_sms_provider = provider.to_string();
        }
        Self::persist_metadata(&state, &next)?;
        state.metadata = next;
        if let Some(previous) = old_api {
            let _ = state.store.delete(&previous);
        }
        if let Some(previous) = old_public {
            let _ = state.store.delete(&previous);
        }
        Ok(())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn save_telnyx(&self, _payload: &Value) -> Result<(), String> {
        Err("Mobile does not store desktop provider credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn select_sms_provider(&self, provider: &str) -> Result<Value, String> {
        if !matches!(provider, "none" | "twilio" | "telnyx") {
            return Err("SMS provider selection is invalid.".to_string());
        }
        let mut state = self.lock();
        if provider == "twilio"
            && state.metadata.twilio.auth_token.reference.is_none()
            && std::env::var("TWILIO_AUTH_TOKEN").is_err()
        {
            return Err("Configure Twilio before selecting it.".to_string());
        }
        if provider == "telnyx"
            && state.metadata.telnyx.api_key.reference.is_none()
            && std::env::var("TELNYX_API_KEY").is_err()
        {
            return Err("Configure Telnyx before selecting it.".to_string());
        }
        state.metadata.preferred_sms_provider = provider.to_string();
        Self::persist(&state)?;
        drop(state);
        Ok(self.telnyx_status())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn select_sms_provider(&self, _provider: &str) -> Result<Value, String> {
        Err("Mobile does not select desktop providers.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn remove_telnyx(&self) -> Result<Value, String> {
        let mut state = self.lock();
        let previous_api = state.metadata.telnyx.api_key.reference.clone();
        let previous_public = state.metadata.telnyx.public_key.reference.clone();
        state.metadata.telnyx = TelnyxMetadata::default();
        if state.metadata.preferred_sms_provider == "telnyx" {
            state.metadata.preferred_sms_provider = "none".to_string();
        }
        Self::persist(&state)?;
        Self::delete_refs(&state.store, [previous_api, previous_public])?;
        drop(state);
        Ok(self.telnyx_status())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn remove_telnyx(&self) -> Result<Value, String> {
        Err("Mobile does not remove desktop providers.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn email_status(&self) -> Value {
        self.public_status()["email_settings"].clone()
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn email_status(&self) -> Value {
        json!({ "configured": false, "host": "", "port": 465, "secure": true, "user": "", "from": "", "password_present": false, "inbound_secret_present": false, "action_secret_present": false })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn save_email(&self, payload: &Value) -> Result<Value, String> {
        let mut state = self.lock();
        let mut next = state.metadata.clone();
        let email = &mut next.email;
        email.host = payload["host"]
            .as_str()
            .unwrap_or(&email.host)
            .trim()
            .to_string();
        email.port = payload["port"]
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .unwrap_or(email.port);
        email.secure = payload["secure"].as_bool().unwrap_or(email.secure);
        email.user = payload["user"]
            .as_str()
            .unwrap_or(&email.user)
            .trim()
            .to_string();
        email.from = payload["from"]
            .as_str()
            .unwrap_or(&email.from)
            .trim()
            .to_string();
        if email.from.is_empty() {
            email.from = email.user.clone();
        }
        if email.host.is_empty() || email.user.is_empty() {
            return Err("Email requires an SMTP host and username.".to_string());
        }
        let old_pass = Self::replace_secret(
            &state.store,
            &mut email.pass,
            payload["pass"].as_str(),
            true,
        )?;
        let old_inbound = Self::replace_secret(
            &state.store,
            &mut email.inbound_secret,
            payload["inbound_secret"].as_str(),
            false,
        )?;
        let old_action = Self::replace_secret(
            &state.store,
            &mut email.action_secret,
            payload["action_secret"].as_str(),
            false,
        )?;
        Self::persist_metadata(&state, &next)?;
        state.metadata = next;
        for previous in [old_pass, old_inbound, old_action].into_iter().flatten() {
            let _ = state.store.delete(&previous);
        }
        drop(state);
        Ok(self.email_status())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn save_email(&self, _payload: &Value) -> Result<Value, String> {
        Err("Mobile does not store desktop email credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn remove_email(&self) -> Result<Value, String> {
        let mut state = self.lock();
        let previous_pass = state.metadata.email.pass.reference.clone();
        let previous_inbound = state.metadata.email.inbound_secret.reference.clone();
        let previous_action = state.metadata.email.action_secret.reference.clone();
        state.metadata.email = EmailMetadata {
            port: 465,
            secure: true,
            ..Default::default()
        };
        Self::persist(&state)?;
        Self::delete_refs(
            &state.store,
            [previous_pass, previous_inbound, previous_action],
        )?;
        drop(state);
        Ok(self.email_status())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn remove_email(&self) -> Result<Value, String> {
        Err("Mobile does not remove desktop email credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn push_status(&self) -> Value {
        self.public_status()["push_settings"].clone()
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn push_status(&self) -> Value {
        json!({ "configured": false, "provider": "ntfy", "url": "https://ntfy.sh", "profile": "lock_screen_safe", "topic_present": false, "token_present": false })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn save_push(&self, payload: &Value) -> Result<Value, String> {
        let mut state = self.lock();
        let mut next = state.metadata.clone();
        let push = &mut next.push;
        push.provider = payload["provider"]
            .as_str()
            .unwrap_or(&push.provider)
            .trim()
            .to_string();
        push.url = payload["url"]
            .as_str()
            .unwrap_or(&push.url)
            .trim()
            .trim_end_matches('/')
            .to_string();
        push.profile = payload["profile"]
            .as_str()
            .unwrap_or(&push.profile)
            .to_string();
        if push.url.is_empty() {
            return Err("Push requires a provider URL.".to_string());
        }
        let old_topic = Self::replace_secret(
            &state.store,
            &mut push.topic,
            payload["topic"].as_str(),
            true,
        )?;
        let old_token = Self::replace_secret(
            &state.store,
            &mut push.token,
            payload["token"].as_str(),
            false,
        )?;
        Self::persist_metadata(&state, &next)?;
        state.metadata = next;
        for previous in [old_topic, old_token].into_iter().flatten() {
            let _ = state.store.delete(&previous);
        }
        drop(state);
        Ok(self.push_status())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn save_push(&self, _payload: &Value) -> Result<Value, String> {
        Err("Mobile does not store desktop push credentials.".to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn remove_push(&self) -> Result<Value, String> {
        let mut state = self.lock();
        let previous_topic = state.metadata.push.topic.reference.clone();
        let previous_token = state.metadata.push.token.reference.clone();
        state.metadata.push.topic = SecretRef::default();
        state.metadata.push.token = SecretRef::default();
        Self::persist(&state)?;
        Self::delete_refs(&state.store, [previous_topic, previous_token])?;
        drop(state);
        Ok(self.push_status())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn remove_push(&self) -> Result<Value, String> {
        Err("Mobile does not remove desktop push credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn compatibility_dir(state: &DesktopProtectedState, child: &str) -> PathBuf {
        state.data_dir.join(child)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn write_compatibility_secret(
        state: &DesktopProtectedState,
        path: &Path,
        secret: &str,
    ) -> Result<(), String> {
        let parent = path.parent().ok_or_else(bounded_error)?;
        ensure_private_directory(parent).map_err(store_error)?;
        let temporary = parent.join(format!(
            ".{}.{}.tmp",
            path.file_name().and_then(|v| v.to_str()).unwrap_or("token"),
            now_suffix()
        ));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|_| bounded_error())?;
        if file
            .write_all(secret.as_bytes())
            .and_then(|_| file.sync_all())
            .is_err()
        {
            drop(file);
            let _ = std::fs::remove_file(&temporary);
            return Err(bounded_error());
        }
        drop(file);
        if move_file(&temporary, path, true).is_err() {
            let _ = std::fs::remove_file(&temporary);
            return Err(bounded_error());
        }
        let _ = state;
        Ok(())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn remove_compatibility_secret(path: &Path) -> Result<(), String> {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(bounded_error()),
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn backend_json(
        base_url: &str,
        token: &str,
        route: &str,
        method: reqwest::Method,
        body: Option<Value>,
    ) -> Result<Value, String> {
        if token.is_empty() {
            return Err("ForgeLink local backend authentication is unavailable.".to_string());
        }
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|_| "ForgeLink backend request could not start.".to_string())?;
        let mut request = client
            .request(
                method,
                format!("{}{}", base_url.trim_end_matches('/'), route),
            )
            .bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .map_err(|_| "ForgeLink backend request failed.".to_string())?;
        let status = response.status();
        let value: Value = response.json().unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            return Err(value["error"]
                .as_str()
                .map(|_| {
                    "ForgeLink backend rejected the protected credential operation.".to_string()
                })
                .unwrap_or_else(|| {
                    format!("ForgeLink backend request failed ({}).", status.as_u16())
                }));
        }
        Ok(value)
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn token_file(state: &DesktopProtectedState, kind: &str, id: Option<&str>) -> PathBuf {
        let safe_id = |value: &str| {
            if valid_id(value, 80) {
                value.to_string()
            } else {
                let digest = sha2::Sha256::digest(value.as_bytes());
                let suffix = digest
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                format!("invalid-{suffix}")
            }
        };
        match (kind, id) {
            ("mcp", _) => state.data_dir.join("api.token"),
            ("channel", Some(id)) => {
                Self::compatibility_dir(state, "channels").join(format!("{}.token", safe_id(id)))
            }
            ("local", Some(id)) => Self::compatibility_dir(state, "local-integrations")
                .join(format!("{}.token", safe_id(id))),
            _ => state.data_dir.join("invalid.token"),
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn mcp_install_commands() -> Value {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("scripts")
            .join("install")
            .join("install-forgelink-mcp.ps1");
        let script = script.to_string_lossy();
        json!({
            "all": format!("pwsh -NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Target all"),
            "vscode": format!("pwsh -NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Target vscode"),
            "claude": format!("pwsh -NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Target claude"),
            "codex": format!("pwsh -NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Target codex"),
            "forgewire": format!("pwsh -NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Target forgewire")
        })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn mcp_status(&self, base_url: &str, token: &str) -> Value {
        let state = self.lock();
        let status = Self::backend_json(
            base_url,
            token,
            "/api/mcp/status",
            reqwest::Method::GET,
            None,
        )
        .unwrap_or_else(
            |_| json!({ "configured": false, "last_test_status": "backend_unavailable" }),
        );
        let file = Self::token_file(&state, "mcp", None);
        let bridge = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("mcp")
            .join("forgelink-human")
            .join("dist")
            .join("server.js");
        json!({ "configured": status["configured"].as_bool().unwrap_or(false), "created_at": status["created_at"], "rotated_at": status["rotated_at"], "revoked_at": status["revoked_at"], "last_used_at": status["last_used_at"], "last_test_at": status["last_test_at"], "last_test_status": status["last_test_status"], "token_file": file, "token_file_present": file.is_file(), "bridge_server": bridge, "bridge_built": bridge.is_file(), "base_url": base_url, "install_commands": Self::mcp_install_commands() })
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn mcp_status(&self, _base_url: &str, _token: &str) -> Value {
        json!({ "configured": false, "token_file": "", "token_file_present": false, "bridge_server": "", "bridge_built": false, "base_url": "", "install_commands": {} })
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn create_mcp_token(&self, base_url: &str, token: &str) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            "/api/mcp/token",
            reqwest::Method::POST,
            None,
        )?;
        let clear = Zeroizing::new(
            result["token"]
                .as_str()
                .ok_or_else(bounded_error)?
                .to_string(),
        );
        let mut state = self.lock();
        let reference = Self::create_secret(&state, "mcp-token", &clear)?;
        let previous = state.metadata.mcp.token.reference.replace(reference);
        Self::persist(&state)?;
        if let Some(previous) = previous {
            let _ = state.store.delete(&previous);
        }
        let file = Self::token_file(&state, "mcp", None);
        Self::write_compatibility_secret(&state, &file, &clear)?;
        drop(state);
        Ok(self.mcp_status(base_url, token))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn create_mcp_token(&self, _base_url: &str, _token: &str) -> Result<Value, String> {
        Err("Mobile never receives desktop MCP credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn revoke_mcp_token(&self, base_url: &str, token: &str) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            "/api/mcp/token/revoke",
            reqwest::Method::POST,
            None,
        )?;
        let mut state = self.lock();
        let previous = state.metadata.mcp.token.reference.clone();
        state.metadata.mcp = TokenMetadata::default();
        Self::persist(&state)?;
        Self::delete_refs(&state.store, [previous])?;
        let file = Self::token_file(&state, "mcp", None);
        Self::remove_compatibility_secret(&file)?;
        drop(state);
        let mut status = self.mcp_status(base_url, token);
        status["status"] = result["status"].clone();
        Ok(status)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn revoke_mcp_token(&self, _base_url: &str, _token: &str) -> Result<Value, String> {
        Err("Mobile never manages desktop MCP credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn test_mcp_bridge(&self, base_url: &str, token: &str) -> Result<Value, String> {
        let _ = Self::backend_json(
            base_url,
            token,
            "/api/mcp/test-message",
            reqwest::Method::POST,
            Some(json!({ "channel_id": "forgewire" })),
        )?;
        Ok(self.mcp_status(base_url, token))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn test_mcp_bridge(&self, _base_url: &str, _token: &str) -> Result<Value, String> {
        Err("Mobile never tests desktop MCP credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn agent_channels(&self, base_url: &str, token: &str) -> Result<Value, String> {
        let channels = Self::backend_json(
            base_url,
            token,
            "/api/agent-channels",
            reqwest::Method::GET,
            None,
        )?;
        let state = self.lock();
        Ok(Value::Array(
            channels
                .as_array()
                .unwrap_or(&Vec::new())
                .iter()
                .map(|channel| {
                    let id = channel["channel_id"].as_str().unwrap_or_default();
                    let file = Self::token_file(&state, "channel", Some(id));
                    let mut view = channel.clone();
                    view["token_file"] = json!(file);
                    view["token_file_present"] = json!(file.is_file());
                    view
                })
                .collect(),
        ))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn agent_channels(&self, _base_url: &str, _token: &str) -> Result<Value, String> {
        Err("Mobile never manages desktop agent credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn create_agent_channel(
        &self,
        base_url: &str,
        token: &str,
        payload: &Value,
    ) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            "/api/agent-channels",
            reqwest::Method::POST,
            Some(json!({ "channel_id": payload["channel_id"], "label": payload["label"] })),
        )?;
        self.save_channel_token(base_url, token, &result)
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn rotate_agent_channel(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
    ) -> Result<Value, String> {
        if !valid_id(id, 80) {
            return Err("Agent channel id is invalid.".to_string());
        }
        let result = Self::backend_json(
            base_url,
            token,
            &format!("/api/agent-channels/{id}/token"),
            reqwest::Method::POST,
            None,
        )?;
        self.save_channel_token(base_url, token, &result)
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn save_channel_token(
        &self,
        _base_url: &str,
        _token: &str,
        result: &Value,
    ) -> Result<Value, String> {
        let id = result["channel"]["channel_id"]
            .as_str()
            .ok_or_else(bounded_error)?
            .to_string();
        let clear = Zeroizing::new(
            result["token"]
                .as_str()
                .ok_or_else(bounded_error)?
                .to_string(),
        );
        let mut state = self.lock();
        let reference = Self::create_secret(&state, &format!("agent-channel-{id}"), &clear)?;
        let previous = {
            let entry = state.metadata.agent_channels.entry(id.clone()).or_default();
            let previous = entry.token.reference.replace(reference);
            entry.label = result["channel"]["label"]
                .as_str()
                .unwrap_or(&id)
                .to_string();
            previous
        };
        Self::persist(&state)?;
        if let Some(previous) = previous {
            let _ = state.store.delete(&previous);
        }
        let file = Self::token_file(&state, "channel", Some(&id));
        Self::write_compatibility_secret(&state, &file, &clear)?;
        let mut channel = result["channel"].clone();
        channel["token_file"] = json!(file);
        channel["token_file_present"] = json!(true);
        Ok(channel)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn create_agent_channel(
        &self,
        _base_url: &str,
        _token: &str,
        _payload: &Value,
    ) -> Result<Value, String> {
        Err("Mobile never receives desktop agent credentials.".to_string())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn rotate_agent_channel(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
    ) -> Result<Value, String> {
        Err("Mobile never receives desktop agent credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn revoke_agent_channel(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
    ) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            &format!("/api/agent-channels/{id}/revoke"),
            reqwest::Method::POST,
            None,
        )?;
        let channel = result["channel"].clone();
        let id = channel["channel_id"].as_str().unwrap_or(id).to_string();
        let mut state = self.lock();
        let previous = state
            .metadata
            .agent_channels
            .get_mut(&id)
            .and_then(|entry| entry.token.reference.take());
        Self::persist(&state)?;
        Self::delete_refs(&state.store, [previous])?;
        Self::remove_compatibility_secret(&Self::token_file(&state, "channel", Some(&id)))?;
        let mut view = channel;
        view["token_file"] = json!(Self::token_file(&state, "channel", Some(&id)));
        view["token_file_present"] = json!(false);
        Ok(view)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn revoke_agent_channel(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
    ) -> Result<Value, String> {
        Err("Mobile never manages desktop agent credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn set_agent_channel_enabled(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
        enabled: bool,
    ) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            &format!(
                "/api/agent-channels/{id}/{}",
                if enabled { "enable" } else { "disable" }
            ),
            reqwest::Method::POST,
            None,
        )?;
        let channel = result["channel"].clone();
        let state = self.lock();
        let file = Self::token_file(
            &state,
            "channel",
            Some(channel["channel_id"].as_str().unwrap_or(id)),
        );
        let mut view = channel;
        view["token_file"] = json!(file);
        view["token_file_present"] = json!(file.is_file());
        Ok(view)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn set_agent_channel_enabled(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
        _enabled: bool,
    ) -> Result<Value, String> {
        Err("Mobile never manages desktop agent credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn local_integration_view(state: &DesktopProtectedState, integration: &Value) -> Value {
        let id = integration["id"].as_str().unwrap_or_default();
        let file = Self::token_file(state, "local", Some(id));
        let mut view = integration.clone();
        view["token_file"] = json!(file);
        view["token_file_present"] = json!(file.is_file());
        view
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn local_integrations(&self, base_url: &str, token: &str) -> Result<Value, String> {
        let integrations = Self::backend_json(
            base_url,
            token,
            "/api/local-integrations",
            reqwest::Method::GET,
            None,
        )?;
        let state = self.lock();
        Ok(Value::Array(
            integrations
                .as_array()
                .unwrap_or(&Vec::new())
                .iter()
                .map(|item| Self::local_integration_view(&state, item))
                .collect(),
        ))
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn local_integrations(&self, _base_url: &str, _token: &str) -> Result<Value, String> {
        Err("Mobile never manages desktop local-integration credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn save_local_token(&self, result: &Value) -> Result<Value, String> {
        let integration = &result["integration"];
        let id = integration["id"]
            .as_str()
            .ok_or_else(bounded_error)?
            .to_string();
        let clear = Zeroizing::new(
            result["token"]
                .as_str()
                .ok_or_else(bounded_error)?
                .to_string(),
        );
        let mut state = self.lock();
        let reference = Self::create_secret(&state, &format!("local-integration-{id}"), &clear)?;
        let previous = {
            let entry = state
                .metadata
                .local_integrations
                .entry(id.clone())
                .or_default();
            entry.label = integration["label"].as_str().unwrap_or(&id).to_string();
            entry.scopes = integration["scopes"]
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            entry.token.reference.replace(reference)
        };
        Self::persist(&state)?;
        if let Some(previous) = previous {
            let _ = state.store.delete(&previous);
        }
        let file = Self::token_file(&state, "local", Some(&id));
        Self::write_compatibility_secret(&state, &file, &clear)?;
        Ok(Self::local_integration_view(&state, integration))
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn create_local_integration(
        &self,
        base_url: &str,
        token: &str,
        payload: &Value,
    ) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            "/api/local-integrations",
            reqwest::Method::POST,
            Some(
                json!({ "integration_id": payload["integration_id"], "label": payload["label"], "scopes": payload["scopes"] }),
            ),
        )?;
        self.save_local_token(&result)
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn create_local_integration(
        &self,
        _base_url: &str,
        _token: &str,
        _payload: &Value,
    ) -> Result<Value, String> {
        Err("Mobile never receives desktop local-integration credentials.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn update_local_integration(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
        payload: &Value,
    ) -> Result<Value, String> {
        if !valid_id(id, 80) {
            return Err("Local integration id is invalid.".to_string());
        }
        let result = Self::backend_json(
            base_url,
            token,
            &format!("/api/local-integrations/{id}"),
            reqwest::Method::POST,
            Some(payload.clone()),
        )?;
        let state = self.lock();
        Ok(Self::local_integration_view(&state, &result["integration"]))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn update_local_integration(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
        _payload: &Value,
    ) -> Result<Value, String> {
        Err("Mobile never manages desktop local integrations.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn rotate_local_integration(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
    ) -> Result<Value, String> {
        if !valid_id(id, 80) {
            return Err("Local integration id is invalid.".to_string());
        }
        let result = Self::backend_json(
            base_url,
            token,
            &format!("/api/local-integrations/{id}/rotate"),
            reqwest::Method::POST,
            None,
        )?;
        self.save_local_token(&result)
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn rotate_local_integration(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
    ) -> Result<Value, String> {
        Err("Mobile never manages desktop local integrations.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn revoke_local_integration(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
    ) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            &format!("/api/local-integrations/{id}/revoke"),
            reqwest::Method::POST,
            None,
        )?;
        let integration = result["integration"].clone();
        let id = integration["id"].as_str().unwrap_or(id).to_string();
        let mut state = self.lock();
        let previous = state
            .metadata
            .local_integrations
            .get_mut(&id)
            .and_then(|entry| entry.token.reference.take());
        Self::persist(&state)?;
        Self::delete_refs(&state.store, [previous])?;
        let file = Self::token_file(&state, "local", Some(&id));
        Self::remove_compatibility_secret(&file)?;
        Ok(Self::local_integration_view(&state, &integration))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn revoke_local_integration(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
    ) -> Result<Value, String> {
        Err("Mobile never manages desktop local integrations.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn set_local_integration_enabled(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
        enabled: bool,
    ) -> Result<Value, String> {
        let result = Self::backend_json(
            base_url,
            token,
            &format!(
                "/api/local-integrations/{id}/{}",
                if enabled { "enable" } else { "disable" }
            ),
            reqwest::Method::POST,
            None,
        )?;
        let state = self.lock();
        Ok(Self::local_integration_view(&state, &result["integration"]))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn set_local_integration_enabled(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
        _enabled: bool,
    ) -> Result<Value, String> {
        Err("Mobile never manages desktop local integrations.".to_string())
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub fn test_local_integration(
        &self,
        base_url: &str,
        token: &str,
        id: &str,
    ) -> Result<Value, String> {
        let state = self.lock();
        let reference = state
            .metadata
            .local_integrations
            .get(id)
            .and_then(|entry| entry.token.reference.clone())
            .ok_or_else(|| "Local integration credential is unavailable.".to_string())?;
        let secret = Self::read_ref(&state, &Some(reference))?.ok_or_else(bounded_error)?;
        drop(state);
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|_| "Local integration test could not start.".to_string())?;
        let response = client.post(format!("{}/local-integrations/{}/events", base_url.trim_end_matches('/'), id)).header("X-ForgeLink-Local-Token", secret.as_str()).json(&json!({ "schema_version": 1, "event_id": format!("tauri-test-{}", now_suffix()), "event_type": "agent_message", "occurred_at": format!("unix:{}", now_suffix()), "payload": { "title": "Local integration test", "body": "Synthetic local integration test event.", "urgency": "low" } })).send().map_err(|_| "Local integration test failed.".to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Local integration test failed ({}).",
                response.status().as_u16()
            ));
        }
        self.local_integrations(base_url, token).map(|values| {
            values
                .as_array()
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item["id"].as_str() == Some(id))
                        .cloned()
                })
                .unwrap_or_else(|| json!({}))
        })
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub fn test_local_integration(
        &self,
        _base_url: &str,
        _token: &str,
        _id: &str,
    ) -> Result<Value, String> {
        Err("Mobile never tests desktop local integrations.".to_string())
    }
}

fn mask_identifier(value: &str) -> String {
    if value.len() <= 6 {
        return if value.is_empty() {
            String::new()
        } else {
            "••••".to_string()
        };
    }
    format!(
        "{}••••{}",
        &value[..2.min(value.len())],
        &value[value.len().saturating_sub(4)..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_twilio_identifiers_and_never_serializes_secret_fields() {
        let status = mask_identifier("AC1234567890");
        assert_eq!(status, "AC••••7890");
        let serialized =
            json!({ "account_sid": status, "auth_token_configured": true }).to_string();
        assert!(!serialized.contains("auth_token:"));
    }

    #[test]
    fn validates_bounded_identifiers() {
        assert!(valid_id("forgewire", 80));
        assert!(!valid_id("../escape", 80));
        assert!(!valid_id("", 80));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn metadata_contains_references_but_never_secret_material() {
        let mut metadata = ProtectedMetadata::default();
        metadata.twilio.account_sid = "synthetic-account-sid-fixture".to_string();
        metadata.twilio.auth_token.reference =
            Some("forgelink:protected:twilio:auth:v1".to_string());
        let serialized = serde_json::to_string(&metadata).expect("metadata serializes");
        assert!(serialized.contains("forgelink:protected:twilio:auth:v1"));
        assert!(!serialized.contains("synthetic-secret-canary"));
        assert!(!serialized.contains("auth_token_value"));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn environment_defaults_match_backend_contract_without_persisting_values() {
        assert_eq!(env_or_default("", "FORGELINK_TEST_MISSING", "ntfy"), "ntfy");
        assert_eq!(
            env_or_default("configured", "FORGELINK_TEST_MISSING", "ntfy"),
            "configured"
        );
        assert_eq!(env_u16_or_default(465, "FORGELINK_TEST_MISSING_PORT"), 465);
        assert!(env_bool_or_default(true, "FORGELINK_TEST_MISSING_BOOL"));
        assert!(!env_bool_or_default(false, "FORGELINK_TEST_MISSING_BOOL"));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn migration_detection_is_explicit_and_legacy_files_are_not_overwritten() {
        let root = std::env::temp_dir().join(format!("forgelink-migration-test-{}", now_suffix()));
        std::fs::create_dir_all(&root).expect("migration directory");
        let legacy = root.join("settings.json");
        std::fs::write(&legacy, br#"{"auth_token_encrypted":"legacy-ciphertext"}"#)
            .expect("legacy settings");
        let candidates = legacy_candidates(std::slice::from_ref(&root));
        assert!(candidates.contains(&legacy));
        assert_eq!(
            std::fs::read_to_string(&legacy).expect("legacy remains"),
            r#"{"auth_token_encrypted":"legacy-ciphertext"}"#
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn compatibility_paths_cannot_escape_the_owned_data_directory() {
        let data_dir = std::env::temp_dir().join(format!("forgelink-path-test-{}", now_suffix()));
        let vault = data_dir.join(PROTECTED_VAULT_DIR);
        ensure_private_directory(&vault).expect("vault directory");
        let state = DesktopProtectedState {
            data_dir: data_dir.clone(),
            metadata: ProtectedMetadata::default(),
            store: EncryptedFileSecretStore::with_magic(
                vault,
                OsWrappingKeyProvider::new(KEYRING_SERVICE, KEYRING_ACCOUNT),
                PROTECTED_SETTINGS_MAGIC,
            )
            .expect("store"),
            metadata_corrupt: false,
            migration: MigrationState::default(),
        };
        let escaped = ProtectedSettingsService::token_file(&state, "channel", Some("../escape"));
        assert!(escaped.starts_with(data_dir.join("channels")));
        assert_eq!(
            escaped.extension().and_then(|value| value.to_str()),
            Some("token")
        );
        assert!(!escaped.to_string_lossy().contains("..\\escape"));
        let _ = std::fs::remove_dir_all(data_dir);
    }
}
