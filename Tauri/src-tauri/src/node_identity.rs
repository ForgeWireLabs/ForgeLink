use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::SigningKey;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const KEY_ALGORITHM: &str = "ed25519";
const KEYRING_SERVICE: &str = "com.forgewirelabs.forgelink.device-key";
const MAX_GENERATION: u32 = 1_000_000;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct NodeIdentityRequest {
    pub id: String,
    pub generation: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NodeIdentityPublic {
    pub id: String,
    pub key_algorithm: String,
    pub public_key: String,
    pub public_key_fingerprint: String,
    pub secure_key_ref: String,
    pub key_generation: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NodeIdentitySecretDeletion {
    pub secure_key_ref: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeIdentityError {
    InvalidId,
    InvalidGeneration,
    AlreadyExists,
    StorageUnavailable,
    #[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(dead_code))]
    UnsupportedPlatform,
}

impl NodeIdentityError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidId => "linked_node_identity_invalid_id",
            Self::InvalidGeneration => "linked_node_identity_invalid_generation",
            Self::AlreadyExists => "linked_node_identity_already_exists",
            Self::StorageUnavailable => "linked_node_identity_storage_unavailable",
            Self::UnsupportedPlatform => "linked_node_identity_platform_unsupported",
        }
    }
}

trait SecretStore {
    fn contains(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError>;
    fn create(&self, secure_key_ref: &str, secret: &[u8]) -> Result<(), NodeIdentityError>;
    fn delete(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError>;
}

fn validate_request(request: &NodeIdentityRequest) -> Result<String, NodeIdentityError> {
    let id = request.id.trim();
    if id.is_empty()
        || id.len() > 80
        || !id.bytes().all(|value| {
            value.is_ascii_alphanumeric() || matches!(value, b'_' | b'.' | b':' | b'-')
        })
    {
        return Err(NodeIdentityError::InvalidId);
    }
    if request.generation == 0 || request.generation > MAX_GENERATION {
        return Err(NodeIdentityError::InvalidGeneration);
    }
    Ok(id.to_string())
}

fn secure_key_ref(id: &str, generation: u32) -> String {
    format!("forgelink:device-key:{id}:v{generation}")
}

fn provision_with_secret(
    store: &impl SecretStore,
    request: &NodeIdentityRequest,
    secret: &[u8; 32],
) -> Result<NodeIdentityPublic, NodeIdentityError> {
    let id = validate_request(request)?;
    let reference = secure_key_ref(&id, request.generation);
    if store.contains(&reference)? {
        return Err(NodeIdentityError::AlreadyExists);
    }

    let signing_key = SigningKey::from_bytes(secret);
    let public_bytes = signing_key.verifying_key().to_bytes();
    let public_key = URL_SAFE_NO_PAD.encode(public_bytes);
    let fingerprint = URL_SAFE_NO_PAD.encode(Sha256::digest(public_bytes));
    store.create(&reference, secret)?;

    Ok(NodeIdentityPublic {
        id,
        key_algorithm: KEY_ALGORITHM.to_string(),
        public_key,
        public_key_fingerprint: format!("sha256:{fingerprint}"),
        secure_key_ref: reference,
        key_generation: request.generation,
    })
}

fn delete_with_store(
    store: &impl SecretStore,
    request: &NodeIdentityRequest,
) -> Result<NodeIdentitySecretDeletion, NodeIdentityError> {
    let id = validate_request(request)?;
    let reference = secure_key_ref(&id, request.generation);
    Ok(NodeIdentitySecretDeletion {
        deleted: store.delete(&reference)?,
        secure_key_ref: reference,
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct OsSecretStore;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl OsSecretStore {
    fn entry(secure_key_ref: &str) -> Result<keyring::v1::Entry, NodeIdentityError> {
        keyring::v1::Entry::new(KEYRING_SERVICE, secure_key_ref)
            .map_err(|_| NodeIdentityError::StorageUnavailable)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl SecretStore for OsSecretStore {
    fn contains(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError> {
        let entry = Self::entry(secure_key_ref)?;
        match entry.get_secret() {
            Ok(secret) => {
                let _secret = Zeroizing::new(secret);
                Ok(true)
            }
            Err(keyring::v1::Error::NoEntry) => Ok(false),
            Err(_) => Err(NodeIdentityError::StorageUnavailable),
        }
    }

    fn create(&self, secure_key_ref: &str, secret: &[u8]) -> Result<(), NodeIdentityError> {
        Self::entry(secure_key_ref)?
            .set_secret(secret)
            .map_err(|_| NodeIdentityError::StorageUnavailable)
    }

    fn delete(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError> {
        match Self::entry(secure_key_ref)?.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::v1::Error::NoEntry) => Ok(false),
            Err(_) => Err(NodeIdentityError::StorageUnavailable),
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn provision_os_identity(
    request: &NodeIdentityRequest,
) -> Result<NodeIdentityPublic, NodeIdentityError> {
    let mut rng = OsRng;
    let signing_key = SigningKey::generate(&mut rng);
    let secret = Zeroizing::new(signing_key.to_bytes());
    provision_with_secret(&OsSecretStore, request, &secret)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn provision_os_identity(
    _request: &NodeIdentityRequest,
) -> Result<NodeIdentityPublic, NodeIdentityError> {
    Err(NodeIdentityError::UnsupportedPlatform)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn delete_os_identity_secret(
    request: &NodeIdentityRequest,
) -> Result<NodeIdentitySecretDeletion, NodeIdentityError> {
    delete_with_store(&OsSecretStore, request)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn delete_os_identity_secret(
    _request: &NodeIdentityRequest,
) -> Result<NodeIdentitySecretDeletion, NodeIdentityError> {
    Err(NodeIdentityError::UnsupportedPlatform)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};

    #[derive(Default)]
    struct MemorySecretStore {
        secrets: Mutex<HashMap<String, Vec<u8>>>,
    }

    impl SecretStore for MemorySecretStore {
        fn contains(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError> {
            Ok(self
                .secrets
                .lock()
                .expect("memory store")
                .contains_key(secure_key_ref))
        }

        fn create(&self, secure_key_ref: &str, secret: &[u8]) -> Result<(), NodeIdentityError> {
            let mut secrets = self.secrets.lock().expect("memory store");
            if secrets.contains_key(secure_key_ref) {
                return Err(NodeIdentityError::AlreadyExists);
            }
            secrets.insert(secure_key_ref.to_string(), secret.to_vec());
            Ok(())
        }

        fn delete(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError> {
            Ok(self
                .secrets
                .lock()
                .expect("memory store")
                .remove(secure_key_ref)
                .is_some())
        }
    }

    fn request(id: &str, generation: u32) -> NodeIdentityRequest {
        NodeIdentityRequest {
            id: id.to_string(),
            generation,
        }
    }

    #[test]
    fn provisions_public_metadata_without_serializing_private_key_material() {
        let store = MemorySecretStore::default();
        let seed = [7_u8; 32];
        let identity = provision_with_secret(&store, &request("desktop-primary", 1), &seed)
            .expect("provision identity");

        assert_eq!(identity.key_algorithm, "ed25519");
        assert_eq!(identity.key_generation, 1);
        assert_eq!(
            identity.secure_key_ref,
            "forgelink:device-key:desktop-primary:v1"
        );
        assert_eq!(identity.public_key.len(), 43);
        assert_eq!(identity.public_key_fingerprint.len(), 50);

        let serialized = serde_json::to_string(&identity).expect("serialize public identity");
        assert!(!serialized.contains("private_key"));
        assert!(!serialized.contains(&URL_SAFE_NO_PAD.encode(seed)));
        assert!(store
            .secrets
            .lock()
            .expect("memory store")
            .contains_key(&identity.secure_key_ref));
    }

    #[test]
    fn creation_is_insert_only() {
        let store = MemorySecretStore::default();
        let identity = provision_with_secret(&store, &request("desktop-primary", 1), &[11; 32])
            .expect("first provision");
        assert_eq!(
            provision_with_secret(&store, &request("desktop-primary", 1), &[12; 32])
                .expect_err("duplicate must fail"),
            NodeIdentityError::AlreadyExists
        );
        assert_eq!(
            store
                .secrets
                .lock()
                .expect("memory store")
                .get(&identity.secure_key_ref)
                .cloned(),
            Some(vec![11; 32])
        );
    }

    #[test]
    fn rotation_and_generation_scoped_deletion_are_bounded() {
        let store = MemorySecretStore::default();
        let one = provision_with_secret(&store, &request("desktop-primary", 1), &[21; 32])
            .expect("generation one");
        let two = provision_with_secret(&store, &request("desktop-primary", 2), &[22; 32])
            .expect("generation two");
        assert_ne!(one.public_key, two.public_key);

        assert!(
            delete_with_store(&store, &request("desktop-primary", 1))
                .expect("delete generation one")
                .deleted
        );
        assert!(!store
            .secrets
            .lock()
            .expect("memory store")
            .contains_key(&one.secure_key_ref));
        assert!(store
            .secrets
            .lock()
            .expect("memory store")
            .contains_key(&two.secure_key_ref));
        assert!(
            !delete_with_store(&store, &request("desktop-primary", 1))
                .expect("repeat delete")
                .deleted
        );
    }

    #[test]
    fn invalid_inputs_fail_before_storage_access() {
        let store = MemorySecretStore::default();
        assert_eq!(
            provision_with_secret(&store, &request("../unsafe", 1), &[31; 32])
                .expect_err("invalid id"),
            NodeIdentityError::InvalidId
        );
        assert_eq!(
            provision_with_secret(&store, &request("desktop-primary", 0), &[31; 32])
                .expect_err("invalid generation"),
            NodeIdentityError::InvalidGeneration
        );
        assert!(store.secrets.lock().expect("memory store").is_empty());
    }

    #[test]
    fn public_errors_are_fixed_and_redacted() {
        assert_eq!(
            NodeIdentityError::StorageUnavailable.code(),
            "linked_node_identity_storage_unavailable"
        );
        assert_eq!(
            NodeIdentityError::UnsupportedPlatform.code(),
            "linked_node_identity_platform_unsupported"
        );
    }
}
