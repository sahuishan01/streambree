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
