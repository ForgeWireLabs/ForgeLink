use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand_core::{OsRng, RngCore};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 5055;
const HEALTH_TIMEOUT: Duration = Duration::from_millis(500);
const READINESS_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const RESTART_LIMIT: usize = 5;
const RESTART_WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ServiceConfig {
    pub host: String,
    pub configured_port: u16,
    pub onboarding_complete: bool,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            host: DEFAULT_HOST.to_string(),
            configured_port: DEFAULT_PORT,
            onboarding_complete: false,
        }
    }
}

impl ServiceConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.host.as_str(), "127.0.0.1" | "localhost") {
            return Err("Local service host must remain on loopback.".to_string());
        }
        if !(1024..=u16::MAX).contains(&self.configured_port) {
            return Err("Local service port must be between 1024 and 65535.".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ServiceSnapshot {
    pub phase: &'static str,
    pub running: bool,
    pub base_url: String,
    pub configured_port: u16,
    pub effective_port: u16,
    pub backend_restarts: usize,
    pub last_exit_code: Option<i32>,
    pub recovery_message: String,
    pub port_note: String,
    pub runtime_available: bool,
    pub mobile_runtime: bool,
    pub ownership: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackendConnection {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiToken")]
    pub api_token: String,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Clone, Debug)]
pub struct BackendRuntime {
    pub executable: PathBuf,
    pub script: PathBuf,
    pub working_dir: Option<PathBuf>,
    pub bundled: bool,
    extra_env: Vec<(String, String)>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl BackendRuntime {
    fn new(
        executable: PathBuf,
        script: PathBuf,
        working_dir: Option<PathBuf>,
        bundled: bool,
    ) -> Self {
        Self {
            executable,
            script,
            working_dir,
            bundled,
            extra_env: Vec::new(),
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Clone, Debug)]
pub struct BackendRuntime;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn resolve_backend_runtime(resource_dir: Option<PathBuf>) -> Result<BackendRuntime, String> {
    let resource_roots = resource_dir
        .into_iter()
        .flat_map(|root| {
            [
                root.join("forgelink-runtime"),
                root.join("backend-runtime"),
                root.join(".runtime"),
            ]
        })
        .collect::<Vec<_>>();
    let executable_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    for root in resource_roots {
        let executable = root.join(executable_name);
        let script = root.join("backend-dist").join("index.js");
        if executable.is_file() && script.is_file() {
            return Ok(BackendRuntime::new(executable, script, Some(root), true));
        }
    }

    if cfg!(debug_assertions) {
        let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let electron_root = manifest_root.join("..").join("..").join("Electron");
        let script = std::env::var_os("FORGELINK_BACKEND_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|| electron_root.join("backend-dist").join("index.js"));
        let executable = std::env::var_os("FORGELINK_NODE_RUNTIME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(if cfg!(target_os = "windows") {
                    "node.exe"
                } else {
                    "node"
                })
            });
        if script.is_file() {
            return Ok(BackendRuntime::new(
                executable,
                script,
                Some(electron_root),
                false,
            ));
        }
    }

    Err("ForgeLink local backend runtime is unavailable. Build the bundled backend runtime before launching the packaged shell.".to_string())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn resolve_backend_runtime(_resource_dir: Option<PathBuf>) -> Result<BackendRuntime, String> {
    Err("Mobile does not bundle or start the desktop ForgeLink backend.".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug)]
struct OwnedChild {
    child: std::process::Child,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug)]
struct RestartBudget {
    attempts: Vec<std::time::Instant>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl RestartBudget {
    fn new() -> Self {
        Self {
            attempts: Vec::new(),
        }
    }

    fn prune(&mut self, now: std::time::Instant) {
        self.attempts
            .retain(|attempt| now.duration_since(*attempt) < RESTART_WINDOW);
    }

    fn allow(&mut self) -> bool {
        let now = std::time::Instant::now();
        self.prune(now);
        if self.attempts.len() >= RESTART_LIMIT {
            return false;
        }
        self.attempts.push(now);
        true
    }

    fn count(&mut self) -> usize {
        self.prune(std::time::Instant::now());
        self.attempts.len()
    }

    fn reset(&mut self) {
        self.attempts.clear();
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct DesktopInner {
    config: ServiceConfig,
    data_dir: PathBuf,
    runtime: Result<BackendRuntime, String>,
    api_token: String,
    phase: &'static str,
    effective_port: u16,
    child: Option<OwnedChild>,
    ownership: &'static str,
    restarts: RestartBudget,
    last_exit_code: Option<i32>,
    recovery_message: String,
    port_note: String,
    stop_requested: bool,
    generation: u64,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub struct LocalServiceManager {
    inner: Arc<Mutex<DesktopInner>>,
    monitor_stop: Arc<std::sync::atomic::AtomicBool>,
    monitor: Mutex<Option<std::thread::JoinHandle<()>>>,
    readiness_timeout: Duration,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl LocalServiceManager {
    pub fn new(
        runtime: Result<BackendRuntime, String>,
        config: ServiceConfig,
        data_dir: PathBuf,
        api_token: Option<String>,
    ) -> Self {
        Self::with_readiness_timeout(runtime, config, data_dir, api_token, READINESS_TIMEOUT)
    }

    fn with_readiness_timeout(
        runtime: Result<BackendRuntime, String>,
        config: ServiceConfig,
        data_dir: PathBuf,
        api_token: Option<String>,
        readiness_timeout: Duration,
    ) -> Self {
        let token = api_token
            .filter(|value| !value.is_empty())
            .unwrap_or_else(new_api_token);
        let effective_port = config.configured_port;
        let inner = Arc::new(Mutex::new(DesktopInner {
            config,
            data_dir,
            runtime,
            api_token: token,
            phase: "stopped",
            effective_port,
            child: None,
            ownership: "none",
            restarts: RestartBudget::new(),
            last_exit_code: None,
            recovery_message: String::new(),
            port_note: String::new(),
            stop_requested: false,
            generation: 0,
        }));
        let monitor_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let monitor_inner = Arc::clone(&inner);
        let monitor_stop_clone = Arc::clone(&monitor_stop);
        let monitor = std::thread::Builder::new()
            .name("forgelink-local-service-monitor".to_string())
            .spawn(move || monitor_loop(monitor_inner, monitor_stop_clone))
            .expect("ForgeLink local-service monitor thread must start");

        Self {
            inner,
            monitor_stop,
            monitor: Mutex::new(Some(monitor)),
            readiness_timeout,
        }
    }

    pub fn config(&self) -> ServiceConfig {
        lock(&self.inner).config.clone()
    }

    pub fn update_config(&self, config: ServiceConfig) -> Result<(), String> {
        config.validate()?;
        let mut state = lock(&self.inner);
        state.config = config;
        if state.phase == "stopped" {
            state.effective_port = state.config.configured_port;
        }
        Ok(())
    }

    pub fn snapshot(&self) -> ServiceSnapshot {
        snapshot_desktop(&mut lock(&self.inner))
    }

    pub fn backend_connection(&self) -> BackendConnection {
        let state = lock(&self.inner);
        BackendConnection {
            base_url: base_url(&state.config.host, effective_port(&state)),
            api_token: state.api_token.clone(),
        }
    }

    pub fn start(&self) -> Result<ServiceSnapshot, String> {
        let current = self.config();
        current.validate()?;

        {
            let mut state = lock(&self.inner);
            if state.phase == "ready" {
                return Ok(snapshot_desktop(&mut state));
            }
        }
        self.stop_internal(false)?;

        let (generation, config, runtime, token, data_dir) = {
            let mut state = lock(&self.inner);
            state.config.validate()?;
            if !state.config.onboarding_complete {
                state.phase = "degraded";
                state.recovery_message =
                    "Complete local-service onboarding before starting the ForgeLink backend."
                        .to_string();
                return Err(state.recovery_message.clone());
            }
            state.phase = "starting";
            state.stop_requested = false;
            state.ownership = "none";
            state.recovery_message.clear();
            state.port_note.clear();
            state.last_exit_code = None;
            state.restarts.reset();
            state.generation = state.generation.wrapping_add(1);
            (
                state.generation,
                state.config.clone(),
                state.runtime.clone(),
                state.api_token.clone(),
                state.data_dir.clone(),
            )
        };

        let runtime = match runtime {
            Ok(runtime) => runtime,
            Err(error) => return self.fail_start(generation, error),
        };

        let preferred_url = base_url(&config.host, config.configured_port);
        if authenticated_health(&preferred_url, &token) {
            let mut state = lock(&self.inner);
            if state.generation != generation || state.stop_requested {
                return Err("Local service start was superseded by shutdown.".to_string());
            }
            state.phase = "ready";
            state.effective_port = config.configured_port;
            state.ownership = "attached";
            state.recovery_message.clear();
            return Ok(snapshot_desktop(&mut state));
        }

        let selected_port = select_port(&config.host, config.configured_port)
            .map_err(|error| self.fail_start(generation, error).err().unwrap_or_default())?;
        let port_note = if selected_port != config.configured_port {
            format!(
                "Configured loopback port {} was busy; using available port {}. The occupying process was not terminated.",
                config.configured_port, selected_port
            )
        } else {
            String::new()
        };
        let mut child = match spawn_backend(&runtime, &config, selected_port, &token, &data_dir) {
            Ok(child) => child,
            Err(error) => return self.fail_start(generation, error),
        };

        let ready = wait_for_readiness(
            &mut child.child,
            &base_url(&config.host, selected_port),
            &token,
            self.readiness_timeout,
        );
        if let Err(error) = ready {
            terminate_child(child.child);
            return self.fail_start(generation, error);
        }

        let mut state = lock(&self.inner);
        if state.generation != generation || state.stop_requested {
            drop(state);
            terminate_child(child.child);
            return Err("Local service start was superseded by shutdown.".to_string());
        }
        state.phase = "ready";
        state.effective_port = selected_port;
        state.ownership = "owned";
        state.child = Some(child);
        state.port_note = port_note;
        state.recovery_message.clear();
        Ok(snapshot_desktop(&mut state))
    }

    pub fn stop(&self) -> ServiceSnapshot {
        self.stop_internal(true)
            .unwrap_or_else(|error| self.fail_stop(error))
    }

    pub fn shutdown(&self) {
        let _ = self.stop_internal(true);
        self.monitor_stop
            .store(true, std::sync::atomic::Ordering::Release);
        if let Some(handle) = lock(&self.monitor).take() {
            if handle.thread().id() != std::thread::current().id() {
                let _ = handle.join();
            }
        }
    }

    fn stop_internal(&self, operator_requested: bool) -> Result<ServiceSnapshot, String> {
        let child = {
            let mut state = lock(&self.inner);
            state.generation = state.generation.wrapping_add(1);
            state.stop_requested = true;
            state.phase = "stopping";
            state.child.take()
        };

        if let Some(child) = child {
            terminate_child(child.child);
        }

        let mut state = lock(&self.inner);
        state.phase = "stopped";
        state.effective_port = state.config.configured_port;
        state.ownership = "none";
        state.child = None;
        state.restarts.reset();
        if operator_requested {
            state.recovery_message.clear();
        }
        Ok(snapshot_desktop(&mut state))
    }

    fn fail_start(&self, generation: u64, error: String) -> Result<ServiceSnapshot, String> {
        let mut state = lock(&self.inner);
        if state.generation == generation {
            state.phase = "degraded";
            state.ownership = "none";
            state.child = None;
            state.recovery_message = error.clone();
        }
        Err(error)
    }

    fn fail_stop(&self, error: String) -> ServiceSnapshot {
        let mut state = lock(&self.inner);
        state.phase = "degraded";
        state.ownership = "none";
        state.recovery_message = error;
        snapshot_desktop(&mut state)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl Drop for LocalServiceManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn monitor_loop(inner: Arc<Mutex<DesktopInner>>, stop: Arc<std::sync::atomic::AtomicBool>) {
    while !stop.load(std::sync::atomic::Ordering::Acquire) {
        let restart = {
            let mut state = lock(&inner);
            match state.child.as_mut() {
                None => None,
                Some(child) => match child.child.try_wait() {
                    Ok(None) => None,
                    Ok(Some(status)) => {
                        state.child = None;
                        state.ownership = "none";
                        state.last_exit_code = status.code();
                        let unexpected = !state.stop_requested && state.phase != "stopping";
                        if !unexpected {
                            state.phase = "stopped";
                            None
                        } else if status.code() != Some(0) && state.restarts.allow() {
                            state.phase = "starting";
                            state.recovery_message = format!(
                            "The local service exited unexpectedly; retrying automatically ({}/{}).",
                            state.restarts.count(), RESTART_LIMIT
                        );
                            Some((
                                state.generation,
                                state.config.clone(),
                                state.runtime.clone(),
                                state.api_token.clone(),
                                state.data_dir.clone(),
                                state.effective_port,
                                state.restarts.count(),
                            ))
                        } else {
                            state.phase = "degraded";
                            state.recovery_message = format!(
                            "The local service stopped unexpectedly and automatic recovery is exhausted. Retry from the local-service controls."
                        );
                            None
                        }
                    }
                    Err(error) => {
                        state.phase = "degraded";
                        state.ownership = "none";
                        state.recovery_message =
                            format!("The local service could not be inspected: {error}");
                        None
                    }
                },
            }
        };

        if let Some((generation, config, runtime, token, data_dir, port, attempt)) = restart {
            std::thread::sleep(Duration::from_millis((attempt as u64) * 100));
            if stop.load(std::sync::atomic::Ordering::Acquire) {
                break;
            }
            let Ok(runtime) = runtime else {
                continue;
            };
            let Ok(mut child) = spawn_backend(&runtime, &config, port, &token, &data_dir) else {
                let mut state = lock(&inner);
                if state.generation == generation {
                    state.phase = "degraded";
                    state.recovery_message = "The local service could not be restarted. Retry from the local-service controls.".to_string();
                }
                continue;
            };
            let ready = wait_for_readiness(
                &mut child.child,
                &base_url(&config.host, port),
                &token,
                READINESS_TIMEOUT,
            );
            let mut state = lock(&inner);
            if state.generation != generation || state.stop_requested {
                drop(state);
                terminate_child(child.child);
            } else if ready.is_ok() {
                state.phase = "ready";
                state.ownership = "owned";
                state.child = Some(child);
                state.recovery_message.clear();
            } else {
                drop(state);
                terminate_child(child.child);
                let mut state = lock(&inner);
                if state.generation == generation {
                    state.phase = "degraded";
                    state.recovery_message = "The local service restarted but did not become ready. Retry from the local-service controls.".to_string();
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_backend(
    runtime: &BackendRuntime,
    config: &ServiceConfig,
    port: u16,
    token: &str,
    data_dir: &PathBuf,
) -> Result<OwnedChild, String> {
    let mut command = std::process::Command::new(&runtime.executable);
    command
        .arg(&runtime.script)
        .arg("--host")
        .arg(&config.host)
        .arg("--port")
        .arg(port.to_string())
        .env("FORGELINK_HOST", &config.host)
        .env("FORGELINK_PORT", port.to_string())
        .env("FORGELINK_DATA_DIR", data_dir)
        .env("FORGELINK_API_TOKEN", token)
        .env("FORGELINK_APP_VERSION", env!("CARGO_PKG_VERSION"))
        .env("FORGELINK_RUNTIME_BUNDLED", runtime.bundled.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Some(working_dir) = &runtime.working_dir {
        command.current_dir(working_dir);
    }
    for (key, value) in &runtime.extra_env {
        command.env(key, value);
    }
    command
        .spawn()
        .map(|child| OwnedChild { child })
        .map_err(|error| format!("ForgeLink local backend could not start: {error}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn wait_for_readiness(
    child: &mut std::process::Child,
    url: &str,
    token: &str,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if let Some(status) = child.try_wait().map_err(|error| {
            format!("ForgeLink local backend process could not be inspected: {error}")
        })? {
            return Err(format!(
                "ForgeLink local backend exited before authenticated readiness (code {}).",
                status
                    .code()
                    .map_or_else(|| "unknown".to_string(), |code| code.to_string())
            ));
        }
        if authenticated_health(url, token) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(
        "ForgeLink local backend did not become ready after authenticated health checks."
            .to_string(),
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn terminate_child(mut child: std::process::Child) {
    let _ = child.kill();
    let deadline = std::time::Instant::now() + SHUTDOWN_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn select_port(host: &str, preferred: u16) -> Result<u16, String> {
    if std::net::TcpListener::bind((host, preferred)).is_ok() {
        return Ok(preferred);
    }
    std::net::TcpListener::bind((host, 0))
        .map(|listener| listener.local_addr().map(|address| address.port()))
        .map_err(|error| format!("No loopback port is available for ForgeLink: {error}"))?
        .map_err(|error| format!("No loopback port is available for ForgeLink: {error}"))
}

fn authenticated_health(url: &str, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let Ok(client) = Client::builder().timeout(HEALTH_TIMEOUT).build() else {
        return false;
    };
    let Ok(response) = client
        .get(format!("{}/health", url.trim_end_matches('/')))
        .bearer_auth(token)
        .send()
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    response
        .json::<Value>()
        .map(|body| body["ok"] == true && body["runtime"] == "node")
        .unwrap_or(false)
}

fn new_api_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn base_url(host: &str, port: u16) -> String {
    format!("http://{host}:{port}")
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn effective_port(state: &DesktopInner) -> u16 {
    if state.phase == "ready" || state.phase == "starting" {
        state.effective_port
    } else {
        state.config.configured_port
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn snapshot_desktop(state: &mut DesktopInner) -> ServiceSnapshot {
    if state.phase == "ready"
        && !authenticated_health(
            &base_url(&state.config.host, state.effective_port),
            &state.api_token,
        )
    {
        state.phase = "degraded";
        state.recovery_message =
            "The local service is no longer responding to authenticated health checks. Retry the local-service controls."
                .to_string();
    }
    ServiceSnapshot {
        phase: state.phase,
        running: state.phase == "ready",
        base_url: base_url(&state.config.host, effective_port(state)),
        configured_port: state.config.configured_port,
        effective_port: effective_port(state),
        backend_restarts: state.restarts.count(),
        last_exit_code: state.last_exit_code,
        recovery_message: state.recovery_message.clone(),
        port_note: state.port_note.clone(),
        runtime_available: state.runtime.is_ok(),
        mobile_runtime: false,
        ownership: state.ownership,
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
struct MobileInner {
    config: ServiceConfig,
    base_url: String,
    api_token: String,
    phase: &'static str,
    recovery_message: String,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub struct LocalServiceManager {
    inner: Mutex<MobileInner>,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
impl LocalServiceManager {
    pub fn new(
        _runtime: Result<BackendRuntime, String>,
        mut config: ServiceConfig,
        _data_dir: PathBuf,
        _api_token: Option<String>,
    ) -> Self {
        config.onboarding_complete = true;
        let base_url = std::env::var("FORGELINK_LOCAL_API_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:5055".to_string());
        let api_token = std::env::var("FORGELINK_LOCAL_API_TOKEN")
            .or_else(|_| std::env::var("FORGELINK_API_TOKEN"))
            .unwrap_or_default();
        Self {
            inner: Mutex::new(MobileInner {
                config,
                base_url,
                api_token,
                phase: "degraded",
                recovery_message: "Mobile is an authenticated client of the operator-owned ForgeLink node; it never starts or stores the desktop backend.".to_string(),
            }),
        }
    }

    pub fn config(&self) -> ServiceConfig {
        lock(&self.inner).config.clone()
    }

    pub fn update_config(&self, _config: ServiceConfig) -> Result<(), String> {
        Err("Mobile does not own the desktop local service. Pair or configure an authenticated operator node instead.".to_string())
    }

    pub fn snapshot(&self) -> ServiceSnapshot {
        let mut state = lock(&self.inner);
        state.phase = if authenticated_health(&state.base_url, &state.api_token) {
            "ready"
        } else {
            "degraded"
        };
        ServiceSnapshot {
            phase: state.phase,
            running: state.phase == "ready",
            base_url: state.base_url.clone(),
            configured_port: state.config.configured_port,
            effective_port: state.config.configured_port,
            backend_restarts: 0,
            last_exit_code: None,
            recovery_message: state.recovery_message.clone(),
            port_note: String::new(),
            runtime_available: false,
            mobile_runtime: true,
            ownership: "remote",
        }
    }

    pub fn backend_connection(&self) -> BackendConnection {
        let state = lock(&self.inner);
        BackendConnection {
            base_url: state.base_url.clone(),
            api_token: state.api_token.clone(),
        }
    }

    pub fn start(&self) -> Result<ServiceSnapshot, String> {
        let snapshot = self.snapshot();
        if snapshot.running {
            Ok(snapshot)
        } else {
            Err(snapshot.recovery_message)
        }
    }

    pub fn stop(&self) -> ServiceSnapshot {
        self.snapshot()
    }

    pub fn shutdown(&self) {}
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::{self, File},
        io::Write,
        net::TcpListener,
        process::{Child, Command},
        sync::atomic::{AtomicUsize, Ordering},
        thread,
        time::{Duration, Instant},
    };

    static TEST_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    fn test_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "forgelink-tauri-local-service-{name}-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("test directory");
        path
    }

    fn test_script(mode: &str) -> (PathBuf, PathBuf) {
        let root = test_dir(mode);
        let script = root.join("backend.js");
        let mut file = File::create(&script).expect("test backend script");
        writeln!(
            file,
            r#"const http = require('node:http');
const token = process.env.FORGELINK_API_TOKEN;
const mode = process.env.FORGELINK_TEST_MODE || 'ready';
if (mode === 'timeout') {{ setInterval(() => {{}}, 1000); }}
const server = http.createServer((request, response) => {{
  if (request.url === '/health' && request.headers.authorization === `Bearer ${{token}}`) {{
    response.writeHead(200, {{ 'content-type': 'application/json' }});
    response.end(JSON.stringify({{ ok: true, runtime: 'node' }}));
    return;
  }}
  response.writeHead(401); response.end();
}});
if (mode !== 'timeout') server.listen(Number(process.env.FORGELINK_PORT), process.env.FORGELINK_HOST);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
 if (mode === 'crash') setTimeout(() => process.exit(23), 1000);
"#
        )
        .expect("write test backend script");
        let mut executable = PathBuf::from("node");
        if cfg!(target_os = "windows") {
            executable = PathBuf::from("node.exe");
        }
        (root, executable)
    }

    fn manager(mode: &str, timeout: Duration) -> (LocalServiceManager, PathBuf) {
        let (root, executable) = test_script(mode);
        let script = root.join("backend.js");
        let mut runtime = BackendRuntime::new(executable, script, Some(root.clone()), false);
        runtime
            .extra_env
            .push(("FORGELINK_TEST_MODE".to_string(), mode.to_string()));
        let port = free_port();
        let config = ServiceConfig {
            host: DEFAULT_HOST.to_string(),
            configured_port: port,
            onboarding_complete: true,
        };
        let manager = LocalServiceManager::with_readiness_timeout(
            Ok(runtime),
            config,
            test_dir("data"),
            Some("test-local-service-token".to_string()),
            timeout,
        );
        (manager, root)
    }

    fn free_port() -> u16 {
        TcpListener::bind((DEFAULT_HOST, 0))
            .expect("free test port")
            .local_addr()
            .expect("test port address")
            .port()
    }

    fn wait_until(timeout: Duration, mut predicate: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if predicate() {
                return true;
            }
            thread::sleep(Duration::from_millis(50));
        }
        predicate()
    }

    fn stop_process(child: &mut Child) {
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn starts_only_after_authenticated_readiness_and_stops_owned_child() {
        let (manager, root) = manager("ready", Duration::from_secs(2));
        let started = manager.start().expect("service starts");
        assert_eq!(started.phase, "ready");
        assert!(started.running);
        assert_eq!(started.ownership, "owned");
        assert!(manager
            .backend_connection()
            .api_token
            .contains("test-local"));

        let stopped = manager.stop();
        assert_eq!(stopped.phase, "stopped");
        assert!(!stopped.running);
        manager.shutdown();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn readiness_timeout_never_reports_running() {
        let (manager, root) = manager("timeout", Duration::from_millis(350));
        let error = manager.start().expect_err("timeout should fail");
        assert!(error.contains("authenticated health"));
        let status = manager.snapshot();
        assert_eq!(status.phase, "degraded");
        assert!(!status.running);
        manager.shutdown();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn startup_requires_completed_onboarding_without_spawning() {
        let (root, executable) = test_script("ready");
        let manager = LocalServiceManager::with_readiness_timeout(
            Ok(BackendRuntime::new(
                executable,
                root.join("backend.js"),
                Some(root.clone()),
                false,
            )),
            ServiceConfig {
                host: DEFAULT_HOST.to_string(),
                configured_port: free_port(),
                onboarding_complete: false,
            },
            root.join("data"),
            Some("onboarding-test-token".to_string()),
            Duration::from_millis(350),
        );
        let error = manager
            .start()
            .expect_err("fresh service requires onboarding");
        assert!(error.contains("onboarding"));
        assert_eq!(manager.snapshot().phase, "degraded");
        assert!(!manager.snapshot().running);
        manager.shutdown();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn spawn_failure_is_degraded_without_secret_in_error_or_status() {
        let root = test_dir("spawn-failure");
        let manager = LocalServiceManager::with_readiness_timeout(
            Ok(BackendRuntime::new(
                root.join("missing-node"),
                root.join("missing-script"),
                None,
                false,
            )),
            ServiceConfig {
                host: DEFAULT_HOST.to_string(),
                configured_port: free_port(),
                onboarding_complete: true,
            },
            root.join("data"),
            Some("never-serialize-this-token".to_string()),
            Duration::from_millis(350),
        );
        let error = manager.start().expect_err("spawn should fail");
        let status = format!("{:?}{:?}", error, manager.snapshot());
        assert!(!status.contains("never-serialize-this-token"));
        assert_eq!(manager.snapshot().phase, "degraded");
        manager.shutdown();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unrelated_process_is_not_killed_and_service_uses_dynamic_port() {
        let (root, executable) = test_script("ready");
        let preferred = free_port();
        let mut unrelated = Command::new(&executable)
            .arg(root.join("backend.js"))
            .env("FORGELINK_TEST_MODE", "ready")
            .env("FORGELINK_HOST", DEFAULT_HOST)
            .env("FORGELINK_PORT", preferred.to_string())
            .env("FORGELINK_API_TOKEN", "unrelated-token")
            .current_dir(&root)
            .spawn()
            .expect("unrelated process");
        thread::sleep(Duration::from_millis(100));
        let config = ServiceConfig {
            host: DEFAULT_HOST.to_string(),
            configured_port: preferred,
            onboarding_complete: true,
        };
        let manager = LocalServiceManager::with_readiness_timeout(
            Ok({
                let mut runtime = BackendRuntime::new(
                    executable,
                    root.join("backend.js"),
                    Some(root.clone()),
                    false,
                );
                runtime
                    .extra_env
                    .push(("FORGELINK_TEST_MODE".to_string(), "ready".to_string()));
                runtime
            }),
            config,
            test_dir("conflict-data"),
            Some("test-local-service-token".to_string()),
            Duration::from_secs(2),
        );
        let status = manager.start().expect("dynamic port startup");
        assert!(status.running);
        assert_ne!(status.effective_port, preferred);
        assert!(status.port_note.contains("was busy"));
        assert!(wait_until(Duration::from_secs(1), || unrelated
            .try_wait()
            .expect("unrelated status")
            .is_none()));
        manager.shutdown();
        stop_process(&mut unrelated);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn valid_existing_service_is_attached_without_owned_child() {
        let (root, executable) = test_script("ready");
        let preferred = free_port();
        let token = "test-local-service-token";
        let mut existing = Command::new(&executable)
            .arg(root.join("backend.js"))
            .env("FORGELINK_TEST_MODE", "ready")
            .env("FORGELINK_HOST", DEFAULT_HOST)
            .env("FORGELINK_PORT", preferred.to_string())
            .env("FORGELINK_API_TOKEN", token)
            .current_dir(&root)
            .spawn()
            .expect("existing service");
        thread::sleep(Duration::from_millis(150));
        let manager = LocalServiceManager::with_readiness_timeout(
            Ok(BackendRuntime::new(
                executable,
                root.join("backend.js"),
                Some(root.clone()),
                false,
            )),
            ServiceConfig {
                host: DEFAULT_HOST.to_string(),
                configured_port: preferred,
                onboarding_complete: true,
            },
            test_dir("attached-data"),
            Some(token.to_string()),
            Duration::from_secs(2),
        );
        let status = manager.start().expect("attach to existing service");
        assert_eq!(status.ownership, "attached");
        assert_eq!(status.effective_port, preferred);
        let stopped = manager.stop();
        assert!(!stopped.running);
        assert!(existing.try_wait().expect("existing status").is_none());
        manager.shutdown();
        stop_process(&mut existing);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn crash_recovery_is_bounded_and_exhaustion_is_actionable() {
        let (manager, root) = manager("crash", Duration::from_secs(2));
        manager.start().expect("initial crash service starts");
        assert!(wait_until(Duration::from_secs(12), || {
            let status = manager.snapshot();
            status.phase == "degraded"
                && status.backend_restarts == RESTART_LIMIT
                && status.recovery_message.contains("exhausted")
        }));
        let status = manager.snapshot();
        assert!(!status.running);
        assert_eq!(status.backend_restarts, RESTART_LIMIT);
        assert!(status.recovery_message.contains("exhausted"));
        manager.shutdown();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn shutdown_cleans_up_owned_child_and_does_not_expose_token() {
        let (manager, root) = manager("ready", Duration::from_secs(2));
        manager.start().expect("service starts");
        let connection =
            serde_json::to_string(&manager.backend_connection()).expect("connection serialization");
        let status = serde_json::to_string(&manager.snapshot()).expect("status serialization");
        assert!(connection.contains("test-local-service-token"));
        assert!(!status.contains("test-local-service-token"));
        manager.shutdown();
        assert_eq!(manager.snapshot().phase, "stopped");
        let _ = fs::remove_dir_all(root);
    }
}
