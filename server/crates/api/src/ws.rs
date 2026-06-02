//! WebSocket signaling endpoint. Full implementation in Task 8.
use crate::AppState;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::State;
use axum::response::Response;

pub async fn ws_handler(State(_state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(|_socket| async {})
}
