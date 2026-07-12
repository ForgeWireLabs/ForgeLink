use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use rand_core::{OsRng, RngCore};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use zeroize::Zeroizing;

const KEY_ALGORITHM: &str = "ed25519";
const MAX_GENERATION: u32 = 1_000_000;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const KEYRING_SERVICE: &str = "com.forgewirelabs.forgelink.identity-vault";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const KEYRING_ACCOUNT: &str = "linked-node-vault-wrapping-key-v1";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const IDENTITY_VAULT_DIR_ENV: &str = "FORGELINK_IDENTITY_VAULT_DIR";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const LOCAL_ROOT_ENV: &str = "FORGELINK_LOCAL_ROOT";
#[cfg(target_os = "windows")]
const DEFAULT_WINDOWS_LOCAL_ROOT: &str = r"C:\Projects\ForgeLink-local";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VAULT_MAGIC: &[u8; 8] = b"FLNIV001";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const VAULT_NONCE_BYTES: usize = 12;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const PRIVATE_KEY_BYTES: usize = 32;

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
trait WrappingKeyProvider {
    fn load(&self) -> Result<Zeroizing<Vec<u8>>, NodeIdentityError>;
    fn load_or_create(&self) -> Result<Zeroizing<Vec<u8>>, NodeIdentityError>;
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct OsWrappingKeyProvider;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl OsWrappingKeyProvider {
    fn entry() -> Result<keyring::v1::Entry, NodeIdentityError> {
        keyring::v1::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|_| NodeIdentityError::StorageUnavailable)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl WrappingKeyProvider for OsWrappingKeyProvider {
    fn load(&self) -> Result<Zeroizing<Vec<u8>>, NodeIdentityError> {
        match Self::entry()?.get_secret() {
            Ok(secret) if secret.len() == PRIVATE_KEY_BYTES => Ok(Zeroizing::new(secret)),
            Ok(_) | Err(_) => Err(NodeIdentityError::StorageUnavailable),
        }
    }

    fn load_or_create(&self) -> Result<Zeroizing<Vec<u8>>, NodeIdentityError> {
        let entry = Self::entry()?;
        match entry.get_secret() {
            Ok(secret) if secret.len() == PRIVATE_KEY_BYTES => Ok(Zeroizing::new(secret)),
            Ok(_) => Err(NodeIdentityError::StorageUnavailable),
            Err(keyring::v1::Error::NoEntry) => {
                let mut secret = Zeroizing::new(vec![0_u8; PRIVATE_KEY_BYTES]);
                OsRng.fill_bytes(secret.as_mut_slice());
                entry
                    .set_secret(secret.as_slice())
                    .map_err(|_| NodeIdentityError::StorageUnavailable)?;
                Ok(secret)
            }
            Err(_) => Err(NodeIdentityError::StorageUnavailable),
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct EncryptedFileSecretStore<P> {
    directory: PathBuf,
    wrapping_keys: P,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl<P: WrappingKeyProvider> EncryptedFileSecretStore<P> {
    fn new(directory: PathBuf, wrapping_keys: P) -> Result<Self, NodeIdentityError> {
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(NodeIdentityError::StorageUnavailable);
        }
        Ok(Self {
            directory,
            wrapping_keys,
        })
    }

    fn path_for(&self, secure_key_ref: &str) -> PathBuf {
        let digest = Sha256::digest(secure_key_ref.as_bytes());
        let file_name = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.directory.join(format!("{file_name}.flkey"))
    }

    fn existing_cipher(&self) -> Result<Aes256Gcm, NodeIdentityError> {
        let key = self.wrapping_keys.load()?;
        Aes256Gcm::new_from_slice(key.as_slice()).map_err(|_| NodeIdentityError::StorageUnavailable)
    }

    fn creation_cipher(&self) -> Result<Aes256Gcm, NodeIdentityError> {
        let key = self.wrapping_keys.load_or_create()?;
        Aes256Gcm::new_from_slice(key.as_slice()).map_err(|_| NodeIdentityError::StorageUnavailable)
    }

    fn read_secret(
        &self,
        secure_key_ref: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, NodeIdentityError> {
        let path = self.path_for(secure_key_ref);
        let blob = match fs::read(path) {
            Ok(blob) => blob,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(NodeIdentityError::StorageUnavailable),
        };
        if blob.len() < VAULT_MAGIC.len() + VAULT_NONCE_BYTES + 16
            || &blob[..VAULT_MAGIC.len()] != VAULT_MAGIC
        {
            return Err(NodeIdentityError::StorageUnavailable);
        }

        let nonce_start = VAULT_MAGIC.len();
        let ciphertext_start = nonce_start + VAULT_NONCE_BYTES;
        let nonce = Nonce::from_slice(&blob[nonce_start..ciphertext_start]);
        let cipher = self.existing_cipher()?;
        let cleartext = cipher
            .decrypt(
                nonce,
                Payload {
                    msg: &blob[ciphertext_start..],
                    aad: secure_key_ref.as_bytes(),
                },
            )
            .map_err(|_| NodeIdentityError::StorageUnavailable)?;
        if cleartext.len() != PRIVATE_KEY_BYTES {
            return Err(NodeIdentityError::StorageUnavailable);
        }
        Ok(Some(Zeroizing::new(cleartext)))
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl<P: WrappingKeyProvider> SecretStore for EncryptedFileSecretStore<P> {
    fn contains(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError> {
        Ok(self.read_secret(secure_key_ref)?.is_some())
    }

    fn create(&self, secure_key_ref: &str, secret: &[u8]) -> Result<(), NodeIdentityError> {
        if secret.len() != PRIVATE_KEY_BYTES {
            return Err(NodeIdentityError::StorageUnavailable);
        }

        let path = self.path_for(secure_key_ref);
        let cipher = self.creation_cipher()?;
        let mut nonce_bytes = [0_u8; VAULT_NONCE_BYTES];
        OsRng.fill_bytes(&mut nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: secret,
                    aad: secure_key_ref.as_bytes(),
                },
            )
            .map_err(|_| NodeIdentityError::StorageUnavailable)?;

        let mut blob = Vec::with_capacity(VAULT_MAGIC.len() + nonce_bytes.len() + ciphertext.len());
        blob.extend_from_slice(VAULT_MAGIC);
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);

        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }

        let mut file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(NodeIdentityError::AlreadyExists)
            }
            Err(_) => return Err(NodeIdentityError::StorageUnavailable),
        };

        if file.write_all(&blob).and_then(|_| file.sync_all()).is_err() {
            drop(file);
            let _ = fs::remove_file(path);
            return Err(NodeIdentityError::StorageUnavailable);
        }
        Ok(())
    }

    fn delete(&self, secure_key_ref: &str) -> Result<bool, NodeIdentityError> {
        match fs::remove_file(self.path_for(secure_key_ref)) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(NodeIdentityError::StorageUnavailable),
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn configured_vault_dir() -> Result<PathBuf, NodeIdentityError> {
    if let Ok(value) = env::var(IDENTITY_VAULT_DIR_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    if let Ok(value) = env::var(LOCAL_ROOT_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(Path::new(trimmed)
                .join("keys")
                .join("linked-node-identities"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        return Ok(Path::new(DEFAULT_WINDOWS_LOCAL_ROOT)
            .join("keys")
            .join("linked-node-identities"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(NodeIdentityError::StorageUnavailable)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn os_secret_store() -> Result<EncryptedFileSecretStore<OsWrappingKeyProvider>, NodeIdentityError> {
    EncryptedFileSecretStore::new(configured_vault_dir()?, OsWrappingKeyProvider)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn provision_os_identity(
    request: &NodeIdentityRequest,
) -> Result<NodeIdentityPublic, NodeIdentityError> {
    let mut rng = OsRng;
    let signing_key = SigningKey::generate(&mut rng);
    let secret = Zeroizing::new(signing_key.to_bytes());
    provision_with_secret(&os_secret_store()?, request, &secret)
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
    delete_with_store(&os_secret_store()?, request)
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
    use std::{
        collections::HashMap,
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

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

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    struct FixedWrappingKeyProvider([u8; PRIVATE_KEY_BYTES]);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    impl WrappingKeyProvider for FixedWrappingKeyProvider {
        fn load(&self) -> Result<Zeroizing<Vec<u8>>, NodeIdentityError> {
            Ok(Zeroizing::new(self.0.to_vec()))
        }

        fn load_or_create(&self) -> Result<Zeroizing<Vec<u8>>, NodeIdentityError> {
            self.load()
        }
    }

    fn request(id: &str, generation: u32) -> NodeIdentityRequest {
        NodeIdentityRequest {
            id: id.to_string(),
            generation,
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    fn test_vault_dir() -> PathBuf {
        let marker = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = env::temp_dir().join(format!(
            "forgelink-node-identity-{}-{marker}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("create test vault");
        directory
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

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn encrypted_file_store_keeps_identity_secret_in_the_local_vault() {
        let directory = test_vault_dir();
        let store = EncryptedFileSecretStore::new(
            directory.clone(),
            FixedWrappingKeyProvider([91_u8; PRIVATE_KEY_BYTES]),
        )
        .expect("file store");
        let reference = "forgelink:device-key:desktop-primary:v1";
        let seed = [41_u8; PRIVATE_KEY_BYTES];

        store
            .create(reference, &seed)
            .expect("create encrypted key");
        assert!(store.contains(reference).expect("read encrypted key"));

        let path = store.path_for(reference);
        assert_eq!(path.parent(), Some(directory.as_path()));
        assert!(!path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .contains("desktop-primary"));

        let blob = fs::read(&path).expect("read encrypted blob");
        assert!(blob.starts_with(VAULT_MAGIC));
        assert!(!blob
            .windows(seed.len())
            .any(|window| window == seed.as_slice()));
        assert_eq!(
            store
                .read_secret(reference)
                .expect("decrypt blob")
                .expect("secret exists")
                .as_slice(),
            seed.as_slice()
        );

        assert!(store.delete(reference).expect("delete encrypted key"));
        assert!(!store.contains(reference).expect("missing after delete"));
        fs::remove_dir_all(directory).expect("remove test vault");
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn encrypted_file_store_fails_closed_for_tampered_ciphertext() {
        let directory = test_vault_dir();
        let store = EncryptedFileSecretStore::new(
            directory.clone(),
            FixedWrappingKeyProvider([17_u8; PRIVATE_KEY_BYTES]),
        )
        .expect("file store");
        let reference = "forgelink:device-key:desktop-primary:v2";

        store
            .create(reference, &[52_u8; PRIVATE_KEY_BYTES])
            .expect("create encrypted key");
        let path = store.path_for(reference);
        let mut blob = fs::read(&path).expect("read encrypted blob");
        let last = blob.last_mut().expect("ciphertext");
        *last ^= 0x01;
        fs::write(&path, blob).expect("tamper encrypted blob");

        assert_eq!(
            store.contains(reference).expect_err("tampering must fail"),
            NodeIdentityError::StorageUnavailable
        );
        fs::remove_dir_all(directory).expect("remove test vault");
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
