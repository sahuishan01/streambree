use crate::{ice_servers_json, AppState};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct TokenResponse {
    pub token: String,
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

#[derive(Deserialize, Default)]
pub struct NewRoom {
    pub name: Option<String>,
}

/// Optional auth: returns Some(user_id) if a valid bearer token is present, else None.
fn optional_user(state: &AppState, headers: &axum::http::HeaderMap) -> Option<String> {
    let header = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = header.strip_prefix("Bearer ")?;
    auth::verify_token(&state.jwt_secret, token).ok().map(|c| c.sub)
}

/// POST /rooms — authed + name => persistent saved room; otherwise ephemeral code.
pub async fn create_room(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<NewRoom>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let code = auth::generate_room_code();
    match (optional_user(&state, &headers), body.name) {
        (Some(user_id), Some(name)) if !name.is_empty() => {
            let room = state
                .store
                .create_room(&user_id, &name, &code)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(Json(serde_json::json!({
                "id": room.id, "name": room.name, "code": room.code
            })))
        }
        _ => Ok(Json(serde_json::json!({ "code": code }))),
    }
}

pub async fn list_rooms(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<store::Room>>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let rooms = state
        .store
        .rooms_for_user(&user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rooms))
}

pub async fn delete_room(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(room_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    state
        .store
        .delete_room(&user_id, &room_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn resolve_room(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let room = state
        .store
        .room_by_code(&code)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(serde_json::json!({ "name": room.name, "code": room.code })))
}

pub async fn turn_credentials(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(ice_servers_json(&state))
}

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

    async fn token_for(app: &axum::Router, email: &str) -> String {
        let res = app
            .clone()
            .oneshot(
                Request::post("/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"email":"{email}","password":"pw123456"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        v["token"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn create_named_room_then_list_and_resolve() {
        let app = crate::router(test_state().await);
        let token = token_for(&app, "host@b.com").await;

        let res = app
            .clone()
            .oneshot(
                Request::post("/rooms")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(r#"{"name":"Movie Night"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let room: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let code = room["code"].as_str().unwrap().to_string();
        assert_eq!(room["name"], "Movie Night");

        let list = app
            .clone()
            .oneshot(
                Request::get("/rooms")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = list.into_body().collect().await.unwrap().to_bytes();
        let rooms: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(rooms.as_array().unwrap().len(), 1);

        let resolve = app
            .clone()
            .oneshot(Request::get(format!("/rooms/resolve/{code}")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resolve.status(), StatusCode::OK);

        let missing = app
            .oneshot(Request::get("/rooms/resolve/NOPE99").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn guest_create_room_without_auth_returns_ephemeral_code() {
        let app = crate::router(test_state().await);
        let res = app
            .oneshot(
                Request::post("/rooms")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
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
