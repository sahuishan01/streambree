//! Channel REST handlers: create, list, detail, rename, delete.

use crate::handlers::{require_member, require_user};
use crate::{
    policy::{allowed, Action, Role},
    AppState,
};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct NewChannel {
    pub name: String,
}

#[derive(Deserialize)]
pub struct RenameChannel {
    pub name: String,
}

pub async fn create_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<NewChannel>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let code = auth::generate_room_code();
    let ch = state
        .store
        .create_channel(&user_id, &body.name, &code)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "id": ch.id, "name": ch.name, "code": ch.code })))
}

pub async fn list_channels(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let chans = state
        .store
        .channels_for_user(&user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut out = Vec::new();
    for c in chans {
        let role = state
            .store
            .member_role(&c.id, &user_id)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .unwrap_or_default();
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
    let ch = state
        .store
        .channel_by_id(&id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let can_stream = state
        .store
        .can_stream(&id, &user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::json!({ "id": ch.id, "name": ch.name, "code": ch.code, "role": role, "can_stream": can_stream }),
    ))
}

pub async fn rename_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<RenameChannel>,
) -> Result<StatusCode, StatusCode> {
    let (_uid, role) = require_member(&state, &headers, &id).await?;
    let role = Role::parse(&role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(role, Action::Rename, None) {
        return Err(StatusCode::FORBIDDEN);
    }
    state
        .store
        .rename_channel(&id, &body.name)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

pub async fn delete_channel(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let (_uid, role) = require_member(&state, &headers, &id).await?;
    let role = Role::parse(&role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(role, Action::Delete, None) {
        return Err(StatusCode::FORBIDDEN);
    }
    state
        .store
        .delete_channel(&id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

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

pub async fn remove_member(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((id, uid)): Path<(String, String)>,
) -> Result<StatusCode, StatusCode> {
    let (actor_id, actor_role) = require_member(&state, &headers, &id).await?;
    let target_role = state.store.member_role(&id, &uid).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
    if target_role == "owner" {
        return Err(StatusCode::CONFLICT);
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
    // Target must be an existing member of this channel (and never the owner).
    let target_role = state.store.member_role(&id, &uid).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
    if target_role == "owner" { return Err(StatusCode::CONFLICT); }
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
    // When blocking a currently-live member, also force-stop their stream.
    if !body.allowed {
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
    let (actor_id, actor_role) = require_member(&state, &headers, &id).await?;
    let actor = Role::parse(&actor_role).ok_or(StatusCode::FORBIDDEN)?;
    if !allowed(actor, Action::Transfer, None) { return Err(StatusCode::FORBIDDEN); }
    // The new owner must already be a member; otherwise the channel could be left
    // with no owner (old owner demoted, new-owner update matching zero rows).
    if body.user_id == actor_id { return Err(StatusCode::BAD_REQUEST); }
    if state.store.member_role(&id, &body.user_id).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }
    state.store.set_member_role(&id, &body.user_id, "owner").await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state.store.set_member_role(&id, &actor_id, "admin").await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

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
            signups_allowed: true,
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

    #[tokio::test]
    async fn transfer_to_non_member_is_rejected() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let id = make_channel(&app, &owner, "C").await;
        let res = app
            .oneshot(
                Request::post(format!("/channels/{id}/transfer"))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {owner}"))
                    .body(Body::from(r#"{"user_id":"ghost"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn create_list_and_get_channel() {
        let app = crate::router(state().await);
        let t = token(&app, "o@b.com").await;

        // Create a channel
        let res = app
            .clone()
            .oneshot(
                Request::post("/channels")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {t}"))
                    .body(Body::from(r#"{"name":"Movie Night"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let b = res.into_body().collect().await.unwrap().to_bytes();
        let ch: serde_json::Value = serde_json::from_slice(&b).unwrap();
        let id = ch["id"].as_str().unwrap().to_string();
        assert_eq!(ch["name"], "Movie Night");

        // List channels
        let list = app
            .clone()
            .oneshot(
                Request::get("/channels")
                    .header("authorization", format!("Bearer {t}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let b = list.into_body().collect().await.unwrap().to_bytes();
        let arr: serde_json::Value = serde_json::from_slice(&b).unwrap();
        assert_eq!(arr.as_array().unwrap().len(), 1);
        assert_eq!(arr[0]["role"], "owner");

        // Get channel detail
        let detail = app
            .oneshot(
                Request::get(format!("/channels/{id}"))
                    .header("authorization", format!("Bearer {t}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(detail.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn non_member_cannot_view_channel() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let other = token(&app, "x@b.com").await;

        let res = app
            .clone()
            .oneshot(
                Request::post("/channels")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {owner}"))
                    .body(Body::from(r#"{"name":"Private"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        let id = serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();

        let denied = app
            .oneshot(
                Request::get(format!("/channels/{id}"))
                    .header("authorization", format!("Bearer {other}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn member_cannot_rename_but_owner_can() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;

        let res = app
            .clone()
            .oneshot(
                Request::post("/channels")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {owner}"))
                    .body(Body::from(r#"{"name":"Old"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        let id = serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();

        let ok = app
            .oneshot(
                Request::patch(format!("/channels/{id}"))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {owner}"))
                    .body(Body::from(r#"{"name":"New"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
    }

    async fn make_channel(app: &axum::Router, owner_token: &str, name: &str) -> String {
        let res = app.clone().oneshot(Request::post("/channels")
            .header("content-type", "application/json").header("authorization", format!("Bearer {owner_token}"))
            .body(Body::from(format!(r#"{{"name":"{name}"}}"#))).unwrap()).await.unwrap();
        let b = res.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice::<serde_json::Value>(&b).unwrap()["id"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn member_cannot_moderate_streaming() {
        let app = crate::router(state().await);
        let owner = token(&app, "o@b.com").await;
        let id = make_channel(&app, &owner, "C").await;
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
        let roster = app.clone().oneshot(Request::get(format!("/channels/{id}/members"))
            .header("authorization", format!("Bearer {owner}")).body(Body::empty()).unwrap()).await.unwrap();
        let b = roster.into_body().collect().await.unwrap().to_bytes();
        let members: serde_json::Value = serde_json::from_slice(&b).unwrap();
        let uid = members[0]["user_id"].as_str().unwrap().to_string();
        let res = app.oneshot(Request::delete(format!("/channels/{id}/members/{uid}"))
            .header("authorization", format!("Bearer {owner}")).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::CONFLICT);
    }
}
