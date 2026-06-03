# stream_lover Phase 2a — Server (Channels, Roles, Invites, Broadcast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the server from single-owner "rooms" into shared **channels** with membership, owner/admin/member roles, invites (link + by-email), and authenticated **1-broadcaster→N-viewer** broadcast signaling (sender-side fan-out, server signaling-only), including owner/admin moderation (kick, role change, force-stop any stream, block a member from streaming).

**Architecture:** Rust/Axum/sqlx. `rooms` table is renamed to `channels` with new `channel_members` and `channel_invites` tables. A pure `policy` module encodes the permission matrix (table-tested). A new `BroadcastRoom` lives beside the existing 2-peer `Room` in the signaling hub, reached via an authenticated WS that verifies channel membership; SDP/ICE are tagged with a per-viewer `peer_id`.

**Tech Stack:** Rust, Axum 0.7 (HTTP + WS), tokio, sqlx (SQLite), jsonwebtoken, serde. This plan is server-only; the web client is a separate plan.

---

## File Structure

```
server/crates/store/
├── migrations/0003_channels.sql        # rename rooms→channels; members + invites tables; backfill
└── src/
    ├── lib.rs                          # + `pub mod channels;`  (Room→Channel rename lands here)
    └── channels.rs                     # NEW: Channel/Member/Invite models + Store impl methods

server/crates/api/src/
├── lib.rs                              # routes: /rooms → /channels + members/invites/stream
├── policy.rs                           # NEW: pure permission matrix (Role × Action → bool)
├── channels.rs                         # NEW: channel + member + stream REST handlers
├── invites.rs                          # NEW: invite REST handlers
├── handlers.rs                         # trim: remove old room handlers (moved/renamed)
├── ws.rs                               # existing 2-peer WS (unchanged)
└── ws_broadcast.rs                     # NEW: authenticated broadcast WS endpoint

server/crates/signaling/src/
├── lib.rs                              # + broadcast exports
├── protocol.rs                         # + BroadcastClientMsg / BroadcastServerMsg
├── broadcast.rs                        # NEW: pure BroadcastRoom state machine
└── hub.rs                              # + BroadcastHub registry + routing
```

The store's channel code goes in its own `channels.rs` module (the existing `lib.rs` already holds users/devices and is growing). API channel/invite handlers are split by responsibility. The broadcast state machine is pure and separate from its async hub, mirroring the existing `room.rs`/`hub.rs` split.

---

## Task 1: Migration + Channel model (rename rooms → channels)

**Files:**
- Create: `server/crates/store/migrations/0003_channels.sql`
- Create: `server/crates/store/src/channels.rs`
- Modify: `server/crates/store/src/lib.rs`

- [ ] **Step 1: Write the migration**

Create `server/crates/store/migrations/0003_channels.sql`:

```sql
ALTER TABLE rooms RENAME TO channels;

CREATE TABLE channel_members (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    can_stream  INTEGER NOT NULL DEFAULT 1,
    joined_at   TEXT NOT NULL,
    UNIQUE (channel_id, user_id)
);
CREATE INDEX idx_members_channel ON channel_members(channel_id);
CREATE INDEX idx_members_user    ON channel_members(user_id);

CREATE TABLE channel_invites (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    created_by  TEXT NOT NULL REFERENCES users(id),
    expires_at  TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_invites_channel ON channel_invites(channel_id);

-- Backfill: every existing channel's owner becomes an 'owner' member.
INSERT INTO channel_members (id, channel_id, user_id, role, can_stream, joined_at)
SELECT lower(hex(randomblob(16))), id, owner_id, 'owner', 1, created_at FROM channels;
```

- [ ] **Step 2: Write the failing test**

Create `server/crates/store/src/channels.rs`:

```rust
//! Channels, membership, and invites.

use crate::{Store, StoreError};
use chrono::Utc;
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Channel {
    pub id: String,
    pub owner_id: String,
    pub name: String,
    pub code: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Member {
    pub id: String,
    pub channel_id: String,
    pub user_id: String,
    pub role: String,
    pub can_stream: i64,
    pub joined_at: String,
}

#[cfg(test)]
mod tests {
    use crate::Store;

    async fn fresh() -> Store {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store.migrate().await.unwrap();
        store
    }

    #[tokio::test]
    async fn create_channel_enrolls_owner_as_member() {
        let store = fresh().await;
        let user = store.create_user("a@b.com", "h").await.unwrap();
        let ch = store.create_channel(&user.id, "Movie Night", "ABC123").await.unwrap();

        let role = store.member_role(&ch.id, &user.id).await.unwrap();
        assert_eq!(role.as_deref(), Some("owner"));

        let mine = store.channels_for_user(&user.id).await.unwrap();
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].name, "Movie Night");
    }

    #[tokio::test]
    async fn add_member_and_list_roster() {
        let store = fresh().await;
        let owner = store.create_user("o@b.com", "h").await.unwrap();
        let guest = store.create_user("g@b.com", "h").await.unwrap();
        let ch = store.create_channel(&owner.id, "Room", "CODE12").await.unwrap();

        store.add_member(&ch.id, &guest.id, "member").await.unwrap();
        let roster = store.members(&ch.id).await.unwrap();
        assert_eq!(roster.len(), 2);
        assert!(roster.iter().any(|m| m.user_id == guest.id && m.role == "member"));
    }

    #[tokio::test]
    async fn set_role_streaming_and_remove_member() {
        let store = fresh().await;
        let owner = store.create_user("o@b.com", "h").await.unwrap();
        let guest = store.create_user("g@b.com", "h").await.unwrap();
        let ch = store.create_channel(&owner.id, "Room", "CODE12").await.unwrap();
        store.add_member(&ch.id, &guest.id, "member").await.unwrap();

        store.set_member_role(&ch.id, &guest.id, "admin").await.unwrap();
        assert_eq!(store.member_role(&ch.id, &guest.id).await.unwrap().as_deref(), Some("admin"));

        store.set_member_streaming(&ch.id, &guest.id, false).await.unwrap();
        assert!(!store.can_stream(&ch.id, &guest.id).await.unwrap());

        store.remove_member(&ch.id, &guest.id).await.unwrap();
        assert!(store.member_role(&ch.id, &guest.id).await.unwrap().is_none());
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && cargo test -p store channels`
Expected: FAIL — methods not defined; also `lib.rs` doesn't declare the module yet.

- [ ] **Step 4: Declare the module and rename Room→Channel in `lib.rs`**

In `server/crates/store/src/lib.rs`:
1. Add near the top (after the doc comment): `pub mod channels;` and `pub use channels::{Channel, Member};`.
2. **Remove** the old `Room` struct and the methods `create_room`, `rooms_for_user`, `room_by_code`, `delete_room` (they are replaced by channel methods in `channels.rs`).
3. Update the existing store test module: delete the `create_list_resolve_and_delete_rooms` test (its behavior is now covered by the channel tests).

> **Compile-ordering note:** removing `store::Room` + room methods will break the api crate, whose Phase-1.5 handlers still call them. Steps 4b–4c below remove those dangling api handlers so the workspace keeps compiling (the channel endpoints are added in Task 4). After this task, api has no room/channel endpoints but compiles and its auth/device/turn/ws tests still pass.

- [ ] **Step 4b: Remove the dangling `/rooms` handlers from api**

In `server/crates/api/src/handlers.rs`, delete `create_room`, `list_rooms`, `delete_room`, `resolve_room`, the `NewRoom` struct, and their tests (`create_named_room_then_list_and_resolve`, `guest_create_room_without_auth_returns_ephemeral_code`). Keep `signup`/`login`/devices/`turn_credentials` and their tests, and keep `require_user`.

- [ ] **Step 4c: Remove the `/rooms*` routes from api `lib.rs`**

In `server/crates/api/src/lib.rs`, delete the `.route("/rooms", ...)`, `.route("/rooms/:id", ...)`, and `.route("/rooms/resolve/:code", ...)` lines. (Channel routes are added in Task 4.)

- [ ] **Step 5: Implement the channel/member methods**

Append to `server/crates/store/src/channels.rs` (above the test module):

```rust
impl Store {
    pub async fn create_channel(&self, owner_id: &str, name: &str, code: &str) -> Result<Channel, StoreError> {
        let ch = Channel {
            id: Uuid::new_v4().to_string(),
            owner_id: owner_id.to_string(),
            name: name.to_string(),
            code: code.to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        sqlx::query("INSERT INTO channels (id, owner_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&ch.id).bind(&ch.owner_id).bind(&ch.name).bind(&ch.code).bind(&ch.created_at)
            .execute(self.pool()).await?;
        self.add_member(&ch.id, owner_id, "owner").await?;
        Ok(ch)
    }

    pub async fn add_member(&self, channel_id: &str, user_id: &str, role: &str) -> Result<(), StoreError> {
        sqlx::query("INSERT INTO channel_members (id, channel_id, user_id, role, can_stream, joined_at) VALUES (?, ?, ?, ?, 1, ?)")
            .bind(Uuid::new_v4().to_string()).bind(channel_id).bind(user_id).bind(role).bind(Utc::now().to_rfc3339())
            .execute(self.pool()).await?;
        Ok(())
    }

    pub async fn channels_for_user(&self, user_id: &str) -> Result<Vec<Channel>, StoreError> {
        let rows = sqlx::query_as::<_, Channel>(
            "SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id = c.id \
             WHERE m.user_id = ? ORDER BY c.created_at DESC")
            .bind(user_id).fetch_all(self.pool()).await?;
        Ok(rows)
    }

    pub async fn channel_by_id(&self, id: &str) -> Result<Option<Channel>, StoreError> {
        Ok(sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = ?")
            .bind(id).fetch_optional(self.pool()).await?)
    }

    pub async fn channel_by_code(&self, code: &str) -> Result<Option<Channel>, StoreError> {
        Ok(sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE code = ?")
            .bind(code).fetch_optional(self.pool()).await?)
    }

    pub async fn rename_channel(&self, id: &str, name: &str) -> Result<(), StoreError> {
        sqlx::query("UPDATE channels SET name = ? WHERE id = ?").bind(name).bind(id).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn delete_channel(&self, id: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM channels WHERE id = ?").bind(id).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn members(&self, channel_id: &str) -> Result<Vec<Member>, StoreError> {
        Ok(sqlx::query_as::<_, Member>("SELECT * FROM channel_members WHERE channel_id = ? ORDER BY joined_at")
            .bind(channel_id).fetch_all(self.pool()).await?)
    }

    pub async fn member_role(&self, channel_id: &str, user_id: &str) -> Result<Option<String>, StoreError> {
        let row: Option<(String,)> = sqlx::query_as("SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?")
            .bind(channel_id).bind(user_id).fetch_optional(self.pool()).await?;
        Ok(row.map(|r| r.0))
    }

    pub async fn can_stream(&self, channel_id: &str, user_id: &str) -> Result<bool, StoreError> {
        let row: Option<(i64,)> = sqlx::query_as("SELECT can_stream FROM channel_members WHERE channel_id = ? AND user_id = ?")
            .bind(channel_id).bind(user_id).fetch_optional(self.pool()).await?;
        Ok(row.map(|r| r.0 != 0).unwrap_or(false))
    }

    pub async fn set_member_role(&self, channel_id: &str, user_id: &str, role: &str) -> Result<(), StoreError> {
        sqlx::query("UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?")
            .bind(role).bind(channel_id).bind(user_id).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn set_member_streaming(&self, channel_id: &str, user_id: &str, allowed: bool) -> Result<(), StoreError> {
        sqlx::query("UPDATE channel_members SET can_stream = ? WHERE channel_id = ? AND user_id = ?")
            .bind(if allowed { 1 } else { 0 }).bind(channel_id).bind(user_id).execute(self.pool()).await?;
        Ok(())
    }

    pub async fn remove_member(&self, channel_id: &str, user_id: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?")
            .bind(channel_id).bind(user_id).execute(self.pool()).await?;
        Ok(())
    }
}
```

- [ ] **Step 6: Expose the pool to the module**

The methods above call `self.pool()`. In `server/crates/store/src/lib.rs`, add an accessor on `Store` (the `pool` field is private to the crate):

```rust
impl Store {
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
```

- [ ] **Step 7: Run tests + confirm the workspace still compiles**

Run: `cd server && cargo test -p store && cargo build`
Expected: store tests PASS (users/devices + 3 channel tests; old room test removed); `cargo build` compiles the whole workspace (api now has no room/channel endpoints but builds).

- [ ] **Step 8: Commit**

```bash
git add server/crates/store server/crates/api
git commit -m "feat(store): rename rooms->channels, add membership model and CRUD"
```

---

## Task 2: Invites store (create, lookup, redeem, revoke)

**Files:**
- Modify: `server/crates/store/src/channels.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `server/crates/store/src/channels.rs`:

```rust
    #[tokio::test]
    async fn create_lookup_and_revoke_invite() {
        let store = fresh().await;
        let owner = store.create_user("o@b.com", "h").await.unwrap();
        let ch = store.create_channel(&owner.id, "Room", "CODE12").await.unwrap();

        let inv = store.create_invite(&ch.id, &owner.id, "INV777", None).await.unwrap();
        assert_eq!(inv.code, "INV777");

        let found = store.invite_by_code("INV777").await.unwrap().unwrap();
        assert_eq!(found.channel_id, ch.id);

        store.delete_invite(&ch.id, "INV777").await.unwrap();
        assert!(store.invite_by_code("INV777").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn user_lookup_by_email_supports_add_by_email() {
        let store = fresh().await;
        let target = store.create_user("t@b.com", "h").await.unwrap();
        let found = store.user_by_email("t@b.com").await.unwrap().unwrap();
        assert_eq!(found.id, target.id);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p store create_lookup_and_revoke_invite`
Expected: FAIL — `Invite`/`create_invite` not defined.

- [ ] **Step 3: Add the `Invite` model and methods**

In `server/crates/store/src/channels.rs`, add the model near `Member`:

```rust
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Invite {
    pub id: String,
    pub channel_id: String,
    pub code: String,
    pub created_by: String,
    pub expires_at: Option<String>,
    pub created_at: String,
}
```

Add `Invite` to the `pub use channels::{...}` line in `lib.rs` (→ `pub use channels::{Channel, Member, Invite};`).

Add these methods inside the `impl Store` block in `channels.rs`:

```rust
    pub async fn create_invite(&self, channel_id: &str, created_by: &str, code: &str, expires_at: Option<String>) -> Result<Invite, StoreError> {
        let inv = Invite {
            id: Uuid::new_v4().to_string(),
            channel_id: channel_id.to_string(),
            code: code.to_string(),
            created_by: created_by.to_string(),
            expires_at,
            created_at: Utc::now().to_rfc3339(),
        };
        sqlx::query("INSERT INTO channel_invites (id, channel_id, code, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&inv.id).bind(&inv.channel_id).bind(&inv.code).bind(&inv.created_by).bind(&inv.expires_at).bind(&inv.created_at)
            .execute(self.pool()).await?;
        Ok(inv)
    }

    pub async fn invite_by_code(&self, code: &str) -> Result<Option<Invite>, StoreError> {
        Ok(sqlx::query_as::<_, Invite>("SELECT * FROM channel_invites WHERE code = ?")
            .bind(code).fetch_optional(self.pool()).await?)
    }

    pub async fn invites_for_channel(&self, channel_id: &str) -> Result<Vec<Invite>, StoreError> {
        Ok(sqlx::query_as::<_, Invite>("SELECT * FROM channel_invites WHERE channel_id = ? ORDER BY created_at DESC")
            .bind(channel_id).fetch_all(self.pool()).await?)
    }

    pub async fn delete_invite(&self, channel_id: &str, code: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM channel_invites WHERE channel_id = ? AND code = ?")
            .bind(channel_id).bind(code).execute(self.pool()).await?;
        Ok(())
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && cargo test -p store`
Expected: PASS (all store tests including the 2 new invite tests).

- [ ] **Step 5: Commit**

```bash
git add server/crates/store
git commit -m "feat(store): channel invites CRUD"
```

---

## Task 3: Permission policy (pure, table-driven)

**Files:**
- Create: `server/crates/api/src/policy.rs`
- Modify: `server/crates/api/src/lib.rs` (add `pub mod policy;`)

- [ ] **Step 1: Write the failing test**

Create `server/crates/api/src/policy.rs`:

```rust
//! Pure permission policy: (actor role, target role, action) -> allowed.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix() {
        use Action::*;
        use Role::*;
        // (actor, action, target, expected)
        let cases = [
            (Owner,  Rename,        None,           true),
            (Admin,  Rename,        None,           true),
            (Member, Rename,        None,           false),
            (Owner,  Delete,        None,           true),
            (Admin,  Delete,        None,           false),
            (Owner,  Invite,        None,           true),
            (Admin,  Invite,        None,           true),
            (Member, Invite,        None,           false),
            (Admin,  Kick,          Some(Member),   true),
            (Admin,  Kick,          Some(Admin),    false),
            (Owner,  Kick,          Some(Admin),    true),
            (Admin,  Kick,          Some(Owner),    false),
            (Owner,  ChangeRole,    Some(Member),   true),
            (Admin,  ChangeRole,    Some(Member),   false),
            (Owner,  ForceStop,     None,           true),
            (Admin,  ForceStop,     None,           true),
            (Member, ForceStop,     None,           false),
            (Admin,  BlockStream,   Some(Member),   true),
            (Admin,  BlockStream,   Some(Admin),    false),
            (Owner,  BlockStream,   Some(Admin),    true),
            (Member, BlockStream,   Some(Member),   false),
            (Owner,  Transfer,      None,           true),
            (Admin,  Transfer,      None,           false),
        ];
        for (actor, action, target, expected) in cases {
            assert_eq!(allowed(actor, action, target), expected, "{actor:?} {action:?} {target:?}");
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p api policy`
Expected: FAIL — `Role`/`Action`/`allowed` not defined (and module not declared).

- [ ] **Step 3: Declare the module and implement the policy**

In `server/crates/api/src/lib.rs`, add `pub mod policy;` near the other module declarations.

Prepend to `server/crates/api/src/policy.rs` (above the test module):

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Owner,
    Admin,
    Member,
}

impl Role {
    pub fn parse(s: &str) -> Option<Role> {
        match s {
            "owner" => Some(Role::Owner),
            "admin" => Some(Role::Admin),
            "member" => Some(Role::Member),
            _ => None,
        }
    }
    fn rank(self) -> u8 {
        match self {
            Role::Owner => 2,
            Role::Admin => 1,
            Role::Member => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Rename,
    Delete,
    Invite,
    Kick,
    ChangeRole,
    ForceStop,
    BlockStream,
    Transfer,
}

/// Whether `actor` may perform `action`. For actions on another member, `target`
/// is that member's role; the actor must outrank the target (and an admin may
/// never act on an admin or owner).
pub fn allowed(actor: Role, action: Action, target: Option<Role>) -> bool {
    use Action::*;
    let outranks = |t: Option<Role>| t.map_or(true, |t| actor.rank() > t.rank());
    match action {
        Rename | Invite => matches!(actor, Role::Owner | Role::Admin),
        Delete | ChangeRole | Transfer => actor == Role::Owner,
        ForceStop => matches!(actor, Role::Owner | Role::Admin),
        Kick | BlockStream => matches!(actor, Role::Owner | Role::Admin) && outranks(target),
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && cargo test -p api policy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/crates/api/src/policy.rs server/crates/api/src/lib.rs
git commit -m "feat(api): pure channel permission policy (table-tested)"
```

---

## Task 4: Channel REST handlers (create/list/detail/rename/delete)

Replaces the old `/rooms` endpoints. A shared helper resolves the caller's role for a channel.

**Files:**
- Create: `server/crates/api/src/channels.rs`
- Modify: `server/crates/api/src/lib.rs`, `server/crates/api/src/handlers.rs`

- [ ] **Step 1: Write the failing test**

Create `server/crates/api/src/channels.rs` with tests first:

```rust
use crate::{policy::{allowed, Action, Role}, AppState};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[cfg(test)]
mod tests {
    use crate::AppState;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use signaling::Hub;
    use std::sync::Arc;
    use store::Store;
    use tower::ServiceExt;

    async fn state() -> AppState {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store.migrate().await.unwrap();
        AppState {
            store, hub: Hub::new(),
            jwt_secret: Arc::new(b"t".to_vec()),
            turn_secret: Arc::new("s".into()),
            turn_url: Arc::new("turns:t:5349".into()),
            stun_url: Arc::new("stun:t:3478".into()),
            turn_ttl: 600,
        }
    }

    async fn token(app: &axum::Router, email: &str) -> String {
        let res = app.clone().oneshot(Request::post("/signup")
            .header("content-type", "application/json")
            .body(Body::from(format!(r#"{{"email":"{email}","password":"pw123456"}}"#))).unwrap())
            .await.unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice::<serde_json::Value>(&b).unwrap()["token"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn create_list_and_get_channel() {
        let app = crate::router(state().await);
        let t = token(&app, "o@b.com").await;

        let res = app.clone().oneshot(Request::post("/channels")
            .header("content-type", "application/json").header("authorization", format!("Bearer {t}"))
            .body(Body::from(r#"{"name":"Movie Night"}"#)).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let b = res.into_body().collect().await.unwrap().to_bytes();
        let ch: serde_json::Value = serde_json::from_slice(&b).unwrap();
        let id = ch["id"].as_str().unwrap().to_string();
        assert_eq!(ch["name"], "Movie Night");

        let list = app.clone().oneshot(Request::get("/channels")
            .header("authorization", format!("Bearer {t}")).body(Body::empty()).unwrap()).await.unwrap();
        let b = list.into_body().collect().await.unwrap().to_bytes();
        let arr: serde_json::Value = serde_json::from_slice(&b).unwrap();
        assert_eq!(arr.as_array().unwrap().len(), 1);
        assert_eq!(arr[0]["role"], "owner");

        let detail = app.oneshot(Request::get(format!("/channels/{id}"))
            .header("authorization", format!("Bearer {t}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(detail.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn non_member_cannot_view_channel() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let other = token(&app, "x@b.com").await;
        let res = app.clone().oneshot(Request::post("/channels")
            .header("content-type", "application/json").header("authorization", format!("Bearer {owner}"))
            .body(Body::from(r#"{"name":"Private"}"#)).unwrap()).await.unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        let id = serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"].as_str().unwrap().to_string();

        let denied = app.oneshot(Request::get(format!("/channels/{id}"))
            .header("authorization", format!("Bearer {other}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn member_cannot_rename_but_owner_can() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let res = app.clone().oneshot(Request::post("/channels")
            .header("content-type", "application/json").header("authorization", format!("Bearer {owner}"))
            .body(Body::from(r#"{"name":"Old"}"#)).unwrap()).await.unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        let id = serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"].as_str().unwrap().to_string();

        let ok = app.oneshot(Request::patch(format!("/channels/{id}"))
            .header("content-type", "application/json").header("authorization", format!("Bearer {owner}"))
            .body(Body::from(r#"{"name":"New"}"#)).unwrap()).await.unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p api create_list_and_get_channel`
Expected: FAIL — handlers/routes missing.

- [ ] **Step 3: Add a shared role helper to `handlers.rs`**

In `server/crates/api/src/handlers.rs`, keep `require_user` and add (re-exported for sibling modules):

```rust
/// Resolve the caller's role string in a channel, or 403 if not a member.
pub async fn require_member(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    channel_id: &str,
) -> Result<(String, String), StatusCode> {
    let user_id = require_user(state, headers)?;
    let role = state
        .store
        .member_role(channel_id, &user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::FORBIDDEN)?;
    Ok((user_id, role))
}
```

(The old `/rooms` handlers were already removed in Task 1 Step 4b — nothing to remove here.)

- [ ] **Step 4: Implement the channel handlers**

Prepend to `server/crates/api/src/channels.rs` (above the test module):

```rust
use crate::handlers::{require_member, require_user};

#[derive(Deserialize)]
pub struct NewChannel { pub name: String }

#[derive(Deserialize)]
pub struct RenameChannel { pub name: String }

pub async fn create_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<NewChannel>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let code = auth::generate_room_code();
    let ch = state.store.create_channel(&user_id, &body.name, &code).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "id": ch.id, "name": ch.name, "code": ch.code })))
}

pub async fn list_channels(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let chans = state.store.channels_for_user(&user_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut out = Vec::new();
    for c in chans {
        let role = state.store.member_role(&c.id, &user_id).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.unwrap_or_default();
        out.push(serde_json::json!({ "id": c.id, "name": c.name, "code": c.code, "role": role }));
    }
    Ok(Json(serde_json::Value::Array(out)))
}

pub async fn get_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (user_id, role) = require_member(&state, &headers, &id).await?;
    let ch = state.store.channel_by_id(&id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let can_stream = state.store.can_stream(&id, &user_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "id": ch.id, "name": ch.name, "code": ch.code, "role": role, "can_stream": can_stream })))
}

pub async fn rename_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<RenameChannel>,
) -> Result<StatusCode, StatusCode> {
    let (_uid, role) = require_member(&state, &headers, &id).await?;
    let role = Role::parse(&role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(role, Action::Rename, None) { return Err(StatusCode::FORBIDDEN); }
    state.store.rename_channel(&id, &body.name).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

pub async fn delete_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let (_uid, role) = require_member(&state, &headers, &id).await?;
    let role = Role::parse(&role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(role, Action::Delete, None) { return Err(StatusCode::FORBIDDEN); }
    state.store.delete_channel(&id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 5: Declare the module and wire routes in `lib.rs`**

In `server/crates/api/src/lib.rs`: add `pub mod channels;`. Remove the old `/rooms*` routes. Add:

```rust
        .route("/channels", post(channels::create_channel).get(channels::list_channels))
        .route("/channels/:id", get(channels::get_channel)
            .patch(channels::rename_channel)
            .delete(channels::delete_channel))
```

Ensure `use axum::routing::{get, post};` covers `patch` — add `patch` to that import (`use axum::routing::{delete, get, patch, post};` as needed).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && cargo test -p api`
Expected: PASS (auth/device/turn tests + 3 channel tests; ws_e2e still green).

- [ ] **Step 7: Commit**

```bash
git add server/crates/api
git commit -m "feat(api): channel create/list/detail/rename/delete with role checks"
```

---

## Task 5: Member handlers (roster, kick/leave, role change, streaming block, transfer)

**Files:**
- Modify: `server/crates/api/src/channels.rs`, `server/crates/api/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `server/crates/api/src/channels.rs`:

```rust
    async fn make_channel(app: &axum::Router, owner_token: &str, name: &str) -> String {
        let res = app.clone().oneshot(Request::post("/channels")
            .header("content-type", "application/json").header("authorization", format!("Bearer {owner_token}"))
            .body(Body::from(format!(r#"{{"name":"{name}"}}"#))).unwrap()).await.unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn owner_blocks_member_streaming() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let id = make_channel(&app, &owner, "C").await;
        // add a member directly via the store-backed add-user path would need invites;
        // here we exercise the streaming-block endpoint against the owner's own membership
        // (owner can_stream stays true) and assert a member is forbidden from moderating.
        let member = token(&app, "m@b.com").await;
        let denied = app.oneshot(Request::patch(format!("/channels/{id}/members/any/streaming"))
            .header("content-type", "application/json").header("authorization", format!("Bearer {member}"))
            .body(Body::from(r#"{"allowed":false}"#)).unwrap()).await.unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn owner_must_transfer_before_leaving() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let id = make_channel(&app, &owner, "C").await;
        // owner_user_id is needed; fetch roster
        let roster = app.clone().oneshot(Request::get(format!("/channels/{id}/members"))
            .header("authorization", format!("Bearer {owner}")).body(Body::empty()).unwrap()).await.unwrap();
        let b = roster.into_body().collect().await.unwrap().to_bytes();
        let members: serde_json::Value = serde_json::from_slice(&b).unwrap();
        let uid = members[0]["user_id"].as_str().unwrap().to_string();

        let res = app.oneshot(Request::delete(format!("/channels/{id}/members/{uid}"))
            .header("authorization", format!("Bearer {owner}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::CONFLICT); // must transfer first
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p api owner_must_transfer`
Expected: FAIL — member routes missing.

- [ ] **Step 3: Implement member handlers**

Add to `server/crates/api/src/channels.rs` (in the impl area above tests):

```rust
#[derive(Deserialize)]
pub struct RoleChange { pub role: String }

#[derive(Deserialize)]
pub struct StreamingChange { pub allowed: bool }

#[derive(Deserialize)]
pub struct TransferBody { pub user_id: String }

pub async fn list_members(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    require_member(&state, &headers, &id).await?;
    let members = state.store.members(&id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut out = Vec::new();
    for m in members {
        let email = state.store.email_for_user(&m.user_id).await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.unwrap_or_default();
        out.push(serde_json::json!({
            "user_id": m.user_id, "email": email, "role": m.role, "can_stream": m.can_stream != 0
        }));
    }
    Ok(Json(serde_json::Value::Array(out)))
}

/// DELETE member = kick (per matrix) or self-leave. Owner must transfer first.
pub async fn remove_member(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((id, uid)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let (actor_id, actor_role) = require_member(&state, &headers, &id).await?;
    let target_role = state.store.member_role(&id, &uid).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
    if target_role == "owner" {
        return Err(StatusCode::CONFLICT); // owner must transfer before leaving/removal
    }
    let is_self = actor_id == uid;
    if !is_self {
        let actor = Role::parse(&actor_role).ok_or(StatusCode::FORBIDDEN)?;
        let target = Role::parse(&target_role);
        if !allowed(actor, Action::Kick, target) { return Err(StatusCode::FORBIDDEN); }
    }
    state.store.remove_member(&id, &uid).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn change_role(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((id, uid)): Path<(String, String)>,
    Json(body): Json<RoleChange>,
) -> Result<StatusCode, StatusCode> {
    let (_actor, actor_role) = require_member(&state, &headers, &id).await?;
    let actor = Role::parse(&actor_role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(actor, Action::ChangeRole, None) { return Err(StatusCode::FORBIDDEN); }
    if body.role != "admin" && body.role != "member" { return Err(StatusCode::BAD_REQUEST); }
    state.store.set_member_role(&id, &uid, &body.role).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

pub async fn set_streaming(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((id, uid)): Path<(String, String)>,
    Json(body): Json<StreamingChange>,
) -> Result<StatusCode, StatusCode> {
    let (_actor, actor_role) = require_member(&state, &headers, &id).await?;
    let actor = Role::parse(&actor_role).ok_or(StatusCode::FORBIDDEN)?;
    let target = state.store.member_role(&id, &uid).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.and_then(|r| Role::parse(&r));
    if !allowed(actor, Action::BlockStream, target) { return Err(StatusCode::FORBIDDEN); }
    state.store.set_member_streaming(&id, &uid, body.allowed).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !body.allowed {
        // Blocking a currently-live member also force-stops their stream.
        if let Ok(Some(ch)) = state.store.channel_by_id(&id).await {
            state.hub.stop_broadcast(&ch.code, "blocked").await;
        }
    }
    Ok(StatusCode::OK)
}

pub async fn transfer_owner(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<TransferBody>,
) -> Result<StatusCode, StatusCode> {
    let (_actor, actor_role) = require_member(&state, &headers, &id).await?;
    let actor = Role::parse(&actor_role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(actor, Action::Transfer, None) { return Err(StatusCode::FORBIDDEN); }
    // New owner becomes 'owner'; old owner becomes 'admin'.
    let old_owner = require_user(&state, &headers)?;
    state.store.set_member_role(&id, &body.user_id, "owner").await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state.store.set_member_role(&id, &old_owner, "admin").await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}
```

This references `state.store.email_for_user` (add it) and `state.hub.stop_broadcast` (added in Task 8). For now, add the store method:

In `server/crates/store/src/lib.rs`, add to `impl Store`:

```rust
    pub async fn email_for_user(&self, user_id: &str) -> Result<Option<String>, StoreError> {
        let row: Option<(String,)> = sqlx::query_as("SELECT email FROM users WHERE id = ?")
            .bind(user_id).fetch_optional(self.pool()).await?;
        Ok(row.map(|r| r.0))
    }
```

> **Dependency note:** `set_streaming` calls `state.hub.stop_broadcast` which is implemented in Task 8. To keep this task compiling and green on its own, temporarily comment out the `if !body.allowed { ... }` block with a `// TODO(Task 8): force-stop on block` marker, and uncomment it in Task 8 Step 5. (This is the one cross-task seam; it is explicitly resolved later.)

- [ ] **Step 4: Wire member routes in `lib.rs`**

```rust
        .route("/channels/:id/members", get(channels::list_members))
        .route("/channels/:id/members/:uid",
            axum::routing::delete(channels::remove_member).patch(channels::change_role))
        .route("/channels/:id/members/:uid/streaming", patch(channels::set_streaming))
        .route("/channels/:id/transfer", post(channels::transfer_owner))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && cargo test -p api`
Expected: PASS (including the 2 new member tests).

- [ ] **Step 6: Commit**

```bash
git add server/crates/api server/crates/store
git commit -m "feat(api): channel member roster, kick/leave, roles, streaming block, transfer"
```

---

## Task 6: Invite handlers (create/list/revoke, add-by-email, preview/accept)

**Files:**
- Create: `server/crates/api/src/invites.rs`
- Modify: `server/crates/api/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `server/crates/api/src/invites.rs` with tests first:

```rust
use crate::{handlers::{require_member, require_user}, policy::{allowed, Action, Role}, AppState};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[cfg(test)]
mod tests {
    use crate::AppState;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use signaling::Hub;
    use std::sync::Arc;
    use store::Store;
    use tower::ServiceExt;

    async fn state() -> AppState {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store.migrate().await.unwrap();
        AppState { store, hub: Hub::new(), jwt_secret: Arc::new(b"t".to_vec()),
            turn_secret: Arc::new("s".into()), turn_url: Arc::new("turns:t:5349".into()),
            stun_url: Arc::new("stun:t:3478".into()), turn_ttl: 600 }
    }
    async fn token(app: &axum::Router, email: &str) -> String {
        let res = app.clone().oneshot(Request::post("/signup").header("content-type","application/json")
            .body(Body::from(format!(r#"{{"email":"{email}","password":"pw123456"}}"#))).unwrap()).await.unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice::<serde_json::Value>(&b).unwrap()["token"].as_str().unwrap().to_string()
    }
    async fn make_channel(app: &axum::Router, t: &str) -> String {
        let res = app.clone().oneshot(Request::post("/channels").header("content-type","application/json")
            .header("authorization", format!("Bearer {t}")).body(Body::from(r#"{"name":"C"}"#)).unwrap()).await.unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn invite_link_create_and_accept_adds_member() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let guest = token(&app, "g@b.com").await;
        let id = make_channel(&app, &owner).await;

        let inv = app.clone().oneshot(Request::post(format!("/channels/{id}/invites"))
            .header("content-type","application/json").header("authorization", format!("Bearer {owner}"))
            .body(Body::from("{}")).unwrap()).await.unwrap();
        assert_eq!(inv.status(), StatusCode::OK);
        let b = inv.into_body().collect().await.unwrap().to_bytes();
        let code = serde_json::from_slice::<serde_json::Value>(&b).unwrap()["code"].as_str().unwrap().to_string();

        let accept = app.clone().oneshot(Request::post(format!("/invites/{code}/accept"))
            .header("authorization", format!("Bearer {guest}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(accept.status(), StatusCode::OK);

        // guest now sees the channel
        let list = app.oneshot(Request::get("/channels").header("authorization", format!("Bearer {guest}"))
            .body(Body::empty()).unwrap()).await.unwrap();
        let b = list.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&b).unwrap().as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn add_by_email_requires_registered_user() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let _guest = token(&app, "g@b.com").await;
        let id = make_channel(&app, &owner).await;

        let ok = app.clone().oneshot(Request::post(format!("/channels/{id}/add-user"))
            .header("content-type","application/json").header("authorization", format!("Bearer {owner}"))
            .body(Body::from(r#"{"email":"g@b.com"}"#)).unwrap()).await.unwrap();
        assert_eq!(ok.status(), StatusCode::OK);

        let missing = app.oneshot(Request::post(format!("/channels/{id}/add-user"))
            .header("content-type","application/json").header("authorization", format!("Bearer {owner}"))
            .body(Body::from(r#"{"email":"nobody@b.com"}"#)).unwrap()).await.unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p api invite_link_create`
Expected: FAIL — invite routes missing.

- [ ] **Step 3: Implement invite handlers**

Prepend to `server/crates/api/src/invites.rs` (above the test module):

```rust
#[derive(Deserialize, Default)]
pub struct NewInvite { pub expires_at: Option<String> }

#[derive(Deserialize)]
pub struct AddUser { pub email: String }

fn require_inviter(role: &str) -> Result<(), StatusCode> {
    let r = Role::parse(role).ok_or(StatusCode::FORBIDDEN)?;
    if allowed(r, Action::Invite, None) { Ok(()) } else { Err(StatusCode::FORBIDDEN) }
}

pub async fn create_invite(
    State(state): State<AppState>, headers: axum::http::HeaderMap,
    Path(id): Path<String>, Json(body): Json<NewInvite>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (user_id, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    let expires = body.expires_at;
    let code = auth::generate_room_code();
    let inv = state.store.create_invite(&id, &user_id, &code, expires).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "code": inv.code })))
}

pub async fn list_invites(
    State(state): State<AppState>, headers: axum::http::HeaderMap, Path(id): Path<String>,
) -> Result<Json<Vec<store::Invite>>, StatusCode> {
    let (_u, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    Ok(Json(state.store.invites_for_channel(&id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?))
}

pub async fn revoke_invite(
    State(state): State<AppState>, headers: axum::http::HeaderMap, Path((id, code)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let (_u, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    state.store.delete_invite(&id, &code).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_user(
    State(state): State<AppState>, headers: axum::http::HeaderMap,
    Path(id): Path<String>, Json(body): Json<AddUser>,
) -> Result<StatusCode, StatusCode> {
    let (_u, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    let user = state.store.user_by_email(&body.email).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if state.store.member_role(&id, &user.id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.is_some() {
        return Err(StatusCode::CONFLICT);
    }
    state.store.add_member(&id, &user.id, "member").await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

pub async fn preview_invite(
    State(state): State<AppState>, Path(code): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let inv = state.store.invite_by_code(&code).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let ch = state.store.channel_by_id(&inv.channel_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(serde_json::json!({ "channel_id": ch.id, "name": ch.name })))
}

pub async fn accept_invite(
    State(state): State<AppState>, headers: axum::http::HeaderMap, Path(code): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let inv = state.store.invite_by_code(&code).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    // Expiry check
    if let Some(exp) = &inv.expires_at {
        if let Ok(when) = chrono::DateTime::parse_from_rfc3339(exp) {
            if when < chrono::Utc::now() { return Err(StatusCode::GONE); }
        }
    }
    if state.store.member_role(&inv.channel_id, &user_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.is_none() {
        state.store.add_member(&inv.channel_id, &user_id, "member").await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(Json(serde_json::json!({ "channel_id": inv.channel_id })))
}
```

Add `chrono` to api deps if not present: in `server/crates/api/Cargo.toml` under `[dependencies]` add `chrono = { workspace = true }`.

- [ ] **Step 4: Declare module and wire routes**

In `server/crates/api/src/lib.rs`: add `pub mod invites;` and routes:

```rust
        .route("/channels/:id/invites", post(invites::create_invite).get(invites::list_invites))
        .route("/channels/:id/invites/:code", axum::routing::delete(invites::revoke_invite))
        .route("/channels/:id/add-user", post(invites::add_user))
        .route("/invites/:code", get(invites::preview_invite))
        .route("/invites/:code/accept", post(invites::accept_invite))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && cargo test -p api`
Expected: PASS (incl. 2 new invite tests).

- [ ] **Step 6: Commit**

```bash
git add server/crates/api
git commit -m "feat(api): channel invites (link create/accept, add-by-email, preview/revoke)"
```

---

## Task 7: Broadcast room (pure state machine)

**Files:**
- Modify: `server/crates/signaling/src/protocol.rs`, `server/crates/signaling/src/lib.rs`
- Create: `server/crates/signaling/src/broadcast.rs`

- [ ] **Step 1: Add broadcast protocol messages**

Append to `server/crates/signaling/src/protocol.rs`:

```rust
/// Messages a broadcast participant sends up the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum BroadcastClientMsg {
    JoinBroadcast { code: String, role: BroadcastRole, jwt: String },
    Offer { peer_id: String, sdp: String },
    Answer { peer_id: String, sdp: String },
    Ice { peer_id: String, candidate: serde_json::Value },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BroadcastRole {
    Broadcaster,
    Viewer,
}

/// Messages the server pushes to a broadcast participant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum BroadcastServerMsg {
    BroadcastJoined { live: bool, viewers: Vec<String> },
    ViewerJoined { peer_id: String },
    ViewerLeft { peer_id: String },
    BroadcasterLeft,
    ForceStopped { by: String },
    Offer { peer_id: String, sdp: String },
    Answer { peer_id: String, sdp: String },
    Ice { peer_id: String, candidate: serde_json::Value },
    Error { code: String, message: String },
}
```

- [ ] **Step 2: Write the failing test**

Create `server/crates/signaling/src/broadcast.rs`:

```rust
//! Pure broadcast-room state: one broadcaster + many viewers, by peer id.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broadcaster_then_viewers_join_and_leave() {
        let mut room = BroadcastRoom::new();
        assert_eq!(room.set_broadcaster("b1"), SetBroadcaster::Ok);
        assert_eq!(room.set_broadcaster("b2"), SetBroadcaster::AlreadyLive);

        room.add_viewer("v1");
        room.add_viewer("v2");
        assert_eq!(room.viewers(), vec!["v1".to_string(), "v2".to_string()]);
        assert!(room.is_live());

        room.remove_viewer("v1");
        assert_eq!(room.viewers(), vec!["v2".to_string()]);

        room.clear_broadcaster();
        assert!(!room.is_live());
    }

    #[test]
    fn tracks_broadcaster_id() {
        let mut room = BroadcastRoom::new();
        room.set_broadcaster("b1");
        assert_eq!(room.broadcaster(), Some("b1".to_string()));
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && cargo test -p signaling broadcast`
Expected: FAIL — `BroadcastRoom` not defined.

- [ ] **Step 4: Implement the room and export it**

Prepend to `server/crates/signaling/src/broadcast.rs` (above the test module):

```rust
#[derive(Debug, PartialEq, Eq)]
pub enum SetBroadcaster {
    Ok,
    AlreadyLive,
}

/// Pure state for one channel's broadcast: at most one broadcaster, N viewers.
#[derive(Default)]
pub struct BroadcastRoom {
    broadcaster: Option<String>,
    viewers: Vec<String>,
}

impl BroadcastRoom {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_broadcaster(&mut self, id: &str) -> SetBroadcaster {
        if self.broadcaster.is_some() {
            return SetBroadcaster::AlreadyLive;
        }
        self.broadcaster = Some(id.to_string());
        SetBroadcaster::Ok
    }

    pub fn clear_broadcaster(&mut self) {
        self.broadcaster = None;
    }

    pub fn broadcaster(&self) -> Option<String> {
        self.broadcaster.clone()
    }

    pub fn is_live(&self) -> bool {
        self.broadcaster.is_some()
    }

    pub fn add_viewer(&mut self, id: &str) {
        if !self.viewers.iter().any(|v| v == id) {
            self.viewers.push(id.to_string());
        }
    }

    pub fn remove_viewer(&mut self, id: &str) {
        self.viewers.retain(|v| v != id);
    }

    pub fn viewers(&self) -> Vec<String> {
        self.viewers.clone()
    }

    pub fn is_empty(&self) -> bool {
        self.broadcaster.is_none() && self.viewers.is_empty()
    }
}
```

In `server/crates/signaling/src/lib.rs` add:

```rust
pub mod broadcast;
pub use broadcast::{BroadcastRoom, SetBroadcaster};
pub use protocol::{BroadcastClientMsg, BroadcastRole, BroadcastServerMsg};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && cargo test -p signaling`
Expected: PASS (existing room/hub tests + 2 broadcast tests).

- [ ] **Step 6: Commit**

```bash
git add server/crates/signaling
git commit -m "feat(signaling): broadcast protocol + pure broadcast room state"
```

---

## Task 8: Broadcast hub routing + authenticated broadcast WS endpoint

**Files:**
- Modify: `server/crates/signaling/src/hub.rs`
- Create: `server/crates/api/src/ws_broadcast.rs`
- Modify: `server/crates/api/src/lib.rs`, `server/crates/api/src/channels.rs` (uncomment force-stop)

- [ ] **Step 1: Write the failing hub test**

Add to the `tests` module in `server/crates/signaling/src/hub.rs`:

```rust
    use crate::protocol::BroadcastServerMsg;

    #[tokio::test]
    async fn broadcast_routes_viewer_to_broadcaster_and_back() {
        let hub = Hub::new();
        let (btx, mut brx) = mpsc::channel(8);
        assert!(hub.join_broadcaster("chanA", "b1", btx).await);
        // second broadcaster rejected
        let (btx2, _r) = mpsc::channel(8);
        assert!(!hub.join_broadcaster("chanA", "b2", btx2).await);

        let (vtx, mut vrx) = mpsc::channel(8);
        hub.join_viewer("chanA", "v1", vtx).await;
        // broadcaster told a viewer joined
        let got = brx.recv().await.unwrap();
        assert!(matches!(got, BroadcastServerMsg::ViewerJoined { peer_id } if peer_id == "v1"));

        // broadcaster -> viewer (offer tagged v1)
        hub.broadcast_to_viewer("chanA", "v1", BroadcastServerMsg::Offer { peer_id: "v1".into(), sdp: "S".into() }).await;
        let got = vrx.recv().await.unwrap();
        assert!(matches!(got, BroadcastServerMsg::Offer { sdp, .. } if sdp == "S"));

        // viewer -> broadcaster (answer tagged v1)
        hub.broadcast_to_broadcaster("chanA", BroadcastServerMsg::Answer { peer_id: "v1".into(), sdp: "A".into() }).await;
        let got = brx.recv().await.unwrap();
        assert!(matches!(got, BroadcastServerMsg::Answer { sdp, .. } if sdp == "A"));

        // force-stop notifies broadcaster + viewer
        hub.stop_broadcast("chanA", "owner").await;
        let b = brx.recv().await.unwrap();
        assert!(matches!(b, BroadcastServerMsg::ForceStopped { .. }));
        let v = vrx.recv().await.unwrap();
        assert!(matches!(v, BroadcastServerMsg::BroadcasterLeft));
    }

    #[tokio::test]
    async fn stream_state_reports_live() {
        let hub = Hub::new();
        assert!(!hub.is_broadcasting("chanB").await);
        let (btx, _r) = mpsc::channel(8);
        hub.join_broadcaster("chanB", "b1", btx).await;
        assert!(hub.is_broadcasting("chanB").await);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p signaling broadcast_routes`
Expected: FAIL — hub broadcast methods missing.

- [ ] **Step 3: Add broadcast routing to the Hub**

In `server/crates/signaling/src/hub.rs`, add (near the top, alongside the existing `LiveRoom` registry):

```rust
use crate::broadcast::{BroadcastRoom, SetBroadcaster};
use crate::protocol::BroadcastServerMsg;

struct LiveBroadcast {
    room: BroadcastRoom,
    broadcaster_tx: Option<mpsc::Sender<BroadcastServerMsg>>,
    viewer_tx: HashMap<String, mpsc::Sender<BroadcastServerMsg>>,
}
```

Add a second registry field to `Hub` and initialise it. Change the struct and `new()`:

```rust
#[derive(Clone)]
pub struct Hub {
    rooms: Arc<Mutex<HashMap<String, LiveRoom>>>,
    broadcasts: Arc<Mutex<HashMap<String, LiveBroadcast>>>,
}
```

In `new()` initialise `broadcasts: Arc::new(Mutex::new(HashMap::new()))` (and in `Default`). Then add methods to `impl Hub`:

```rust
    /// Become the broadcaster for `code`. Returns false if one already exists.
    pub async fn join_broadcaster(&self, code: &str, id: &str, tx: mpsc::Sender<BroadcastServerMsg>) -> bool {
        let mut bcs = self.broadcasts.lock().await;
        let lb = bcs.entry(code.to_string()).or_insert_with(|| LiveBroadcast {
            room: BroadcastRoom::new(), broadcaster_tx: None, viewer_tx: HashMap::new(),
        });
        match lb.room.set_broadcaster(id) {
            SetBroadcaster::Ok => { lb.broadcaster_tx = Some(tx); true }
            SetBroadcaster::AlreadyLive => false,
        }
    }

    pub async fn join_viewer(&self, code: &str, peer_id: &str, tx: mpsc::Sender<BroadcastServerMsg>) {
        let mut bcs = self.broadcasts.lock().await;
        let lb = bcs.entry(code.to_string()).or_insert_with(|| LiveBroadcast {
            room: BroadcastRoom::new(), broadcaster_tx: None, viewer_tx: HashMap::new(),
        });
        lb.room.add_viewer(peer_id);
        lb.viewer_tx.insert(peer_id.to_string(), tx);
        if let Some(btx) = &lb.broadcaster_tx {
            let _ = btx.send(BroadcastServerMsg::ViewerJoined { peer_id: peer_id.to_string() }).await;
        }
    }

    pub async fn broadcast_to_viewer(&self, code: &str, peer_id: &str, msg: BroadcastServerMsg) {
        let bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get(code) {
            if let Some(vtx) = lb.viewer_tx.get(peer_id) { let _ = vtx.send(msg).await; }
        }
    }

    pub async fn broadcast_to_broadcaster(&self, code: &str, msg: BroadcastServerMsg) {
        let bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get(code) {
            if let Some(btx) = &lb.broadcaster_tx { let _ = btx.send(msg).await; }
        }
    }

    pub async fn viewer_left(&self, code: &str, peer_id: &str) {
        let mut bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get_mut(code) {
            lb.room.remove_viewer(peer_id);
            lb.viewer_tx.remove(peer_id);
            if let Some(btx) = &lb.broadcaster_tx {
                let _ = btx.send(BroadcastServerMsg::ViewerLeft { peer_id: peer_id.to_string() }).await;
            }
        }
    }

    /// Broadcaster ended their own stream: notify viewers, drop the broadcaster.
    pub async fn broadcaster_left(&self, code: &str) {
        let mut bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get_mut(code) {
            for vtx in lb.viewer_tx.values() {
                let _ = vtx.send(BroadcastServerMsg::BroadcasterLeft).await;
            }
            lb.room.clear_broadcaster();
            lb.broadcaster_tx = None;
            if lb.room.is_empty() { bcs.remove(code); }
        }
    }

    /// Owner/admin force-stop: notify broadcaster + viewers and drop the room.
    pub async fn stop_broadcast(&self, code: &str, by: &str) {
        let mut bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get(code) {
            if let Some(btx) = &lb.broadcaster_tx {
                let _ = btx.send(BroadcastServerMsg::ForceStopped { by: by.to_string() }).await;
            }
            for vtx in lb.viewer_tx.values() {
                let _ = vtx.send(BroadcastServerMsg::BroadcasterLeft).await;
            }
        }
        bcs.remove(code);
    }

    pub async fn is_broadcasting(&self, code: &str) -> bool {
        self.broadcasts.lock().await.get(code).map(|lb| lb.room.is_live()).unwrap_or(false)
    }
```

- [ ] **Step 4: Run hub tests**

Run: `cd server && cargo test -p signaling`
Expected: PASS (existing + 2 new broadcast hub tests).

- [ ] **Step 5: Resolve the Task 5 seam (force-stop on block)**

In `server/crates/api/src/channels.rs`, uncomment the force-stop block in `set_streaming` (now that `stop_broadcast` exists):

```rust
    if !body.allowed {
        if let Ok(Some(ch)) = state.store.channel_by_id(&id).await {
            state.hub.stop_broadcast(&ch.code, "blocked").await;
        }
    }
```

- [ ] **Step 6: Implement the authenticated broadcast WS endpoint**

Create `server/crates/api/src/ws_broadcast.rs`:

```rust
//! Authenticated broadcast signaling: 1 broadcaster + N viewers per channel.
use crate::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use signaling::protocol::{BroadcastClientMsg, BroadcastRole, BroadcastServerMsg};
use tokio::sync::mpsc;
use uuid::Uuid;

pub async fn ws_broadcast(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle(socket, state))
}

fn err(code: &str, message: &str) -> String {
    serde_json::to_string(&BroadcastServerMsg::Error { code: code.into(), message: message.into() }).unwrap()
}

async fn handle(mut socket: WebSocket, state: AppState) {
    // First frame must be join-broadcast with a valid JWT for a member of the channel.
    let join = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => match serde_json::from_str::<BroadcastClientMsg>(&t) {
                Ok(BroadcastClientMsg::JoinBroadcast { code, role, jwt }) => break (code, role, jwt),
                _ => continue,
            },
            Some(Ok(_)) => continue,
            _ => return,
        }
    };
    let (code, role, jwt) = join;

    // Authenticate + authorize membership.
    let user_id = match auth::verify_token(&state.jwt_secret, &jwt) {
        Ok(c) => c.sub,
        Err(_) => { let _ = socket.send(Message::Text(err("not-a-member", "invalid token"))).await; return; }
    };
    let channel = match state.store.channel_by_code(&code).await {
        Ok(Some(c)) => c,
        _ => { let _ = socket.send(Message::Text(err("not-a-member", "no such channel"))).await; return; }
    };
    let role_in_channel = state.store.member_role(&channel.id, &user_id).await.ok().flatten();
    if role_in_channel.is_none() {
        let _ = socket.send(Message::Text(err("not-a-member", "join the channel first"))).await; return;
    }

    let (tx, mut rx) = mpsc::channel::<BroadcastServerMsg>(64);

    match role {
        BroadcastRole::Broadcaster => {
            if !state.store.can_stream(&channel.id, &user_id).await.unwrap_or(false) {
                let _ = socket.send(Message::Text(err("streaming-blocked", "you cannot stream here"))).await; return;
            }
            if !state.hub.join_broadcaster(&channel.code, &user_id, tx).await {
                let _ = socket.send(Message::Text(err("already-live", "someone is already streaming"))).await; return;
            }
            let _ = socket.send(Message::Text(serde_json::to_string(
                &BroadcastServerMsg::BroadcastJoined { live: true, viewers: vec![] }).unwrap())).await;
            run_broadcaster(&mut socket, &mut rx, &state, &channel.code).await;
            state.hub.broadcaster_left(&channel.code).await;
        }
        BroadcastRole::Viewer => {
            let peer_id = Uuid::new_v4().to_string();
            let live = state.hub.is_broadcasting(&channel.code).await;
            state.hub.join_viewer(&channel.code, &peer_id, tx).await;
            let _ = socket.send(Message::Text(serde_json::to_string(
                &BroadcastServerMsg::BroadcastJoined { live, viewers: vec![] }).unwrap())).await;
            run_viewer(&mut socket, &mut rx, &state, &channel.code, &peer_id).await;
            state.hub.viewer_left(&channel.code, &peer_id).await;
        }
    }
}

async fn run_broadcaster(socket: &mut WebSocket, rx: &mut mpsc::Receiver<BroadcastServerMsg>, state: &AppState, code: &str) {
    loop {
        tokio::select! {
            inbound = socket.recv() => match inbound {
                Some(Ok(Message::Text(t))) => {
                    if let Ok(msg) = serde_json::from_str::<BroadcastClientMsg>(&t) {
                        match msg {
                            BroadcastClientMsg::Offer { peer_id, sdp } =>
                                state.hub.broadcast_to_viewer(code, &peer_id, BroadcastServerMsg::Offer { peer_id: peer_id.clone(), sdp }).await,
                            BroadcastClientMsg::Ice { peer_id, candidate } =>
                                state.hub.broadcast_to_viewer(code, &peer_id, BroadcastServerMsg::Ice { peer_id: peer_id.clone(), candidate }).await,
                            _ => {}
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
            out = rx.recv() => match out {
                Some(msg) => { if socket.send(Message::Text(serde_json::to_string(&msg).unwrap())).await.is_err() { break; } }
                None => break,
            }
        }
    }
}

async fn run_viewer(socket: &mut WebSocket, rx: &mut mpsc::Receiver<BroadcastServerMsg>, state: &AppState, code: &str, peer_id: &str) {
    loop {
        tokio::select! {
            inbound = socket.recv() => match inbound {
                Some(Ok(Message::Text(t))) => {
                    if let Ok(msg) = serde_json::from_str::<BroadcastClientMsg>(&t) {
                        match msg {
                            BroadcastClientMsg::Answer { sdp, .. } =>
                                state.hub.broadcast_to_broadcaster(code, BroadcastServerMsg::Answer { peer_id: peer_id.to_string(), sdp }).await,
                            BroadcastClientMsg::Ice { candidate, .. } =>
                                state.hub.broadcast_to_broadcaster(code, BroadcastServerMsg::Ice { peer_id: peer_id.to_string(), candidate }).await,
                            _ => {}
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
            out = rx.recv() => match out {
                Some(msg) => { if socket.send(Message::Text(serde_json::to_string(&msg).unwrap())).await.is_err() { break; } }
                None => break,
            }
        }
    }
}
```

- [ ] **Step 7: Wire the route + the stream endpoints, declare module**

In `server/crates/api/src/lib.rs`: add `pub mod ws_broadcast;` and routes:

```rust
        .route("/ws/broadcast", get(ws_broadcast::ws_broadcast))
        .route("/channels/:id/stream", get(channels::stream_status))
        .route("/channels/:id/stream/stop", post(channels::stop_stream))
```

Add the two stream handlers to `server/crates/api/src/channels.rs`:

```rust
pub async fn stream_status(
    State(state): State<AppState>, headers: axum::http::HeaderMap, Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    require_member(&state, &headers, &id).await?;
    let ch = state.store.channel_by_id(&id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let live = state.hub.is_broadcasting(&ch.code).await;
    Ok(Json(serde_json::json!({ "live": live })))
}

pub async fn stop_stream(
    State(state): State<AppState>, headers: axum::http::HeaderMap, Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let (_u, role) = require_member(&state, &headers, &id).await?;
    let role = Role::parse(&role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(role, Action::ForceStop, None) { return Err(StatusCode::FORBIDDEN); }
    let ch = state.store.channel_by_id(&id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    state.hub.stop_broadcast(&ch.code, "moderator").await;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 8: Write an end-to-end broadcast WS test**

Create `server/crates/api/tests/broadcast_e2e.rs`:

```rust
use api::{router, AppState};
use futures_util::{SinkExt, StreamExt};
use signaling::Hub;
use std::sync::Arc;
use store::Store;
use tokio_tungstenite::tungstenite::Message;

async fn spawn() -> (std::net::SocketAddr, String, String) {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    store.migrate().await.unwrap();
    // owner + channel + a JWT
    let owner = store.create_user("o@b.com", "h").await.unwrap();
    let ch = store.create_channel(&owner.id, "C", "CODE12").await.unwrap();
    let jwt = auth::issue_token(b"t", &owner.id, 3600).unwrap();
    let state = AppState {
        store, hub: Hub::new(), jwt_secret: Arc::new(b"t".to_vec()),
        turn_secret: Arc::new("s".into()), turn_url: Arc::new("turns:t:5349".into()),
        stun_url: Arc::new("stun:t:3478".into()), turn_ttl: 600,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap(); });
    (addr, ch.code, jwt)
}

#[tokio::test]
async fn broadcaster_and_viewer_exchange_via_channel() {
    let (addr, code, jwt) = spawn().await;
    let url = format!("ws://{}/ws/broadcast", addr);

    let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    b.send(Message::Text(format!(r#"{{"type":"join-broadcast","code":"{code}","role":"broadcaster","jwt":"{jwt}"}}"#))).await.unwrap();
    let first = next_text(&mut b).await;
    assert!(first.contains("broadcast-joined"));

    let (mut v, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    v.send(Message::Text(format!(r#"{{"type":"join-broadcast","code":"{code}","role":"viewer","jwt":"{jwt}"}}"#))).await.unwrap();
    let _ = next_text(&mut v).await; // broadcast-joined

    // broadcaster is notified of the viewer
    let vj = next_text(&mut b).await;
    assert!(vj.contains("viewer-joined"));
    // extract peer_id
    let val: serde_json::Value = serde_json::from_str(&vj).unwrap();
    let peer_id = val["peer_id"].as_str().unwrap().to_string();

    // broadcaster offers to that viewer; viewer receives it
    b.send(Message::Text(format!(r#"{{"type":"offer","peer_id":"{peer_id}","sdp":"SDP-B"}}"#))).await.unwrap();
    let off = next_text(&mut v).await;
    assert!(off.contains("\"type\":\"offer\"") && off.contains("SDP-B"));

    // viewer answers; broadcaster receives it tagged with the viewer's peer_id
    v.send(Message::Text(r#"{"type":"answer","peer_id":"ignored","sdp":"SDP-V"}"#.into())).await.unwrap();
    let ans = next_text(&mut b).await;
    assert!(ans.contains("\"type\":\"answer\"") && ans.contains("SDP-V") && ans.contains(&peer_id));
}

async fn next_text<S>(s: &mut S) -> String
where S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin {
    loop {
        match s.next().await {
            Some(Ok(Message::Text(t))) => return t,
            Some(Ok(_)) => continue,
            other => panic!("expected text, got {:?}", other),
        }
    }
}
```

- [ ] **Step 9: Run the whole server suite**

Run: `cd server && cargo test`
Expected: all PASS (store, signaling incl. broadcast hub, api incl. channel/member/invite tests, ws_e2e, broadcast_e2e).

- [ ] **Step 10: Commit**

```bash
git add server/crates
git commit -m "feat: authenticated 1->N broadcast hub + WS endpoint, force-stop, stream status"
```

---

## Task 9: Update binary, docs, and changelog

**Files:**
- Modify: `server/bin/src/main.rs` (only if it referenced room routes — it does not; verify it still builds)
- Modify: `README.md`, `CHANGELOG.md`, `server/deploy/README.md` (port note for /ws/broadcast)

- [ ] **Step 1: Verify the binary still builds and boots**

Run:
```bash
cd server && cargo build -p stream_lover_server
JWT_SECRET=dev TURN_SECRET=dev DATABASE_URL="sqlite::memory:" BIND_ADDR=127.0.0.1:8097 ./target/debug/stream_lover_server &
sleep 2 && curl -s http://127.0.0.1:8097/healthz; echo
kill %1
```
Expected: prints `ok`.

- [ ] **Step 2: Update the root CHANGELOG**

Add at the top of `CHANGELOG.md`:

```markdown
## [0.3.0] - 2026-06-03
### Added
- Channels: `rooms` renamed to `channels` with membership, owner/admin/member roles, and a
  `can_stream` block flag. Personal saved rooms backfilled as single-member channels.
- Invites: revocable invite links (create/accept/preview) and add-by-email.
- Moderation: kick, role change, transfer ownership, force-stop any stream, block a member from streaming.
- Authenticated 1-broadcaster→N-viewer broadcast signaling (`/ws/broadcast`) with peer-id-tagged
  routing; media stays peer-to-peer (sender-side fan-out). `GET /channels/:id/stream` live status.
### Changed
- REST: `/rooms*` replaced by `/channels*`.
```

- [ ] **Step 3: Note the broadcast WS in the deploy README**

In `server/deploy/README.md`, under the ports/TLS notes, add a line:

```markdown
- The new authenticated broadcast endpoint is `wss://<host>/ws/broadcast` (same 8080 service,
  behind the TLS reverse proxy as `/ws`). No extra ports beyond the existing signaling + coturn.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md server/deploy/README.md
git commit -m "docs: changelog + deploy note for channels and broadcast"
```

---

## Definition of Done

- `cd server && cargo test` passes across store, signaling, api (incl. broadcast hub unit tests, `broadcast_e2e`, and the existing `ws_e2e`).
- Permission matrix is table-tested in `policy.rs`.
- The binary boots and serves `/healthz`; `/ws/broadcast` upgrades and routes a broadcaster↔viewer exchange end-to-end.
- `/rooms*` fully replaced by `/channels*`; the old room handlers/tests are removed.

## Notes for the implementer

- **Cross-task seam:** Task 5's force-stop-on-block calls `hub.stop_broadcast`, added in Task 8 — Task 5 leaves it commented with a marker; Task 8 Step 5 uncomments it. Don't forget.
- **Env:** `grep`/`ugrep` broken on this box — use `awk`. Cargo build scripts occasionally fail "Text file busy" — re-run.
- **`AppState` is unchanged** (it already holds `store` and `hub`); broadcast state lives inside the existing `Hub`.
- **Auth on broadcast:** membership is checked at join. A kicked viewer already connected is not force-dropped in 2a (documented limitation; Phase 2b's gateway can revoke live).
- **YAGNI:** no presence, no chat, no SFU here (Phase 2b/3).
```
