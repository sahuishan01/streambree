//! HTTP API: auth, devices, channels, TURN credentials.

pub mod channels;
pub mod handlers;
pub mod invites;
pub mod policy;
pub mod ws;
pub mod ws_broadcast;

use axum::routing::{get, patch, post};
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
        .route("/channels", post(channels::create_channel).get(channels::list_channels))
        .route("/channels/:id", get(channels::get_channel)
            .patch(channels::rename_channel)
            .delete(channels::delete_channel))
        .route("/channels/:id/members", get(channels::list_members))
        .route("/channels/:id/members/:uid",
            axum::routing::delete(channels::remove_member).patch(channels::change_role))
        .route("/channels/:id/members/:uid/streaming", patch(channels::set_streaming))
        .route("/channels/:id/transfer", post(channels::transfer_owner))
        .route("/channels/:id/invites", post(invites::create_invite).get(invites::list_invites))
        .route("/channels/:id/invites/:code", axum::routing::delete(invites::revoke_invite))
        .route("/channels/:id/add-user", post(invites::add_user))
        .route("/invites/:code", get(invites::preview_invite))
        .route("/invites/:code/accept", post(invites::accept_invite))
        .route("/ws", get(ws::ws_handler))
        .route("/ws/broadcast", get(ws_broadcast::ws_broadcast))
        .route("/channels/:id/stream", get(channels::stream_status))
        .route("/channels/:id/stream/stop", post(channels::stop_stream))
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
