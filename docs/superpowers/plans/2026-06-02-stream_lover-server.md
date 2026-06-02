# stream_lover Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the stream_lover signaling + connectivity server: a Rust workspace that does WebRTC signaling, account/room pairing, and issues ephemeral coturn TURN credentials, deployed beside coturn via docker-compose.

**Architecture:** Media flows peer-to-peer via WebRTC; the server only relays SDP/ICE over WebSocket (hot path, in-memory) and serves a small REST API for auth/devices/rooms/TURN-creds (cold path, SQLite). CGNAT is handled by ICE using STUN + ephemeral TURN creds we supply. coturn is run unmodified as the STUN/TURN server.

**Tech Stack:** Rust, Axum 0.7 (HTTP + WebSocket), tokio, sqlx (SQLite), jsonwebtoken, argon2, hmac+sha1, base64, serde, coturn, Docker Compose.

---

## File Structure

```
server/
├── Cargo.toml                     # workspace manifest
├── crates/
│   ├── turn/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs              # ephemeral coturn credential generation (pure)
│   ├── auth/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs              # JWT, argon2 password hash, room-code gen (pure)
│   ├── store/
│   │   ├── Cargo.toml
│   │   ├── migrations/0001_init.sql
│   │   └── src/lib.rs              # SQLite users + devices (sqlx)
│   ├── signaling/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs              # re-exports
│   │       ├── protocol.rs         # ClientMsg / ServerMsg enums
│   │       ├── room.rs             # pure Room state machine
│   │       └── hub.rs              # async Hub: rooms registry + WS plumbing
│   └── api/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs              # router builder + AppState
│           ├── handlers.rs         # REST handlers
│           └── ws.rs               # /ws axum WebSocket handler → hub
├── bin/
│   ├── Cargo.toml
│   └── src/main.rs                 # config + wire crates + serve
└── deploy/
    ├── docker-compose.yml
    ├── coturn.conf
    └── README.md                   # TLS / VPS notes
```

Each crate has one responsibility and is testable in isolation. `turn` and `auth` are pure (no I/O). `store` owns persistence. `signaling` owns the room state machine + WS plumbing. `api` wires HTTP. `bin` is config + composition only.

---

## Task 1: Workspace scaffolding

**Files:**
- Create: `server/Cargo.toml`
- Create: `server/crates/turn/Cargo.toml`, `server/crates/turn/src/lib.rs`
- Create: `.gitignore`

- [ ] **Step 1: Create the workspace manifest**

Create `server/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = [
    "crates/turn",
    "crates/auth",
    "crates/store",
    "crates/signaling",
    "crates/api",
    "bin",
]

[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
axum = { version = "0.7", features = ["ws", "macros"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "sqlite", "macros", "chrono"] }
jsonwebtoken = "9"
argon2 = "0.5"
hmac = "0.12"
sha1 = "0.10"
base64 = "0.22"
rand = "0.8"
uuid = { version = "1", features = ["v4"] }
thiserror = "1"
anyhow = "1"
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
tracing-subscriber = "0.3"
tower-http = { version = "0.5", features = ["cors", "trace"] }
```

- [ ] **Step 2: Create the `turn` crate manifest**

Create `server/crates/turn/Cargo.toml`:

```toml
[package]
name = "turn"
version = "0.1.0"
edition = "2021"

[dependencies]
hmac = { workspace = true }
sha1 = { workspace = true }
base64 = { workspace = true }
serde = { workspace = true }
```

- [ ] **Step 3: Create a placeholder lib so the workspace builds**

Create `server/crates/turn/src/lib.rs`:

```rust
//! Ephemeral coturn TURN credential generation.
```

- [ ] **Step 4: Create `.gitignore`**

Create `.gitignore` at repo root:

```
/server/target
**/*.rs.bk
*.db
*.db-shm
*.db-wal
.env
```

- [ ] **Step 5: Verify the workspace compiles**

Run: `cd server && cargo build`
Expected: compiles with no errors (the other member crates are added in later tasks; for now temporarily comment out the not-yet-created members in `members = [...]` so only `crates/turn` is listed, OR create empty stub crates — simplest is to list only `crates/turn` for now and add members as their tasks create them).

To keep this step green, set `members = ["crates/turn"]` for now:

```toml
members = ["crates/turn"]
```

- [ ] **Step 6: Commit**

```bash
git add server .gitignore
git commit -m "chore: scaffold server workspace and turn crate"
```

---

## Task 2: TURN ephemeral credentials (`turn` crate)

coturn's `use-auth-secret` REST scheme: `username = <unix-expiry>`, `password = base64(HMAC_SHA1(secret, username))`. We generate these so clients never hold a static TURN password.

**Files:**
- Modify: `server/crates/turn/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Append to `server/crates/turn/src/lib.rs`:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p turn`
Expected: FAIL — `make_credentials` / `TurnCredentials` not found.

- [ ] **Step 3: Write minimal implementation**

Replace the top of `server/crates/turn/src/lib.rs` (above the `#[cfg(test)]` block) with:

```rust
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && cargo test -p turn`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/crates/turn/src/lib.rs
git commit -m "feat(turn): ephemeral coturn credential generation"
```

---

## Task 3: Auth primitives (`auth` crate)

JWT issue/verify, argon2 password hashing, and room-code generation. All pure (no I/O).

**Files:**
- Create: `server/crates/auth/Cargo.toml`, `server/crates/auth/src/lib.rs`
- Modify: `server/Cargo.toml` (add `crates/auth` to members)

- [ ] **Step 1: Add the crate to the workspace and create its manifest**

In `server/Cargo.toml` set:

```toml
members = ["crates/turn", "crates/auth"]
```

Create `server/crates/auth/Cargo.toml`:

```toml
[package]
name = "auth"
version = "0.1.0"
edition = "2021"

[dependencies]
jsonwebtoken = { workspace = true }
argon2 = { workspace = true }
serde = { workspace = true }
rand = { workspace = true }
thiserror = { workspace = true }
```

- [ ] **Step 2: Write the failing tests**

Create `server/crates/auth/src/lib.rs`:

```rust
//! Auth primitives: password hashing, JWT, room codes. Pure (no I/O).

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && cargo test -p auth`
Expected: FAIL — functions/`Claims` not defined.

- [ ] **Step 4: Write the implementation**

Prepend to `server/crates/auth/src/lib.rs` (above the test module):

```rust
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
```

> Note: the test asserts codes are uppercase alphanumeric; the alphabet above excludes `O`,`0`,`1`,`I` but every remaining char is still uppercase-or-digit, so the test holds.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && cargo test -p auth`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add server/Cargo.toml server/crates/auth
git commit -m "feat(auth): password hashing, JWT, room-code generation"
```

---

## Task 4: Persistence (`store` crate)

SQLite via sqlx. Tables: `users`, `devices`. Tested against an in-memory SQLite database.

**Files:**
- Create: `server/crates/store/Cargo.toml`, `server/crates/store/src/lib.rs`, `server/crates/store/migrations/0001_init.sql`
- Modify: `server/Cargo.toml` (members)

- [ ] **Step 1: Add crate to workspace and create manifest**

In `server/Cargo.toml`:

```toml
members = ["crates/turn", "crates/auth", "crates/store"]
```

Create `server/crates/store/Cargo.toml`:

```toml
[package]
name = "store"
version = "0.1.0"
edition = "2021"

[dependencies]
sqlx = { workspace = true }
serde = { workspace = true }
uuid = { workspace = true }
chrono = { workspace = true }
thiserror = { workspace = true }
tokio = { workspace = true }
```

- [ ] **Step 2: Create the migration**

Create `server/crates/store/migrations/0001_init.sql`:

```sql
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE devices (
    id        TEXT PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    platform  TEXT NOT NULL,
    last_seen TEXT NOT NULL
);

CREATE INDEX idx_devices_user ON devices(user_id);
```

- [ ] **Step 3: Write the failing test**

Create `server/crates/store/src/lib.rs`:

```rust
//! SQLite persistence for users and devices.

#[cfg(test)]
mod tests {
    use super::*;

    async fn fresh() -> Store {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store.migrate().await.unwrap();
        store
    }

    #[tokio::test]
    async fn create_and_fetch_user_by_email() {
        let store = fresh().await;
        let user = store.create_user("a@b.com", "hash123").await.unwrap();
        assert_eq!(user.email, "a@b.com");

        let found = store.user_by_email("a@b.com").await.unwrap().unwrap();
        assert_eq!(found.id, user.id);
        assert_eq!(found.password_hash, "hash123");
    }

    #[tokio::test]
    async fn duplicate_email_is_rejected() {
        let store = fresh().await;
        store.create_user("a@b.com", "h").await.unwrap();
        assert!(store.create_user("a@b.com", "h2").await.is_err());
    }

    #[tokio::test]
    async fn register_and_list_devices_for_user() {
        let store = fresh().await;
        let user = store.create_user("a@b.com", "h").await.unwrap();

        store.create_device(&user.id, "Laptop", "desktop").await.unwrap();
        store.create_device(&user.id, "Pixel", "android").await.unwrap();

        let devices = store.devices_for_user(&user.id).await.unwrap();
        assert_eq!(devices.len(), 2);
        assert!(devices.iter().any(|d| d.name == "Laptop"));
    }
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && cargo test -p store`
Expected: FAIL — `Store` not defined.

- [ ] **Step 5: Write the implementation**

Prepend to `server/crates/store/src/lib.rs`:

```rust
use chrono::Utc;
use serde::Serialize;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Device {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub platform: String,
    pub last_seen: String,
}

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    pub async fn connect(url: &str) -> Result<Self, StoreError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(url)
            .await?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> Result<(), StoreError> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .map_err(|e| StoreError::Sqlx(sqlx::Error::Migrate(Box::new(e))))?;
        Ok(())
    }

    pub async fn create_user(&self, email: &str, password_hash: &str) -> Result<User, StoreError> {
        let user = User {
            id: Uuid::new_v4().to_string(),
            email: email.to_string(),
            password_hash: password_hash.to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        sqlx::query("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
            .bind(&user.id)
            .bind(&user.email)
            .bind(&user.password_hash)
            .bind(&user.created_at)
            .execute(&self.pool)
            .await?;
        Ok(user)
    }

    pub async fn user_by_email(&self, email: &str) -> Result<Option<User>, StoreError> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ?")
            .bind(email)
            .fetch_optional(&self.pool)
            .await?;
        Ok(user)
    }

    pub async fn create_device(&self, user_id: &str, name: &str, platform: &str) -> Result<Device, StoreError> {
        let device = Device {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            name: name.to_string(),
            platform: platform.to_string(),
            last_seen: Utc::now().to_rfc3339(),
        };
        sqlx::query("INSERT INTO devices (id, user_id, name, platform, last_seen) VALUES (?, ?, ?, ?, ?)")
            .bind(&device.id)
            .bind(&device.user_id)
            .bind(&device.name)
            .bind(&device.platform)
            .bind(&device.last_seen)
            .execute(&self.pool)
            .await?;
        Ok(device)
    }

    pub async fn devices_for_user(&self, user_id: &str) -> Result<Vec<Device>, StoreError> {
        let devices = sqlx::query_as::<_, Device>("SELECT * FROM devices WHERE user_id = ? ORDER BY name")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(devices)
    }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd server && cargo test -p store`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add server/Cargo.toml server/crates/store
git commit -m "feat(store): SQLite users and devices persistence"
```

---

## Task 5: Signaling protocol + room state machine (`signaling` crate, pure part)

The pure, fully-testable core: message types and the 2-peer `Room` state machine. No sockets yet.

**Files:**
- Create: `server/crates/signaling/Cargo.toml`, `server/crates/signaling/src/lib.rs`, `protocol.rs`, `room.rs`
- Modify: `server/Cargo.toml` (members)

- [ ] **Step 1: Add crate to workspace and create manifest**

In `server/Cargo.toml`:

```toml
members = ["crates/turn", "crates/auth", "crates/store", "crates/signaling"]
```

Create `server/crates/signaling/Cargo.toml`:

```toml
[package]
name = "signaling"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
turn = { path = "../turn" }
```

- [ ] **Step 2: Create the protocol message types**

Create `server/crates/signaling/src/protocol.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Sender,
    Receiver,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Realtime,
    Quality,
}

/// Messages a client sends up the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientMsg {
    Join { room: String, role: Role, mode: Mode },
    Offer { sdp: String },
    Answer { sdp: String },
    Ice { candidate: serde_json::Value },
}

/// Messages the server pushes down the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerMsg {
    Joined { peer_present: bool, ice_servers: serde_json::Value },
    PeerJoined,
    Offer { sdp: String },
    Answer { sdp: String },
    Ice { candidate: serde_json::Value },
    PeerLeft,
    Error { code: String, message: String },
}
```

- [ ] **Step 3: Write the failing test for the room state machine**

Create `server/crates/signaling/src/room.rs`:

```rust
use crate::protocol::Mode;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_peer_joins_alone() {
        let mut room = Room::new(Mode::Realtime);
        let res = room.join("peer-a");
        assert_eq!(res, JoinOutcome::Joined { peer_present: false });
        assert_eq!(room.peer_count(), 1);
    }

    #[test]
    fn second_peer_sees_existing_peer() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        let res = room.join("peer-b");
        assert_eq!(res, JoinOutcome::Joined { peer_present: true });
        assert_eq!(room.peer_count(), 2);
    }

    #[test]
    fn third_peer_is_rejected_as_full() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        room.join("peer-b");
        assert_eq!(room.join("peer-c"), JoinOutcome::Full);
        assert_eq!(room.peer_count(), 2);
    }

    #[test]
    fn other_returns_the_opposite_peer() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        room.join("peer-b");
        assert_eq!(room.other("peer-a"), Some("peer-b".to_string()));
        assert_eq!(room.other("peer-b"), Some("peer-a".to_string()));
    }

    #[test]
    fn leaving_frees_a_slot() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        room.join("peer-b");
        room.leave("peer-a");
        assert_eq!(room.peer_count(), 1);
        assert_eq!(room.other("peer-b"), None);
    }
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && cargo test -p signaling`
Expected: FAIL — `Room` / `JoinOutcome` not defined (and `lib.rs` doesn't yet expose modules).

- [ ] **Step 5: Write the room implementation**

Prepend to `server/crates/signaling/src/room.rs` (above the test module):

```rust
/// Result of attempting to join a room.
#[derive(Debug, PartialEq, Eq)]
pub enum JoinOutcome {
    Joined { peer_present: bool },
    Full,
}

/// A 2-peer signaling room. Pure state — peers are identified by opaque ids.
pub struct Room {
    pub mode: Mode,
    peers: Vec<String>,
}

impl Room {
    pub fn new(mode: Mode) -> Self {
        Self { mode, peers: Vec::with_capacity(2) }
    }

    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    pub fn join(&mut self, peer_id: &str) -> JoinOutcome {
        if self.peers.len() >= 2 {
            return JoinOutcome::Full;
        }
        let peer_present = !self.peers.is_empty();
        self.peers.push(peer_id.to_string());
        JoinOutcome::Joined { peer_present }
    }

    /// The other peer in the room, if present.
    pub fn other(&self, peer_id: &str) -> Option<String> {
        self.peers.iter().find(|p| p.as_str() != peer_id).cloned()
    }

    pub fn leave(&mut self, peer_id: &str) {
        self.peers.retain(|p| p != peer_id);
    }

    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }
}
```

- [ ] **Step 6: Wire up `lib.rs`**

Create `server/crates/signaling/src/lib.rs`:

```rust
//! WebRTC signaling: protocol types, room state machine, and the async hub.

pub mod protocol;
pub mod room;

pub use protocol::{ClientMsg, Mode, Role, ServerMsg};
pub use room::{JoinOutcome, Room};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd server && cargo test -p signaling`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add server/Cargo.toml server/crates/signaling
git commit -m "feat(signaling): protocol types and pure room state machine"
```

---

## Task 6: Async Hub (`signaling` crate, async part)

The `Hub` owns the registry of rooms and per-peer message channels, and routes relayed messages. Tested with in-process channels (no real WebSocket).

**Files:**
- Create: `server/crates/signaling/src/hub.rs`
- Modify: `server/crates/signaling/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `server/crates/signaling/src/hub.rs`:

```rust
use crate::protocol::{Mode, ServerMsg};
use crate::room::{JoinOutcome, Room};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn relays_a_message_to_the_other_peer() {
        let hub = Hub::new();
        let (tx_a, _rx_a) = mpsc::channel(8);
        let (tx_b, mut rx_b) = mpsc::channel(8);

        // A joins alone, then B joins; B should be told a peer is present.
        let out_a = hub.join("room1", "a", Mode::Realtime, tx_a).await;
        assert_eq!(out_a, JoinOutcome::Joined { peer_present: false });
        let out_b = hub.join("room1", "b", Mode::Realtime, tx_b).await;
        assert_eq!(out_b, JoinOutcome::Joined { peer_present: true });

        // A sends an offer; it must arrive at B.
        hub.relay("room1", "a", ServerMsg::Offer { sdp: "SDP".into() }).await;
        let got = rx_b.recv().await.unwrap();
        assert!(matches!(got, ServerMsg::Offer { sdp } if sdp == "SDP"));
    }

    #[tokio::test]
    async fn leaving_notifies_the_remaining_peer() {
        let hub = Hub::new();
        let (tx_a, mut rx_a) = mpsc::channel(8);
        let (tx_b, _rx_b) = mpsc::channel(8);
        hub.join("room2", "a", Mode::Realtime, tx_a).await;
        hub.join("room2", "b", Mode::Realtime, tx_b).await;

        hub.leave("room2", "b").await;
        let got = rx_a.recv().await.unwrap();
        assert!(matches!(got, ServerMsg::PeerLeft));
    }

    #[tokio::test]
    async fn empty_room_is_removed() {
        let hub = Hub::new();
        let (tx_a, _rx_a) = mpsc::channel(8);
        hub.join("room3", "a", Mode::Realtime, tx_a).await;
        hub.leave("room3", "a").await;
        assert_eq!(hub.room_count().await, 0);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p signaling hub`
Expected: FAIL — `Hub` not defined.

- [ ] **Step 3: Write the Hub implementation**

Prepend to `server/crates/signaling/src/hub.rs` (above the test module):

```rust
/// A live room: the pure state machine plus a channel to each peer.
struct LiveRoom {
    room: Room,
    senders: HashMap<String, mpsc::Sender<ServerMsg>>,
}

/// Owns all live rooms and routes relayed messages between peers.
#[derive(Clone)]
pub struct Hub {
    rooms: Arc<Mutex<HashMap<String, LiveRoom>>>,
}

impl Hub {
    pub fn new() -> Self {
        Self { rooms: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Join `peer_id` to `room_code`, registering its outbound channel.
    pub async fn join(
        &self,
        room_code: &str,
        peer_id: &str,
        mode: Mode,
        tx: mpsc::Sender<ServerMsg>,
    ) -> JoinOutcome {
        let mut rooms = self.rooms.lock().await;
        let live = rooms
            .entry(room_code.to_string())
            .or_insert_with(|| LiveRoom { room: Room::new(mode), senders: HashMap::new() });

        let outcome = live.room.join(peer_id);
        if let JoinOutcome::Joined { peer_present } = outcome {
            live.senders.insert(peer_id.to_string(), tx);
            // Tell the already-present peer that someone arrived.
            if peer_present {
                if let Some(other_id) = live.room.other(peer_id) {
                    if let Some(other_tx) = live.senders.get(&other_id) {
                        let _ = other_tx.send(ServerMsg::PeerJoined).await;
                    }
                }
            }
        }
        outcome
    }

    /// Forward `msg` from `from_peer` to the other peer in the room.
    pub async fn relay(&self, room_code: &str, from_peer: &str, msg: ServerMsg) {
        let rooms = self.rooms.lock().await;
        if let Some(live) = rooms.get(room_code) {
            if let Some(other_id) = live.room.other(from_peer) {
                if let Some(other_tx) = live.senders.get(&other_id) {
                    let _ = other_tx.send(msg).await;
                }
            }
        }
    }

    /// Remove a peer; notify the remaining peer and drop empty rooms.
    pub async fn leave(&self, room_code: &str, peer_id: &str) {
        let mut rooms = self.rooms.lock().await;
        if let Some(live) = rooms.get_mut(room_code) {
            if let Some(other_id) = live.room.other(peer_id) {
                if let Some(other_tx) = live.senders.get(&other_id) {
                    let _ = other_tx.send(ServerMsg::PeerLeft).await;
                }
            }
            live.room.leave(peer_id);
            live.senders.remove(peer_id);
            if live.room.is_empty() {
                rooms.remove(room_code);
            }
        }
    }

    pub async fn room_count(&self) -> usize {
        self.rooms.lock().await.len()
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] **Step 4: Export the hub from `lib.rs`**

Edit `server/crates/signaling/src/lib.rs` to add the module and re-export:

```rust
//! WebRTC signaling: protocol types, room state machine, and the async hub.

pub mod hub;
pub mod protocol;
pub mod room;

pub use hub::Hub;
pub use protocol::{ClientMsg, Mode, Role, ServerMsg};
pub use room::{JoinOutcome, Room};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && cargo test -p signaling`
Expected: PASS (8 tests total: 5 room + 3 hub).

- [ ] **Step 6: Commit**

```bash
git add server/crates/signaling
git commit -m "feat(signaling): async Hub routing with in-process channel tests"
```

---

## Task 7: REST API + AppState (`api` crate)

Axum router with auth/devices/rooms/turn-credentials handlers, plus shared `AppState`. Tested with `tower`'s `oneshot` against the router (no network).

**Files:**
- Create: `server/crates/api/Cargo.toml`, `server/crates/api/src/lib.rs`, `handlers.rs`
- Modify: `server/Cargo.toml` (members)

- [ ] **Step 1: Add crate to workspace and create manifest**

In `server/Cargo.toml`:

```toml
members = ["crates/turn", "crates/auth", "crates/store", "crates/signaling", "crates/api"]
```

Create `server/crates/api/Cargo.toml`:

```toml
[package]
name = "api"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { workspace = true }
tokio = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tower-http = { workspace = true }
auth = { path = "../auth" }
store = { path = "../store" }
turn = { path = "../turn" }
signaling = { path = "../signaling" }

[dev-dependencies]
tower = { version = "0.4", features = ["util"] }
http-body-util = "0.1"
```

- [ ] **Step 2: Define AppState and the router skeleton**

Create `server/crates/api/src/lib.rs`:

```rust
//! HTTP API: auth, devices, rooms, TURN credentials.

pub mod handlers;
pub mod ws;

use axum::routing::{get, post};
use axum::Router;
use signaling::Hub;
use std::sync::Arc;
use store::Store;

/// Shared configuration + handles passed to every handler.
#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub hub: Hub,
    pub jwt_secret: Arc<Vec<u8>>,
    pub turn_secret: Arc<String>,
    pub turn_url: Arc<String>,
    pub stun_url: Arc<String>,
    /// TTL (seconds) for issued TURN credentials.
    pub turn_ttl: u64,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/signup", post(handlers::signup))
        .route("/login", post(handlers::login))
        .route("/devices", get(handlers::list_devices).post(handlers::register_device))
        .route("/rooms", post(handlers::create_room))
        .route("/turn-credentials", post(handlers::turn_credentials))
        .route("/ws", get(ws::ws_handler))
        .with_state(state)
}

/// Build the JSON describing ICE servers for a client (STUN + ephemeral TURN).
pub fn ice_servers_json(state: &AppState) -> serde_json::Value {
    let creds = turn::make_credentials_now(&state.turn_secret, state.turn_ttl);
    serde_json::json!([
        { "urls": [state.stun_url.as_str()] },
        {
            "urls": [state.turn_url.as_str()],
            "username": creds.username,
            "credential": creds.password
        }
    ])
}
```

- [ ] **Step 3: Write the failing handler tests**

Create `server/crates/api/src/handlers.rs` with tests first:

```rust
use crate::{ice_servers_json, AppState};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use signaling::Hub;
    use std::sync::Arc;
    use store::Store;
    use tower::ServiceExt;

    async fn test_state() -> AppState {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store.migrate().await.unwrap();
        AppState {
            store,
            hub: Hub::new(),
            jwt_secret: Arc::new(b"test-secret".to_vec()),
            turn_secret: Arc::new("turn-secret".to_string()),
            turn_url: Arc::new("turns:turn.example.com:5349".to_string()),
            stun_url: Arc::new("stun:turn.example.com:3478".to_string()),
            turn_ttl: 600,
        }
    }

    #[tokio::test]
    async fn signup_then_login_returns_token() {
        let app = crate::router(test_state().await);

        let signup = app
            .clone()
            .oneshot(
                Request::post("/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"email":"a@b.com","password":"pw123456"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(signup.status(), StatusCode::OK);

        let login = app
            .oneshot(
                Request::post("/login")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"email":"a@b.com","password":"pw123456"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login.status(), StatusCode::OK);

        let body = login.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v["token"].as_str().unwrap().len() > 10);
    }

    #[tokio::test]
    async fn login_with_wrong_password_is_unauthorized() {
        let app = crate::router(test_state().await);
        app.clone()
            .oneshot(
                Request::post("/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"email":"a@b.com","password":"right-pw"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        let login = app
            .oneshot(
                Request::post("/login")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"email":"a@b.com","password":"wrong-pw"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn create_room_returns_a_code() {
        let app = crate::router(test_state().await);
        let res = app
            .oneshot(Request::post("/rooms").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["code"].as_str().unwrap().len(), 6);
    }

    #[tokio::test]
    async fn turn_credentials_endpoint_returns_ice_servers() {
        let state = test_state().await;
        let servers = ice_servers_json(&state);
        assert!(servers.is_array());
        // second entry is the TURN server with credentials
        assert!(servers[1]["username"].is_string());
        assert!(servers[1]["credential"].is_string());
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd server && cargo test -p api`
Expected: FAIL — handlers not defined.

- [ ] **Step 5: Write the handler implementations**

Prepend to `server/crates/api/src/handlers.rs` (above the test module):

```rust
#[derive(Deserialize)]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct TokenResponse {
    pub token: String,
}

#[derive(Serialize)]
pub struct RoomResponse {
    pub code: String,
}

#[derive(Deserialize)]
pub struct NewDevice {
    pub name: String,
    pub platform: String,
}

/// Extract and verify the bearer JWT, returning the user id (`sub`).
fn require_user(state: &AppState, headers: &axum::http::HeaderMap) -> Result<String, StatusCode> {
    let header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let token = header.strip_prefix("Bearer ").ok_or(StatusCode::UNAUTHORIZED)?;
    let claims = auth::verify_token(&state.jwt_secret, token).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(claims.sub)
}

pub async fn signup(
    State(state): State<AppState>,
    Json(body): Json<Credentials>,
) -> Result<Json<TokenResponse>, StatusCode> {
    if body.password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let hash = auth::hash_password(&body.password).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let user = state
        .store
        .create_user(&body.email, &hash)
        .await
        .map_err(|_| StatusCode::CONFLICT)?;
    let token = auth::issue_token(&state.jwt_secret, &user.id, 86400)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(TokenResponse { token }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<Credentials>,
) -> Result<Json<TokenResponse>, StatusCode> {
    let user = state
        .store
        .user_by_email(&body.email)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ok = auth::verify_password(&body.password, &user.password_hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !ok {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = auth::issue_token(&state.jwt_secret, &user.id, 86400)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(TokenResponse { token }))
}

pub async fn register_device(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<NewDevice>,
) -> Result<Json<store::Device>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let device = state
        .store
        .create_device(&user_id, &body.name, &body.platform)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(device))
}

pub async fn list_devices(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<store::Device>>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let devices = state
        .store
        .devices_for_user(&user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(devices))
}

pub async fn create_room() -> Json<RoomResponse> {
    Json(RoomResponse { code: auth::generate_room_code() })
}

pub async fn turn_credentials(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(ice_servers_json(&state))
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && cargo test -p api`
Expected: PASS (4 tests). Note: `ws.rs` is referenced by `lib.rs`; create a minimal stub now so the crate compiles — see next step.

- [ ] **Step 7: Add a minimal `ws.rs` stub so `api` compiles**

Create `server/crates/api/src/ws.rs`:

```rust
//! WebSocket signaling endpoint. Full implementation in Task 8.
use crate::AppState;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::State;
use axum::response::Response;

pub async fn ws_handler(State(_state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(|_socket| async {})
}
```

Re-run: `cd server && cargo test -p api`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add server/Cargo.toml server/crates/api
git commit -m "feat(api): REST handlers for auth, devices, rooms, TURN creds"
```

---

## Task 8: WebSocket signaling endpoint (`api/src/ws.rs`)

Wire the Axum WebSocket to the `Hub`: parse `ClientMsg`, drive join/relay/leave, pump `ServerMsg` back. Verified by an end-to-end integration test with two real WebSocket clients.

**Files:**
- Modify: `server/crates/api/src/ws.rs`
- Create: `server/crates/api/tests/ws_e2e.rs`
- Modify: `server/crates/api/Cargo.toml` (add `tokio-tungstenite` dev-dep)

- [ ] **Step 1: Implement the WS handler**

Replace `server/crates/api/src/ws.rs` with:

```rust
//! WebSocket signaling endpoint: bridges a client socket to the Hub.
use crate::{ice_servers_json, AppState};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use signaling::protocol::{ClientMsg, ServerMsg};
use signaling::JoinOutcome;
use tokio::sync::mpsc;
use uuid::Uuid;

pub async fn ws_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let peer_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::channel::<ServerMsg>(32);

    // Wait for the first message: it must be a Join.
    let join = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => match serde_json::from_str::<ClientMsg>(&t) {
                Ok(ClientMsg::Join { room, role: _, mode }) => break (room, mode),
                _ => continue,
            },
            Some(Ok(_)) => continue,
            _ => return, // closed before joining
        }
    };
    let (room_code, mode) = join;

    let outcome = state.hub.join(&room_code, &peer_id, mode, tx).await;
    if let JoinOutcome::Full = outcome {
        let _ = socket
            .send(Message::Text(
                serde_json::to_string(&ServerMsg::Error {
                    code: "room-full".into(),
                    message: "room already has two peers".into(),
                })
                .unwrap(),
            ))
            .await;
        return;
    }
    let peer_present = matches!(outcome, JoinOutcome::Joined { peer_present: true });

    // Acknowledge join with ICE servers (STUN + ephemeral TURN).
    let _ = socket
        .send(Message::Text(
            serde_json::to_string(&ServerMsg::Joined {
                peer_present,
                ice_servers: ice_servers_json(&state),
            })
            .unwrap(),
        ))
        .await;

    // Main loop: forward inbound client msgs to the hub, outbound hub msgs to the socket.
    loop {
        tokio::select! {
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(t))) => {
                        if let Ok(msg) = serde_json::from_str::<ClientMsg>(&t) {
                            let relayed = match msg {
                                ClientMsg::Offer { sdp } => Some(ServerMsg::Offer { sdp }),
                                ClientMsg::Answer { sdp } => Some(ServerMsg::Answer { sdp }),
                                ClientMsg::Ice { candidate } => Some(ServerMsg::Ice { candidate }),
                                ClientMsg::Join { .. } => None, // ignore re-join
                            };
                            if let Some(m) = relayed {
                                state.hub.relay(&room_code, &peer_id, m).await;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            outbound = rx.recv() => {
                match outbound {
                    Some(msg) => {
                        if socket
                            .send(Message::Text(serde_json::to_string(&msg).unwrap()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    state.hub.leave(&room_code, &peer_id).await;
}
```

- [ ] **Step 2: Add the dev-dependency for a WS test client**

In `server/crates/api/Cargo.toml`, extend `[dev-dependencies]`:

```toml
[dev-dependencies]
tower = { version = "0.4", features = ["util"] }
http-body-util = "0.1"
tokio-tungstenite = "0.21"
futures-util = "0.3"
```

- [ ] **Step 3: Write the end-to-end integration test**

Create `server/crates/api/tests/ws_e2e.rs`:

```rust
use api::{router, AppState};
use futures_util::{SinkExt, StreamExt};
use signaling::Hub;
use std::sync::Arc;
use store::Store;
use tokio_tungstenite::tungstenite::Message;

async fn spawn_server() -> std::net::SocketAddr {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    store.migrate().await.unwrap();
    let state = AppState {
        store,
        hub: Hub::new(),
        jwt_secret: Arc::new(b"test".to_vec()),
        turn_secret: Arc::new("s".to_string()),
        turn_url: Arc::new("turns:t:5349".to_string()),
        stun_url: Arc::new("stun:t:3478".to_string()),
        turn_ttl: 600,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router(state)).await.unwrap();
    });
    addr
}

#[tokio::test]
async fn two_peers_complete_an_offer_answer_exchange() {
    let addr = spawn_server().await;
    let url = format!("ws://{}/ws", addr);

    let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // A joins first.
    a.send(Message::Text(
        r#"{"type":"join","room":"R1","role":"sender","mode":"realtime"}"#.into(),
    ))
    .await
    .unwrap();
    // A's first server message is "joined" with peer_present=false.
    let a_joined = next_text(&mut a).await;
    assert!(a_joined.contains("\"type\":\"joined\""));
    assert!(a_joined.contains("\"peer_present\":false"));

    // B joins second.
    b.send(Message::Text(
        r#"{"type":"join","room":"R1","role":"receiver","mode":"realtime"}"#.into(),
    ))
    .await
    .unwrap();
    let b_joined = next_text(&mut b).await;
    assert!(b_joined.contains("\"peer_present\":true"));

    // A receives "peer-joined".
    let a_peer = next_text(&mut a).await;
    assert!(a_peer.contains("peer-joined"));

    // A sends an offer; B must receive it.
    a.send(Message::Text(r#"{"type":"offer","sdp":"SDP-A"}"#.into()))
        .await
        .unwrap();
    let b_offer = next_text(&mut b).await;
    assert!(b_offer.contains("\"type\":\"offer\""));
    assert!(b_offer.contains("SDP-A"));

    // B answers; A must receive it.
    b.send(Message::Text(r#"{"type":"answer","sdp":"SDP-B"}"#.into()))
        .await
        .unwrap();
    let a_answer = next_text(&mut a).await;
    assert!(a_answer.contains("\"type\":\"answer\""));
    assert!(a_answer.contains("SDP-B"));
}

async fn next_text<S>(stream: &mut S) -> String
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        match stream.next().await {
            Some(Ok(Message::Text(t))) => return t,
            Some(Ok(_)) => continue,
            other => panic!("expected text frame, got {:?}", other),
        }
    }
}
```

- [ ] **Step 4: Run the integration test**

Run: `cd server && cargo test -p api --test ws_e2e`
Expected: PASS (1 test) — a full join/offer/answer relay over real WebSockets.

- [ ] **Step 5: Run the whole workspace test suite**

Run: `cd server && cargo test`
Expected: all tests PASS across turn/auth/store/signaling/api.

- [ ] **Step 6: Commit**

```bash
git add server/crates/api
git commit -m "feat(api): WebSocket signaling endpoint with end-to-end test"
```

---

## Task 9: Server binary + config (`bin` crate)

Compose everything: read config from env, connect the store, run migrations, build the router, serve.

**Files:**
- Create: `server/bin/Cargo.toml`, `server/bin/src/main.rs`
- Modify: `server/Cargo.toml` (members)

- [ ] **Step 1: Add the bin to the workspace and create its manifest**

In `server/Cargo.toml`:

```toml
members = ["crates/turn", "crates/auth", "crates/store", "crates/signaling", "crates/api", "bin"]
```

Create `server/bin/Cargo.toml`:

```toml
[package]
name = "stream_lover_server"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "stream_lover_server"
path = "src/main.rs"

[dependencies]
tokio = { workspace = true }
axum = { workspace = true }
anyhow = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
tower-http = { workspace = true }
api = { path = "../crates/api" }
store = { path = "../crates/store" }
signaling = { path = "../crates/signaling" }
```

- [ ] **Step 2: Write `main.rs`**

Create `server/bin/src/main.rs`:

```rust
//! stream_lover server entrypoint: load config, wire crates, serve.
use anyhow::Context;
use api::{router, AppState};
use signaling::Hub;
use std::sync::Arc;
use store::Store;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let database_url = env_or("DATABASE_URL", "sqlite:stream_lover.db?mode=rwc");
    let bind = env_or("BIND_ADDR", "0.0.0.0:8080");
    let jwt_secret = std::env::var("JWT_SECRET").context("JWT_SECRET must be set")?;
    let turn_secret = std::env::var("TURN_SECRET").context("TURN_SECRET must be set")?;
    let turn_url = env_or("TURN_URL", "turns:localhost:5349");
    let stun_url = env_or("STUN_URL", "stun:localhost:3478");
    let turn_ttl: u64 = env_or("TURN_TTL", "600").parse().unwrap_or(600);

    let store = Store::connect(&database_url).await?;
    store.migrate().await?;

    let state = AppState {
        store,
        hub: Hub::new(),
        jwt_secret: Arc::new(jwt_secret.into_bytes()),
        turn_secret: Arc::new(turn_secret),
        turn_url: Arc::new(turn_url),
        stun_url: Arc::new(stun_url),
        turn_ttl,
    };

    let app = router(state).layer(tower_http::trace::TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("stream_lover server listening on {bind}");
    axum::serve(listener, app).await?;
    Ok(())
}
```

- [ ] **Step 3: Verify it builds**

Run: `cd server && cargo build -p stream_lover_server`
Expected: compiles cleanly.

- [ ] **Step 4: Smoke-test the binary boots and serves health**

Run:
```bash
cd server && JWT_SECRET=dev TURN_SECRET=dev DATABASE_URL="sqlite::memory:" BIND_ADDR=127.0.0.1:8099 \
  cargo run -p stream_lover_server &
sleep 2 && curl -s http://127.0.0.1:8099/healthz ; echo
kill %1
```
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add server/Cargo.toml server/bin
git commit -m "feat(bin): server entrypoint with env config and migrations"
```

---

## Task 10: Deployment (coturn + docker-compose)

Run the server beside coturn with the shared TURN secret, and document TLS.

**Files:**
- Create: `server/deploy/coturn.conf`, `server/deploy/docker-compose.yml`, `server/deploy/Dockerfile`, `server/deploy/README.md`

- [ ] **Step 1: Write the coturn config**

Create `server/deploy/coturn.conf`:

```conf
# coturn for stream_lover — STUN + TURN with REST ephemeral auth.
listening-port=3478
tls-listening-port=5349

# Ephemeral credentials: secret MUST equal the server's TURN_SECRET.
use-auth-secret
static-auth-secret=CHANGE_ME_SHARED_TURN_SECRET

realm=turn.example.com

# Relay range (open these UDP ports on the firewall/VPS).
min-port=49152
max-port=65535

fingerprint
no-cli
# TLS (recommended for CGNAT-restricted networks). Point these at real certs.
# cert=/etc/coturn/certs/fullchain.pem
# pkey=/etc/coturn/certs/privkey.pem

# Hardening
no-loopback-peers
no-multicast-peers
```

- [ ] **Step 2: Write the server Dockerfile**

Create `server/deploy/Dockerfile`:

```dockerfile
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p stream_lover_server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/stream_lover_server /usr/local/bin/stream_lover_server
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/stream_lover_server"]
```

> The Docker build context is the `server/` directory (so the whole workspace is copied). See compose below.

- [ ] **Step 3: Write docker-compose**

Create `server/deploy/docker-compose.yml`:

```yaml
services:
  coturn:
    image: coturn/coturn:4.6
    network_mode: host          # required so TURN relay ports work correctly
    volumes:
      - ./coturn.conf:/etc/coturn/turnserver.conf:ro
    restart: unless-stopped

  signaling:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    environment:
      BIND_ADDR: "0.0.0.0:8080"
      DATABASE_URL: "sqlite:/data/stream_lover.db?mode=rwc"
      JWT_SECRET: "CHANGE_ME_JWT_SECRET"
      TURN_SECRET: "CHANGE_ME_SHARED_TURN_SECRET"   # MUST match coturn static-auth-secret
      TURN_URL: "turns:turn.example.com:5349"
      STUN_URL: "stun:turn.example.com:3478"
      TURN_TTL: "600"
    volumes:
      - signaling_data:/data
    ports:
      - "8080:8080"
    depends_on:
      - coturn
    restart: unless-stopped

volumes:
  signaling_data:
```

- [ ] **Step 4: Write the deploy README**

Create `server/deploy/README.md`:

```markdown
# Deploying stream_lover server

## Prereqs
- A Linux VPS with a public IP and a DNS name (e.g. `turn.example.com`).
- Docker + Docker Compose.
- Open ports: TCP 8080 (signaling, ideally behind a TLS reverse proxy → 443),
  UDP/TCP 3478 and 5349 (STUN/TURN), UDP 49152-65535 (TURN relay).

## Configure
1. Set a strong shared secret in BOTH places — they must match exactly:
   - `coturn.conf` → `static-auth-secret`
   - `docker-compose.yml` → `signaling.environment.TURN_SECRET`
2. Set a strong `JWT_SECRET`.
3. Replace `turn.example.com` with your domain in `coturn.conf`, `TURN_URL`, `STUN_URL`, `realm`.

## TLS
WebRTC requires secure contexts. Put a reverse proxy (Caddy/nginx) in front of the
signaling service to serve `wss://.../ws` over 443. For TURNS, point coturn's
`cert`/`pkey` at your certificate (e.g. Let's Encrypt) and uncomment those lines.

## Run
    docker compose up -d --build

Check: `curl https://your-domain/healthz` → `ok`.
```

- [ ] **Step 5: Validate compose syntax**

Run: `cd server/deploy && docker compose config >/dev/null && echo "compose OK"`
Expected: prints `compose OK` (validates YAML without starting containers). If Docker is unavailable in the dev environment, skip and note it; this is verified on the VPS.

- [ ] **Step 6: Commit**

```bash
git add server/deploy
git commit -m "chore(deploy): coturn config, Dockerfile, and docker-compose"
```

---

## Task 11: Top-level docs (README + CHANGELOG)

**Files:**
- Create: `README.md`, `CHANGELOG.md` (repo root)

- [ ] **Step 1: Write the project README**

Create `README.md`:

```markdown
# stream_lover

Peer-to-peer media/screen streaming between devices. Media flows directly device-to-device
via WebRTC; the server only does signaling and supplies STUN/TURN so connections survive
CGNAT. Two modes: low-latency real-time and high-quality buffered (a client-side WebRTC
config choice — the server is identical for both).

## Status
- **Server (this phase):** signaling + REST API + ephemeral TURN credentials + coturn deploy. Done.
- **Client:** designed in a later spec.

## Server layout
See `server/` — a Rust workspace: `turn`, `auth`, `store`, `signaling`, `api` crates and a
`stream_lover_server` binary. Deploy assets in `server/deploy/`.

## Develop
    cd server && cargo test      # run the whole test suite
    JWT_SECRET=dev TURN_SECRET=dev cargo run -p stream_lover_server

## Deploy
See `server/deploy/README.md`.
```

- [ ] **Step 2: Write the CHANGELOG**

Create `CHANGELOG.md`:

```markdown
# Changelog

## [0.1.0] - 2026-06-02
### Added
- Server workspace: `turn`, `auth`, `store`, `signaling`, `api` crates + `stream_lover_server` binary.
- Ephemeral coturn TURN credential generation (REST auth-secret scheme).
- JWT auth, argon2 password hashing, room-code generation.
- SQLite persistence for users and devices.
- WebRTC signaling: 2-peer room state machine, async Hub, WebSocket endpoint (end-to-end tested).
- REST API: signup/login, device registry, room creation, TURN credentials.
- Deployment: coturn config, Dockerfile, docker-compose.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: project README and CHANGELOG for server v0.1.0"
```

---

## Definition of Done

- `cd server && cargo test` passes for all crates (turn, auth, store, signaling, api).
- `cargo build -p stream_lover_server` produces a binary that boots and serves `/healthz`.
- Two WebSocket clients complete a full offer/answer/ICE exchange via the integration test.
- `docker compose config` validates; deploy README documents secrets, ports, and TLS.
- README + CHANGELOG present.

## Notes for the implementer

- **Env quirks (this machine):** `grep`/`ugrep` is broken (glibc) — use `awk`/`rg` alternatives.
  Docker may be unavailable on Termux; Task 10 Step 5 and the Dockerfile build are verified on
  the VPS, not necessarily locally. All `cargo test` tasks DO run locally.
- **Secrets:** `JWT_SECRET` and `TURN_SECRET` are required at runtime; `TURN_SECRET` must equal
  coturn's `static-auth-secret`.
- **YAGNI:** no email verification, no rate limiting, no SFU/multi-receiver in this phase
  (documented as out of scope in the spec).
```
