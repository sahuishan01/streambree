use crate::{ice_servers_json, AppState};
use axum::extract::State;
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
