//! SQLite persistence for users, devices, and channels.

pub mod channels;
pub use channels::{Channel, Member};

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

    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
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
