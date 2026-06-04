//! Channel invites: shareable invite links, add-by-email, preview/accept.

use crate::{
    handlers::{require_member, require_user},
    policy::{allowed, Action, Role},
    AppState,
};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Deserialize, Default)]
pub struct NewInvite {
    pub expires_at: Option<String>,
}

#[derive(Deserialize)]
pub struct AddUser {
    pub email: String,
}

fn require_inviter(role: &str) -> Result<(), StatusCode> {
    let r = Role::parse(role).ok_or(StatusCode::FORBIDDEN)?;
    if allowed(r, Action::Invite, None) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

pub async fn create_invite(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NewInvite>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (user_id, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    let expires = body.expires_at;
    let code = auth::generate_room_code();
    let inv = state
        .store
        .create_invite(&id, &user_id, &code, expires)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "code": inv.code })))
}

pub async fn list_invites(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Vec<store::Invite>>, StatusCode> {
    let (_u, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    Ok(Json(
        state
            .store
            .invites_for_channel(&id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    ))
}

pub async fn revoke_invite(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((id, code)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let (_u, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    state
        .store
        .delete_invite(&id, &code)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<AddUser>,
) -> Result<StatusCode, StatusCode> {
    let (_u, role) = require_member(&state, &headers, &id).await?;
    require_inviter(&role)?;
    let user = state
        .store
        .user_by_email(&body.email)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if state
        .store
        .member_role(&id, &user.id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .is_some()
    {
        return Err(StatusCode::CONFLICT);
    }
    state
        .store
        .add_member(&id, &user.id, "member")
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

pub async fn preview_invite(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let inv = state
        .store
        .invite_by_code(&code)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let ch = state
        .store
        .channel_by_id(&inv.channel_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(serde_json::json!({ "channel_id": ch.id, "name": ch.name })))
}

pub async fn accept_invite(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let inv = state
        .store
        .invite_by_code(&code)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if let Some(exp) = &inv.expires_at {
        if let Ok(when) = chrono::DateTime::parse_from_rfc3339(exp) {
            if when < chrono::Utc::now() {
                return Err(StatusCode::GONE);
            }
        }
    }
    if state
        .store
        .member_role(&inv.channel_id, &user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .is_none()
    {
        state
            .store
            .add_member(&inv.channel_id, &user_id, "member")
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(Json(serde_json::json!({ "channel_id": inv.channel_id })))
}

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
            store,
            hub: Hub::new(),
            jwt_secret: Arc::new(b"t".to_vec()),
            turn_secret: Arc::new("s".into()),
            turn_url: Arc::new("turns:t:5349".into()),
            stun_url: Arc::new("stun:t:3478".into()),
            turn_ttl: 600,
        }
    }
    async fn token(app: &axum::Router, email: &str) -> String {
        let res = app
            .clone()
            .oneshot(
                Request::post("/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"email":"{email}","password":"pw123456"}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice::<serde_json::Value>(&b).unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string()
    }
    async fn make_channel(app: &axum::Router, t: &str) -> String {
        let res = app
            .clone()
            .oneshot(
                Request::post("/channels")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {t}"))
                    .body(Body::from(r#"{"name":"C"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn invite_link_create_and_accept_adds_member() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let guest = token(&app, "g@b.com").await;
        let id = make_channel(&app, &owner).await;
        let inv = app
            .clone()
            .oneshot(
                Request::post(format!("/channels/{id}/invites"))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {owner}"))
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(inv.status(), StatusCode::OK);
        let b = inv.into_body().collect().await.unwrap().to_bytes();
        let code = serde_json::from_slice::<serde_json::Value>(&b).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string();
        let accept = app
            .clone()
            .oneshot(
                Request::post(format!("/invites/{code}/accept"))
                    .header("authorization", format!("Bearer {guest}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(accept.status(), StatusCode::OK);
        let list = app
            .oneshot(
                Request::get("/channels")
                    .header("authorization", format!("Bearer {guest}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let b = list.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&b)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn add_by_email_requires_registered_user() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let _guest = token(&app, "g@b.com").await;
        let id = make_channel(&app, &owner).await;
        let ok = app
            .clone()
            .oneshot(
                Request::post(format!("/channels/{id}/add-user"))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {owner}"))
                    .body(Body::from(r#"{"email":"g@b.com"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let missing = app
            .oneshot(
                Request::post(format!("/channels/{id}/add-user"))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {owner}"))
                    .body(Body::from(r#"{"email":"nobody@b.com"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }
}
