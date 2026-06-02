//! Auth primitives: password hashing, JWT, room codes. Pure (no I/O).

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("password hashing failed: {0}")]
    Hash(String),
    #[error("jwt error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

pub fn hash_password(plain: &str) -> Result<String, AuthError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(plain.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AuthError::Hash(e.to_string()))
}

pub fn verify_password(plain: &str, hash: &str) -> Result<bool, AuthError> {
    let parsed = PasswordHash::new(hash).map_err(|e| AuthError::Hash(e.to_string()))?;
    Ok(Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

pub fn issue_token(secret: &[u8], subject: &str, ttl_secs: u64) -> Result<String, AuthError> {
    let exp = (now_unix() + ttl_secs) as usize;
    let claims = Claims { sub: subject.to_string(), exp };
    Ok(encode(&Header::default(), &claims, &EncodingKey::from_secret(secret))?)
}

pub fn verify_token(secret: &[u8], token: &str) -> Result<Claims, AuthError> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

/// Short, shareable, unambiguous room code (no 0/O/1/I confusion).
pub fn generate_room_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_then_verify_roundtrips() {
        let hash = hash_password("hunter2").unwrap();
        assert!(verify_password("hunter2", &hash).unwrap());
        assert!(!verify_password("wrong", &hash).unwrap());
    }

    #[test]
    fn jwt_roundtrips_subject() {
        let secret = b"jwt-secret";
        let token = issue_token(secret, "user-123", 3600).unwrap();
        let claims = verify_token(secret, &token).unwrap();
        assert_eq!(claims.sub, "user-123");
    }

    #[test]
    fn jwt_rejects_wrong_secret() {
        let token = issue_token(b"right", "u", 3600).unwrap();
        assert!(verify_token(b"wrong", &token).is_err());
    }

    #[test]
    fn room_code_is_six_uppercase_alphanumerics() {
        let code = generate_room_code();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()));
    }
}
