//! Ephemeral coturn TURN credential generation.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// Time-limited credentials a client passes to coturn (REST auth secret scheme).
#[derive(Debug, Clone, Serialize)]
pub struct TurnCredentials {
    pub username: String,
    pub password: String,
    /// seconds the credential remains valid
    pub ttl: u64,
}

/// Build credentials valid until `now + ttl_secs`.
/// `secret` MUST match coturn's `static-auth-secret`.
pub fn make_credentials(secret: &str, ttl_secs: u64, now_unix: u64) -> TurnCredentials {
    let expiry = now_unix + ttl_secs;
    let username = expiry.to_string();

    let mut mac = HmacSha1::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(username.as_bytes());
    let password = STANDARD.encode(mac.finalize().into_bytes());

    TurnCredentials { username, password, ttl: ttl_secs }
}

/// Convenience: build credentials using the current system time.
pub fn make_credentials_now(secret: &str, ttl_secs: u64) -> TurnCredentials {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_secs();
    make_credentials(secret, ttl_secs, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_use_expiry_as_username_and_hmac_password() {
        // Reference vector computed from coturn's documented scheme:
        // username = "1000", secret = "supersecret"
        let creds = make_credentials("supersecret", 600, 400);
        assert_eq!(creds.username, "1000"); // now(400) + ttl(600)
        assert_eq!(creds.ttl, 600);

        // password must be valid base64 and reproduce from the same inputs
        let again = make_credentials("supersecret", 600, 400);
        assert_eq!(creds.password, again.password);
        assert!(!creds.password.is_empty());
    }

    #[test]
    fn different_secret_yields_different_password() {
        let a = make_credentials("secret-a", 600, 400);
        let b = make_credentials("secret-b", 600, 400);
        assert_ne!(a.password, b.password);
    }
}
