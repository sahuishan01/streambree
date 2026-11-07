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

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Invite {
    pub id: String,
    pub channel_id: String,
    pub code: String,
    pub created_by: String,
    pub expires_at: Option<String>,
    pub created_at: String,
}

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
        let user = store.create_user("a@b.com", "h", false).await.unwrap();
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
        let owner = store.create_user("o@b.com", "h", false).await.unwrap();
        let guest = store.create_user("g@b.com", "h", false).await.unwrap();
        let ch = store.create_channel(&owner.id, "Room", "CODE12").await.unwrap();
        store.add_member(&ch.id, &guest.id, "member").await.unwrap();
        let roster = store.members(&ch.id).await.unwrap();
        assert_eq!(roster.len(), 2);
        assert!(roster.iter().any(|m| m.user_id == guest.id && m.role == "member"));
    }

    #[tokio::test]
    async fn set_role_streaming_and_remove_member() {
        let store = fresh().await;
        let owner = store.create_user("o@b.com", "h", false).await.unwrap();
        let guest = store.create_user("g@b.com", "h", false).await.unwrap();
        let ch = store.create_channel(&owner.id, "Room", "CODE12").await.unwrap();
        store.add_member(&ch.id, &guest.id, "member").await.unwrap();
        store.set_member_role(&ch.id, &guest.id, "admin").await.unwrap();
        assert_eq!(store.member_role(&ch.id, &guest.id).await.unwrap().as_deref(), Some("admin"));
        store.set_member_streaming(&ch.id, &guest.id, false).await.unwrap();
        assert!(!store.can_stream(&ch.id, &guest.id).await.unwrap());
        store.remove_member(&ch.id, &guest.id).await.unwrap();
        assert!(store.member_role(&ch.id, &guest.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn create_lookup_and_revoke_invite() {
        let store = fresh().await;
        let owner = store.create_user("o@b.com", "h", false).await.unwrap();
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
        let target = store.create_user("t@b.com", "h", false).await.unwrap();
        let found = store.user_by_email("t@b.com").await.unwrap().unwrap();
        assert_eq!(found.id, target.id);
    }
}
