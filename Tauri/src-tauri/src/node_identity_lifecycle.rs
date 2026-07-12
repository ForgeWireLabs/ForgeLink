use crate::node_identity::{
    delete_os_identity_secret, provision_os_identity, NodeIdentityError, NodeIdentityPublic,
    NodeIdentityRequest, NodeIdentitySecretDeletion,
};
use reqwest::{
    blocking::{Client, RequestBuilder},
    redirect::Policy,
    Url,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;

const MAX_GENERATION: u32 = 1_000_000;
const MAX_BACKEND_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CreateLinkedNodeIdentityRequest {
    pub id: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct RotateLinkedNodeIdentityRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkedNodeIdentityRecord {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub public_key: String,
    pub trust_state: String,
    pub key_algorithm: String,
    pub public_key_fingerprint: String,
    pub secure_key_ref: String,
    pub key_generation: u32,
    pub recovery_state: String,
    #[serde(default)]
    pub revocation_reason: String,
    #[serde(default)]
    pub replaced_by_device_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LinkedNodeLifecycleResult {
    pub operation: String,
    pub identity: LinkedNodeIdentityRecord,
    pub retired_secret_deleted: Option<bool>,
    pub cleanup_required: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LinkedNodeLifecycleFailure {
    pub code: String,
    pub phase: String,
    pub rollback_attempted: bool,
    pub rollback_succeeded: Option<bool>,
}

impl LinkedNodeLifecycleFailure {
    fn new(code: impl Into<String>, phase: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            phase: phase.into(),
            rollback_attempted: false,
            rollback_succeeded: None,
        }
    }

    fn with_rollback(
        code: impl Into<String>,
        phase: impl Into<String>,
        rollback_succeeded: bool,
    ) -> Self {
        Self {
            code: code.into(),
            phase: phase.into(),
            rollback_attempted: true,
            rollback_succeeded: Some(rollback_succeeded),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct LinkedNodeIdentityMaterial {
    id: String,
    label: String,
    key_algorithm: String,
    public_key: String,
    public_key_fingerprint: String,
    secure_key_ref: String,
    key_generation: u32,
}

impl LinkedNodeIdentityMaterial {
    fn from_public(identity: &NodeIdentityPublic, label: String) -> Self {
        Self {
            id: identity.id.clone(),
            label,
            key_algorithm: identity.key_algorithm.clone(),
            public_key: identity.public_key.clone(),
            public_key_fingerprint: identity.public_key_fingerprint.clone(),
            secure_key_ref: identity.secure_key_ref.clone(),
            key_generation: identity.key_generation,
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct LinkedNodeIdentityReadiness {
    ready: bool,
    reason: String,
    identity: Option<LinkedNodeIdentityRecord>,
}

#[derive(Debug, Deserialize)]
struct IdentityEnvelope {
    identity: LinkedNodeIdentityRecord,
}

#[derive(Debug, Deserialize)]
struct ReadinessEnvelope {
    readiness: LinkedNodeIdentityReadiness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BackendFailure {
    Unavailable,
    Rejected,
    InvalidResponse,
}

impl BackendFailure {
    fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "linked_node_identity_backend_unavailable",
            Self::Rejected => "linked_node_identity_backend_rejected",
            Self::InvalidResponse => "linked_node_identity_backend_invalid_response",
        }
    }
}

trait IdentityVault {
    fn provision(
        &self,
        request: &NodeIdentityRequest,
    ) -> Result<NodeIdentityPublic, NodeIdentityError>;
    fn delete(
        &self,
        request: &NodeIdentityRequest,
    ) -> Result<NodeIdentitySecretDeletion, NodeIdentityError>;
}

struct OsIdentityVault;

impl IdentityVault for OsIdentityVault {
    fn provision(
        &self,
        request: &NodeIdentityRequest,
    ) -> Result<NodeIdentityPublic, NodeIdentityError> {
        provision_os_identity(request)
    }

    fn delete(
        &self,
        request: &NodeIdentityRequest,
    ) -> Result<NodeIdentitySecretDeletion, NodeIdentityError> {
        delete_os_identity_secret(request)
    }
}

trait LinkedNodeBackend {
    fn create(
        &self,
        payload: &LinkedNodeIdentityMaterial,
    ) -> Result<LinkedNodeIdentityRecord, BackendFailure>;
    fn readiness(&self, id: &str) -> Result<LinkedNodeIdentityReadiness, BackendFailure>;
    fn rotate(
        &self,
        id: &str,
        payload: &LinkedNodeIdentityMaterial,
    ) -> Result<LinkedNodeIdentityRecord, BackendFailure>;
}

#[derive(Debug)]
struct LoopbackBackend {
    client: Client,
    base_url: String,
    token: String,
}

impl LoopbackBackend {
    fn new(base_url: &str, token: &str) -> Result<Self, LinkedNodeLifecycleFailure> {
        let parsed = Url::parse(base_url).map_err(|_| {
            LinkedNodeLifecycleFailure::new(
                "linked_node_identity_backend_url_invalid",
                "backend_connection",
            )
        })?;
        let host = parsed.host_str().unwrap_or_default();
        if parsed.scheme() != "http"
            || !matches!(host, "127.0.0.1" | "localhost" | "::1")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(LinkedNodeLifecycleFailure::new(
                "linked_node_identity_backend_must_be_loopback",
                "backend_connection",
            ));
        }
        if token.trim().is_empty() {
            return Err(LinkedNodeLifecycleFailure::new(
                "linked_node_identity_backend_token_missing",
                "backend_connection",
            ));
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(Policy::none())
            .build()
            .map_err(|_| {
                LinkedNodeLifecycleFailure::new(
                    "linked_node_identity_backend_unavailable",
                    "backend_connection",
                )
            })?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
        })
    }

    fn send<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T, BackendFailure> {
        let response = request.send().map_err(|_| BackendFailure::Unavailable)?;
        if !response.status().is_success() {
            return Err(BackendFailure::Rejected);
        }
        let bytes = response
            .bytes()
            .map_err(|_| BackendFailure::InvalidResponse)?;
        if bytes.len() > MAX_BACKEND_RESPONSE_BYTES {
            return Err(BackendFailure::InvalidResponse);
        }
        serde_json::from_slice(&bytes).map_err(|_| BackendFailure::InvalidResponse)
    }

    fn authorized(&self, request: RequestBuilder) -> RequestBuilder {
        request.bearer_auth(&self.token)
    }
}

impl LinkedNodeBackend for LoopbackBackend {
    fn create(
        &self,
        payload: &LinkedNodeIdentityMaterial,
    ) -> Result<LinkedNodeIdentityRecord, BackendFailure> {
        let envelope: IdentityEnvelope = self.send(
            self.authorized(
                self.client
                    .post(format!("{}/api/linked-node-identities", self.base_url))
                    .json(payload),
            ),
        )?;
        Ok(envelope.identity)
    }

    fn readiness(&self, id: &str) -> Result<LinkedNodeIdentityReadiness, BackendFailure> {
        let envelope: ReadinessEnvelope = self.send(self.authorized(self.client.get(format!(
            "{}/api/linked-node-identities/{id}/readiness",
            self.base_url
        ))))?;
        Ok(envelope.readiness)
    }

    fn rotate(
        &self,
        id: &str,
        payload: &LinkedNodeIdentityMaterial,
    ) -> Result<LinkedNodeIdentityRecord, BackendFailure> {
        let envelope: IdentityEnvelope = self.send(
            self.authorized(
                self.client
                    .post(format!(
                        "{}/api/linked-node-identities/{id}/rotate",
                        self.base_url
                    ))
                    .json(payload),
            ),
        )?;
        Ok(envelope.identity)
    }
}

fn validate_id(value: &str) -> Result<String, LinkedNodeLifecycleFailure> {
    let id = value.trim();
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
    {
        return Err(LinkedNodeLifecycleFailure::new(
            "linked_node_identity_invalid_id",
            "input_validation",
        ));
    }
    Ok(id.to_string())
}

fn vault_failure(error: NodeIdentityError, phase: &str) -> LinkedNodeLifecycleFailure {
    LinkedNodeLifecycleFailure::new(error.code(), phase)
}

fn verify_committed_identity(
    committed: &LinkedNodeIdentityRecord,
    public: &NodeIdentityPublic,
    phase: &str,
) -> Result<(), LinkedNodeLifecycleFailure> {
    if committed.id != public.id
        || committed.key_algorithm != public.key_algorithm
        || committed.public_key != public.public_key
        || committed.public_key_fingerprint != public.public_key_fingerprint
        || committed.secure_key_ref != public.secure_key_ref
        || committed.key_generation != public.key_generation
    {
        return Err(LinkedNodeLifecycleFailure::new(
            "linked_node_identity_backend_contract_mismatch",
            phase,
        ));
    }
    Ok(())
}

fn compensate_new_secret<V: IdentityVault>(
    vault: &V,
    request: &NodeIdentityRequest,
    backend_failure: BackendFailure,
    phase: &str,
    rollback_failure_code: &str,
) -> LinkedNodeLifecycleFailure {
    match vault.delete(request) {
        Ok(deletion) if deletion.deleted => {
            LinkedNodeLifecycleFailure::with_rollback(backend_failure.code(), phase, true)
        }
        Ok(_) | Err(_) => {
            LinkedNodeLifecycleFailure::with_rollback(rollback_failure_code, phase, false)
        }
    }
}

fn create_identity<V: IdentityVault, B: LinkedNodeBackend>(
    vault: &V,
    backend: &B,
    input: CreateLinkedNodeIdentityRequest,
) -> Result<LinkedNodeLifecycleResult, LinkedNodeLifecycleFailure> {
    let id = validate_id(&input.id)?;
    let request = NodeIdentityRequest { id, generation: 1 };
    let public = vault
        .provision(&request)
        .map_err(|error| vault_failure(error, "vault_provision"))?;
    let material = LinkedNodeIdentityMaterial::from_public(&public, input.label);

    let committed = match backend.create(&material) {
        Ok(identity) => identity,
        Err(error) => {
            return Err(compensate_new_secret(
                vault,
                &request,
                error,
                "backend_create",
                "linked_node_identity_create_rollback_failed",
            ))
        }
    };
    verify_committed_identity(&committed, &public, "backend_create_commit")?;

    Ok(LinkedNodeLifecycleResult {
        operation: "create".to_string(),
        identity: committed,
        retired_secret_deleted: None,
        cleanup_required: false,
    })
}

fn rotate_identity<V: IdentityVault, B: LinkedNodeBackend>(
    vault: &V,
    backend: &B,
    input: RotateLinkedNodeIdentityRequest,
) -> Result<LinkedNodeLifecycleResult, LinkedNodeLifecycleFailure> {
    let id = validate_id(&input.id)?;
    let readiness = backend
        .readiness(&id)
        .map_err(|error| LinkedNodeLifecycleFailure::new(error.code(), "backend_readiness"))?;
    if !readiness.ready {
        return Err(LinkedNodeLifecycleFailure::new(
            "linked_node_identity_not_ready",
            format!("backend_readiness:{}", readiness.reason),
        ));
    }
    let current = readiness.identity.ok_or_else(|| {
        LinkedNodeLifecycleFailure::new(
            "linked_node_identity_backend_contract_mismatch",
            "backend_readiness",
        )
    })?;
    if current.id != id {
        return Err(LinkedNodeLifecycleFailure::new(
            "linked_node_identity_backend_contract_mismatch",
            "backend_readiness",
        ));
    }
    let next_generation = current
        .key_generation
        .checked_add(1)
        .filter(|generation| *generation <= MAX_GENERATION)
        .ok_or_else(|| {
            LinkedNodeLifecycleFailure::new(
                "linked_node_identity_invalid_generation",
                "rotation_generation",
            )
        })?;

    let next_request = NodeIdentityRequest {
        id: id.clone(),
        generation: next_generation,
    };
    let public = vault
        .provision(&next_request)
        .map_err(|error| vault_failure(error, "vault_provision_rotation"))?;
    let material = LinkedNodeIdentityMaterial::from_public(&public, current.label.clone());

    let committed = match backend.rotate(&id, &material) {
        Ok(identity) => identity,
        Err(error) => {
            return Err(compensate_new_secret(
                vault,
                &next_request,
                error,
                "backend_rotate",
                "linked_node_identity_rotate_rollback_failed",
            ))
        }
    };
    verify_committed_identity(&committed, &public, "backend_rotate_commit")?;

    let retired_request = NodeIdentityRequest {
        id,
        generation: current.key_generation,
    };
    let (retired_secret_deleted, cleanup_required) = match vault.delete(&retired_request) {
        Ok(deletion) => (deletion.deleted, false),
        Err(_) => (false, true),
    };

    Ok(LinkedNodeLifecycleResult {
        operation: "rotate".to_string(),
        identity: committed,
        retired_secret_deleted: Some(retired_secret_deleted),
        cleanup_required,
    })
}

pub fn create_with_local_backend(
    base_url: &str,
    token: &str,
    input: CreateLinkedNodeIdentityRequest,
) -> Result<LinkedNodeLifecycleResult, LinkedNodeLifecycleFailure> {
    let backend = LoopbackBackend::new(base_url, token)?;
    create_identity(&OsIdentityVault, &backend, input)
}

pub fn rotate_with_local_backend(
    base_url: &str,
    token: &str,
    input: RotateLinkedNodeIdentityRequest,
) -> Result<LinkedNodeLifecycleResult, LinkedNodeLifecycleFailure> {
    let backend = LoopbackBackend::new(base_url, token)?;
    rotate_identity(&OsIdentityVault, &backend, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashSet, sync::Mutex};

    #[derive(Default)]
    struct FakeVault {
        secrets: Mutex<HashSet<String>>,
        fail_delete: Mutex<HashSet<String>>,
    }

    impl FakeVault {
        fn reference(id: &str, generation: u32) -> String {
            format!("forgelink:device-key:{id}:v{generation}")
        }

        fn contains(&self, id: &str, generation: u32) -> bool {
            self.secrets
                .lock()
                .expect("secrets")
                .contains(&Self::reference(id, generation))
        }

        fn insert_existing(&self, id: &str, generation: u32) {
            self.secrets
                .lock()
                .expect("secrets")
                .insert(Self::reference(id, generation));
        }

        fn fail_delete_for(&self, id: &str, generation: u32) {
            self.fail_delete
                .lock()
                .expect("fail delete")
                .insert(Self::reference(id, generation));
        }
    }

    impl IdentityVault for FakeVault {
        fn provision(
            &self,
            request: &NodeIdentityRequest,
        ) -> Result<NodeIdentityPublic, NodeIdentityError> {
            let reference = Self::reference(&request.id, request.generation);
            let mut secrets = self.secrets.lock().expect("secrets");
            if !secrets.insert(reference.clone()) {
                return Err(NodeIdentityError::AlreadyExists);
            }
            let marker = if request.generation % 2 == 0 {
                "B"
            } else {
                "A"
            };
            Ok(NodeIdentityPublic {
                id: request.id.clone(),
                key_algorithm: "ed25519".to_string(),
                public_key: marker.repeat(43),
                public_key_fingerprint: format!("sha256:{}", marker.repeat(43)),
                secure_key_ref: reference,
                key_generation: request.generation,
            })
        }

        fn delete(
            &self,
            request: &NodeIdentityRequest,
        ) -> Result<NodeIdentitySecretDeletion, NodeIdentityError> {
            let reference = Self::reference(&request.id, request.generation);
            if self
                .fail_delete
                .lock()
                .expect("fail delete")
                .contains(&reference)
            {
                return Err(NodeIdentityError::StorageUnavailable);
            }
            Ok(NodeIdentitySecretDeletion {
                deleted: self.secrets.lock().expect("secrets").remove(&reference),
                secure_key_ref: reference,
            })
        }
    }

    struct FakeBackend {
        readiness: LinkedNodeIdentityReadiness,
        fail_create: bool,
        fail_rotate: bool,
        mismatch_create: bool,
        mismatch_rotate: bool,
        created: Mutex<Vec<LinkedNodeIdentityMaterial>>,
        rotated: Mutex<Vec<LinkedNodeIdentityMaterial>>,
    }

    impl FakeBackend {
        fn new(readiness: LinkedNodeIdentityReadiness) -> Self {
            Self {
                readiness,
                fail_create: false,
                fail_rotate: false,
                mismatch_create: false,
                mismatch_rotate: false,
                created: Mutex::new(Vec::new()),
                rotated: Mutex::new(Vec::new()),
            }
        }

        fn record(payload: &LinkedNodeIdentityMaterial) -> LinkedNodeIdentityRecord {
            LinkedNodeIdentityRecord {
                id: payload.id.clone(),
                label: payload.label.clone(),
                public_key: payload.public_key.clone(),
                trust_state: "active".to_string(),
                key_algorithm: payload.key_algorithm.clone(),
                public_key_fingerprint: payload.public_key_fingerprint.clone(),
                secure_key_ref: payload.secure_key_ref.clone(),
                key_generation: payload.key_generation,
                recovery_state: "ready".to_string(),
                revocation_reason: String::new(),
                replaced_by_device_id: String::new(),
            }
        }
    }

    impl LinkedNodeBackend for FakeBackend {
        fn create(
            &self,
            payload: &LinkedNodeIdentityMaterial,
        ) -> Result<LinkedNodeIdentityRecord, BackendFailure> {
            if self.fail_create {
                return Err(BackendFailure::Rejected);
            }
            self.created.lock().expect("created").push(payload.clone());
            let mut record = Self::record(payload);
            if self.mismatch_create {
                record.secure_key_ref.push_str(":mismatch");
            }
            Ok(record)
        }

        fn readiness(&self, _id: &str) -> Result<LinkedNodeIdentityReadiness, BackendFailure> {
            Ok(self.readiness.clone())
        }

        fn rotate(
            &self,
            _id: &str,
            payload: &LinkedNodeIdentityMaterial,
        ) -> Result<LinkedNodeIdentityRecord, BackendFailure> {
            if self.fail_rotate {
                return Err(BackendFailure::Rejected);
            }
            self.rotated.lock().expect("rotated").push(payload.clone());
            let mut record = Self::record(payload);
            if self.mismatch_rotate {
                record.secure_key_ref.push_str(":mismatch");
            }
            Ok(record)
        }
    }

    fn current_identity(id: &str, generation: u32) -> LinkedNodeIdentityRecord {
        LinkedNodeIdentityRecord {
            id: id.to_string(),
            label: "Primary desktop".to_string(),
            public_key: "A".repeat(43),
            trust_state: "active".to_string(),
            key_algorithm: "ed25519".to_string(),
            public_key_fingerprint: format!("sha256:{}", "A".repeat(43)),
            secure_key_ref: FakeVault::reference(id, generation),
            key_generation: generation,
            recovery_state: "ready".to_string(),
            revocation_reason: String::new(),
            replaced_by_device_id: String::new(),
        }
    }

    fn ready(id: &str, generation: u32) -> LinkedNodeIdentityReadiness {
        LinkedNodeIdentityReadiness {
            ready: true,
            reason: "ready".to_string(),
            identity: Some(current_identity(id, generation)),
        }
    }

    #[test]
    fn create_rolls_back_new_secret_when_backend_rejects() {
        let vault = FakeVault::default();
        let mut backend = FakeBackend::new(ready("unused", 1));
        backend.fail_create = true;

        let failure = create_identity(
            &vault,
            &backend,
            CreateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
                label: "Primary desktop".to_string(),
            },
        )
        .expect_err("backend rejection");

        assert_eq!(failure.code, "linked_node_identity_backend_rejected");
        assert!(failure.rollback_attempted);
        assert_eq!(failure.rollback_succeeded, Some(true));
        assert!(!vault.contains("desktop-primary", 1));
    }

    #[test]
    fn committed_create_contract_mismatch_preserves_new_secret_without_rollback() {
        let vault = FakeVault::default();
        let mut backend = FakeBackend::new(ready("unused", 1));
        backend.mismatch_create = true;

        let failure = create_identity(
            &vault,
            &backend,
            CreateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
                label: "Primary desktop".to_string(),
            },
        )
        .expect_err("backend contract mismatch");

        assert_eq!(
            failure.code,
            "linked_node_identity_backend_contract_mismatch"
        );
        assert_eq!(failure.phase, "backend_create_commit");
        assert!(!failure.rollback_attempted);
        assert_eq!(failure.rollback_succeeded, None);
        assert!(vault.contains("desktop-primary", 1));
    }

    #[test]
    fn create_reports_failed_compensation_without_hiding_it() {
        let vault = FakeVault::default();
        vault.fail_delete_for("desktop-primary", 1);
        let mut backend = FakeBackend::new(ready("unused", 1));
        backend.fail_create = true;

        let failure = create_identity(
            &vault,
            &backend,
            CreateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
                label: String::new(),
            },
        )
        .expect_err("rollback failure");

        assert_eq!(failure.code, "linked_node_identity_create_rollback_failed");
        assert_eq!(failure.rollback_succeeded, Some(false));
        assert!(vault.contains("desktop-primary", 1));
    }

    #[test]
    fn committed_rotation_contract_mismatch_preserves_both_generations() {
        let vault = FakeVault::default();
        vault.insert_existing("desktop-primary", 1);
        let mut backend = FakeBackend::new(ready("desktop-primary", 1));
        backend.mismatch_rotate = true;

        let failure = rotate_identity(
            &vault,
            &backend,
            RotateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
            },
        )
        .expect_err("backend contract mismatch");

        assert_eq!(
            failure.code,
            "linked_node_identity_backend_contract_mismatch"
        );
        assert_eq!(failure.phase, "backend_rotate_commit");
        assert!(!failure.rollback_attempted);
        assert_eq!(failure.rollback_succeeded, None);
        assert!(vault.contains("desktop-primary", 1));
        assert!(vault.contains("desktop-primary", 2));
    }

    #[test]
    fn rotation_provisions_next_generation_and_retires_old_secret() {
        let vault = FakeVault::default();
        vault.insert_existing("desktop-primary", 1);
        let backend = FakeBackend::new(ready("desktop-primary", 1));

        let result = rotate_identity(
            &vault,
            &backend,
            RotateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
            },
        )
        .expect("rotate");

        assert_eq!(result.identity.key_generation, 2);
        assert_eq!(result.retired_secret_deleted, Some(true));
        assert!(!result.cleanup_required);
        assert!(!vault.contains("desktop-primary", 1));
        assert!(vault.contains("desktop-primary", 2));
    }

    #[test]
    fn rotation_rolls_back_new_secret_when_backend_rejects() {
        let vault = FakeVault::default();
        vault.insert_existing("desktop-primary", 1);
        let mut backend = FakeBackend::new(ready("desktop-primary", 1));
        backend.fail_rotate = true;

        let failure = rotate_identity(
            &vault,
            &backend,
            RotateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
            },
        )
        .expect_err("backend rejection");

        assert_eq!(failure.code, "linked_node_identity_backend_rejected");
        assert_eq!(failure.rollback_succeeded, Some(true));
        assert!(vault.contains("desktop-primary", 1));
        assert!(!vault.contains("desktop-primary", 2));
    }

    #[test]
    fn committed_rotation_reports_old_secret_cleanup_failure() {
        let vault = FakeVault::default();
        vault.insert_existing("desktop-primary", 1);
        vault.fail_delete_for("desktop-primary", 1);
        let backend = FakeBackend::new(ready("desktop-primary", 1));

        let result = rotate_identity(
            &vault,
            &backend,
            RotateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
            },
        )
        .expect("rotation remains committed");

        assert_eq!(result.identity.key_generation, 2);
        assert_eq!(result.retired_secret_deleted, Some(false));
        assert!(result.cleanup_required);
        assert!(vault.contains("desktop-primary", 1));
        assert!(vault.contains("desktop-primary", 2));
    }

    #[test]
    fn non_ready_identity_is_denied_before_vault_mutation() {
        let vault = FakeVault::default();
        let backend = FakeBackend::new(LinkedNodeIdentityReadiness {
            ready: false,
            reason: "revoked".to_string(),
            identity: Some(current_identity("desktop-primary", 1)),
        });

        let failure = rotate_identity(
            &vault,
            &backend,
            RotateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
            },
        )
        .expect_err("not ready");

        assert_eq!(failure.code, "linked_node_identity_not_ready");
        assert!(!vault.contains("desktop-primary", 2));
    }

    #[test]
    fn lifecycle_results_serialize_without_private_key_material() {
        let vault = FakeVault::default();
        let backend = FakeBackend::new(ready("unused", 1));
        let result = create_identity(
            &vault,
            &backend,
            CreateLinkedNodeIdentityRequest {
                id: "desktop-primary".to_string(),
                label: "Primary desktop".to_string(),
            },
        )
        .expect("create");

        let serialized = serde_json::to_string(&result).expect("serialize");
        assert!(!serialized.contains("private_key"));
        assert!(!serialized.contains("secret_key"));
        assert!(!serialized.contains("seed"));
        assert!(serialized.contains("secure_key_ref"));
    }

    #[test]
    fn backend_client_rejects_non_loopback_urls() {
        let failure = LoopbackBackend::new("https://example.com", "token")
            .expect_err("remote backend must fail");
        assert_eq!(
            failure.code,
            "linked_node_identity_backend_must_be_loopback"
        );
    }
}
