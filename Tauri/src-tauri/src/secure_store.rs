//! Shared protected-secret storage for the desktop shell.
//!
//! The store deliberately keeps the keyring wrapping key separate from the
//! encrypted files.  File names are hashes of validated opaque references, so
//! neither a provider name nor an operator supplied identifier becomes a path.
//! Secret bytes are only returned as `Zeroizing` buffers and are never part of
//! a serializable status shape.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

pub const KEY_BYTES: usize = 32;
pub const NONCE_BYTES: usize = 12;
pub const DEFAULT_MAGIC: &[u8; 8] = b"FLNIV001";
pub const PROTECTED_SETTINGS_MAGIC: &[u8; 8] = b"FLPSV001";

#[cfg(windows)]
pub(crate) fn move_file(
    source: &Path,
    destination: &Path,
    replace: bool,
) -> Result<(), SecureStoreError> {
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let flags = windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH
        | if replace {
            windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
        } else {
            0
        };
    let moved = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            flags,
        )
    };
    if moved == 0 {
        Err(SecureStoreError::Unavailable)
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub(crate) fn move_file(
    source: &Path,
    destination: &Path,
    _replace: bool,
) -> Result<(), SecureStoreError> {
    std::fs::rename(source, destination).map_err(|_| SecureStoreError::Unavailable)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecureStoreError {
    InvalidReference,
    AlreadyExists,
    Unavailable,
    Corrupt,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub trait WrappingKeyProvider: Send + Sync {
    fn load(&self) -> Result<Zeroizing<Vec<u8>>, SecureStoreError>;
    fn load_or_create(&self) -> Result<Zeroizing<Vec<u8>>, SecureStoreError>;
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub struct OsWrappingKeyProvider {
    service: &'static str,
    account: &'static str,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl OsWrappingKeyProvider {
    pub const fn new(service: &'static str, account: &'static str) -> Self {
        Self { service, account }
    }

    fn entry(&self) -> Result<keyring::v1::Entry, SecureStoreError> {
        keyring::v1::Entry::new(self.service, self.account)
            .map_err(|_| SecureStoreError::Unavailable)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl WrappingKeyProvider for OsWrappingKeyProvider {
    fn load(&self) -> Result<Zeroizing<Vec<u8>>, SecureStoreError> {
        match self.entry()?.get_secret() {
            Ok(secret) if secret.len() == KEY_BYTES => Ok(Zeroizing::new(secret)),
            Ok(_) | Err(_) => Err(SecureStoreError::Unavailable),
        }
    }

    fn load_or_create(&self) -> Result<Zeroizing<Vec<u8>>, SecureStoreError> {
        let entry = self.entry()?;
        match entry.get_secret() {
            Ok(secret) if secret.len() == KEY_BYTES => Ok(Zeroizing::new(secret)),
            Ok(_) => Err(SecureStoreError::Unavailable),
            Err(keyring::v1::Error::NoEntry) => {
                let mut secret = Zeroizing::new(vec![0_u8; KEY_BYTES]);
                OsRng.fill_bytes(secret.as_mut_slice());
                entry
                    .set_secret(secret.as_slice())
                    .map_err(|_| SecureStoreError::Unavailable)?;
                Ok(secret)
            }
            Err(_) => Err(SecureStoreError::Unavailable),
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub struct EncryptedFileSecretStore<P> {
    directory: PathBuf,
    wrapping_keys: P,
    magic: [u8; 8],
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl<P: WrappingKeyProvider> EncryptedFileSecretStore<P> {
    pub fn new(directory: PathBuf, wrapping_keys: P) -> Result<Self, SecureStoreError> {
        Self::with_magic(directory, wrapping_keys, DEFAULT_MAGIC)
    }

    pub fn with_magic(
        directory: PathBuf,
        wrapping_keys: P,
        magic: &[u8; 8],
    ) -> Result<Self, SecureStoreError> {
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(SecureStoreError::Unavailable);
        }
        Ok(Self {
            directory,
            wrapping_keys,
            magic: *magic,
        })
    }

    pub fn path_for(&self, secure_key_ref: &str) -> PathBuf {
        let digest = Sha256::digest(secure_key_ref.as_bytes());
        let file_name = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.directory.join(format!("{file_name}.flkey"))
    }

    fn validate_reference(secure_key_ref: &str) -> Result<(), SecureStoreError> {
        if secure_key_ref.len() < 12
            || secure_key_ref.len() > 240
            || !secure_key_ref.starts_with("forgelink:")
            || secure_key_ref.bytes().any(|byte| {
                !byte.is_ascii_alphanumeric() && !matches!(byte, b'_' | b'.' | b':' | b'-')
            })
            || secure_key_ref.contains("..")
        {
            return Err(SecureStoreError::InvalidReference);
        }
        Ok(())
    }

    fn existing_cipher(&self) -> Result<Aes256Gcm, SecureStoreError> {
        let key = self.wrapping_keys.load()?;
        Aes256Gcm::new_from_slice(key.as_slice()).map_err(|_| SecureStoreError::Unavailable)
    }

    fn creation_cipher(&self) -> Result<Aes256Gcm, SecureStoreError> {
        let key = self.wrapping_keys.load_or_create()?;
        Aes256Gcm::new_from_slice(key.as_slice()).map_err(|_| SecureStoreError::Unavailable)
    }

    pub fn read_secret(
        &self,
        secure_key_ref: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, SecureStoreError> {
        Self::validate_reference(secure_key_ref)?;
        let path = self.path_for(secure_key_ref);
        let blob = match fs::read(path) {
            Ok(blob) => blob,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(SecureStoreError::Unavailable),
        };
        if blob.len() < self.magic.len() + NONCE_BYTES + 16
            || blob[..self.magic.len()] != self.magic
        {
            return Err(SecureStoreError::Corrupt);
        }

        let nonce_start = self.magic.len();
        let ciphertext_start = nonce_start + NONCE_BYTES;
        let nonce = Nonce::from_slice(&blob[nonce_start..ciphertext_start]);
        let cipher = self
            .existing_cipher()
            .map_err(|_| SecureStoreError::Unavailable)?;
        let cleartext = cipher
            .decrypt(
                nonce,
                Payload {
                    msg: &blob[ciphertext_start..],
                    aad: secure_key_ref.as_bytes(),
                },
            )
            .map_err(|_| SecureStoreError::Corrupt)?;
        Ok(Some(Zeroizing::new(cleartext)))
    }

    pub fn contains(&self, secure_key_ref: &str) -> Result<bool, SecureStoreError> {
        Ok(self.read_secret(secure_key_ref)?.is_some())
    }

    /// Insert one secret. Rotation uses a new reference and metadata swap, so
    /// this operation never overwrites an existing ciphertext in place.
    pub fn create(&self, secure_key_ref: &str, secret: &[u8]) -> Result<(), SecureStoreError> {
        Self::validate_reference(secure_key_ref)?;
        let path = self.path_for(secure_key_ref);
        let cipher = self.creation_cipher()?;
        let mut nonce_bytes = [0_u8; NONCE_BYTES];
        OsRng.fill_bytes(&mut nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: secret,
                    aad: secure_key_ref.as_bytes(),
                },
            )
            .map_err(|_| SecureStoreError::Unavailable)?;

        let mut blob = Vec::with_capacity(self.magic.len() + nonce_bytes.len() + ciphertext.len());
        blob.extend_from_slice(&self.magic);
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);

        let marker = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let temporary = self
            .directory
            .join(format!(".{marker}-{}.fltmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = match options.open(&temporary) {
            Ok(file) => file,
            Err(_) => return Err(SecureStoreError::Unavailable),
        };
        if file.write_all(&blob).and_then(|_| file.sync_all()).is_err() {
            drop(file);
            let _ = fs::remove_file(&temporary);
            return Err(SecureStoreError::Unavailable);
        }
        drop(file);
        if path.exists() {
            let _ = fs::remove_file(&temporary);
            return Err(SecureStoreError::AlreadyExists);
        }
        if move_file(&temporary, &path, false).is_err() {
            let _ = fs::remove_file(&temporary);
            return if path.exists() {
                Err(SecureStoreError::AlreadyExists)
            } else {
                Err(SecureStoreError::Unavailable)
            };
        }
        Ok(())
    }

    pub fn delete(&self, secure_key_ref: &str) -> Result<bool, SecureStoreError> {
        Self::validate_reference(secure_key_ref)?;
        match fs::remove_file(self.path_for(secure_key_ref)) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(SecureStoreError::Unavailable),
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn ensure_private_directory(path: &Path) -> Result<(), SecureStoreError> {
    if path.exists() && !path.is_dir() {
        return Err(SecureStoreError::Unavailable);
    }
    fs::create_dir_all(path).map_err(|_| SecureStoreError::Unavailable)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| SecureStoreError::Unavailable)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FixedKey;

    impl WrappingKeyProvider for FixedKey {
        fn load(&self) -> Result<Zeroizing<Vec<u8>>, SecureStoreError> {
            Ok(Zeroizing::new(vec![7; KEY_BYTES]))
        }

        fn load_or_create(&self) -> Result<Zeroizing<Vec<u8>>, SecureStoreError> {
            self.load()
        }
    }

    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "forgelink-secure-store-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        ensure_private_directory(&path).expect("directory");
        path
    }

    #[test]
    fn encrypts_namespaced_refs_with_random_nonce_and_redacted_path() {
        let directory = directory();
        let store = EncryptedFileSecretStore::new(directory.clone(), FixedKey).expect("store");
        let reference = "forgelink:protected:email:smtp_pass";
        let secret = b"synthetic-secret";
        store.create(reference, secret).expect("create");
        assert!(store.contains(reference).expect("contains"));
        assert!(!store
            .path_for(reference)
            .to_string_lossy()
            .contains("smtp_pass"));
        let blob = fs::read(store.path_for(reference)).expect("blob");
        assert!(blob.starts_with(DEFAULT_MAGIC));
        assert!(!blob.windows(secret.len()).any(|window| window == secret));
        assert_eq!(
            store
                .read_secret(reference)
                .expect("read")
                .unwrap()
                .as_slice(),
            secret
        );
        assert_eq!(
            store.create(reference, secret),
            Err(SecureStoreError::AlreadyExists)
        );
        assert_eq!(store.delete(reference), Ok(true));
        assert_eq!(store.delete(reference), Ok(false));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_path_like_refs_and_detects_corruption() {
        let directory = directory();
        let store = EncryptedFileSecretStore::new(directory.clone(), FixedKey).expect("store");
        assert_eq!(
            store.contains("forgelink:../escape"),
            Err(SecureStoreError::InvalidReference)
        );
        let reference = "forgelink:protected:twilio:auth_token";
        store.create(reference, b"secret").expect("create");
        fs::write(store.path_for(reference), b"not-a-vault-blob").expect("tamper");
        assert_eq!(store.contains(reference), Err(SecureStoreError::Corrupt));
        let _ = fs::remove_dir_all(directory);
    }
}
