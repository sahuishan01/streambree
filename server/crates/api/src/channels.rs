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
}
