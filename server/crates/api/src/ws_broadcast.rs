//! Authenticated broadcast signaling: 1 broadcaster + N viewers per channel.
use crate::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use signaling::protocol::{BroadcastClientMsg, BroadcastRole, BroadcastServerMsg};
use tokio::sync::mpsc;
use uuid::Uuid;

pub async fn ws_broadcast(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle(socket, state))
}

fn err(code: &str, message: &str) -> String {
    serde_json::to_string(&BroadcastServerMsg::Error { code: code.into(), message: message.into() }).unwrap()
}

async fn handle(mut socket: WebSocket, state: AppState) {
    let join = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => match serde_json::from_str::<BroadcastClientMsg>(&t) {
                Ok(BroadcastClientMsg::JoinBroadcast { code, role, jwt }) => break (code, role, jwt),
                _ => continue,
            },
            Some(Ok(_)) => continue,
            _ => return,
        }
    };
    let (code, role, jwt) = join;

    let user_id = match auth::verify_token(&state.jwt_secret, &jwt) {
        Ok(c) => c.sub,
        Err(_) => { let _ = socket.send(Message::Text(err("not-a-member", "invalid token"))).await; return; }
    };
    let channel = match state.store.channel_by_code(&code).await {
        Ok(Some(c)) => c,
        _ => { let _ = socket.send(Message::Text(err("not-a-member", "no such channel"))).await; return; }
    };
    let role_in_channel = state.store.member_role(&channel.id, &user_id).await.ok().flatten();
    if role_in_channel.is_none() {
        let _ = socket.send(Message::Text(err("not-a-member", "join the channel first"))).await; return;
    }

    let (tx, mut rx) = mpsc::channel::<BroadcastServerMsg>(64);

    match role {
        BroadcastRole::Broadcaster => {
            if !state.store.can_stream(&channel.id, &user_id).await.unwrap_or(false) {
                let _ = socket.send(Message::Text(err("streaming-blocked", "you cannot stream here"))).await; return;
            }
            if !state.hub.join_broadcaster(&channel.code, &user_id, tx).await {
                let _ = socket.send(Message::Text(err("already-live", "someone is already streaming"))).await; return;
            }
            let _ = socket.send(Message::Text(serde_json::to_string(
                &BroadcastServerMsg::BroadcastJoined { live: true, viewers: vec![] }).unwrap())).await;
            run_broadcaster(&mut socket, &mut rx, &state, &channel.code).await;
            state.hub.broadcaster_left(&channel.code).await;
        }
        BroadcastRole::Viewer => {
            let peer_id = Uuid::new_v4().to_string();
            let live = state.hub.is_broadcasting(&channel.code).await;
            state.hub.join_viewer(&channel.code, &peer_id, tx).await;
            let _ = socket.send(Message::Text(serde_json::to_string(
                &BroadcastServerMsg::BroadcastJoined { live, viewers: vec![] }).unwrap())).await;
            run_viewer(&mut socket, &mut rx, &state, &channel.code, &peer_id).await;
            state.hub.viewer_left(&channel.code, &peer_id).await;
        }
    }
}

async fn run_broadcaster(socket: &mut WebSocket, rx: &mut mpsc::Receiver<BroadcastServerMsg>, state: &AppState, code: &str) {
    loop {
        tokio::select! {
            inbound = socket.recv() => match inbound {
                Some(Ok(Message::Text(t))) => {
                    if let Ok(msg) = serde_json::from_str::<BroadcastClientMsg>(&t) {
                        match msg {
                            BroadcastClientMsg::Offer { peer_id, sdp } =>
                                state.hub.broadcast_to_viewer(code, &peer_id, BroadcastServerMsg::Offer { peer_id: peer_id.clone(), sdp }).await,
                            BroadcastClientMsg::Ice { peer_id, candidate } =>
                                state.hub.broadcast_to_viewer(code, &peer_id, BroadcastServerMsg::Ice { peer_id: peer_id.clone(), candidate }).await,
                            _ => {}
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
            out = rx.recv() => match out {
                Some(msg) => { if socket.send(Message::Text(serde_json::to_string(&msg).unwrap())).await.is_err() { break; } }
                None => break,
            }
        }
    }
}

async fn run_viewer(socket: &mut WebSocket, rx: &mut mpsc::Receiver<BroadcastServerMsg>, state: &AppState, code: &str, peer_id: &str) {
    loop {
        tokio::select! {
            inbound = socket.recv() => match inbound {
                Some(Ok(Message::Text(t))) => {
                    if let Ok(msg) = serde_json::from_str::<BroadcastClientMsg>(&t) {
                        match msg {
                            BroadcastClientMsg::Answer { sdp, .. } =>
                                state.hub.broadcast_to_broadcaster(code, BroadcastServerMsg::Answer { peer_id: peer_id.to_string(), sdp }).await,
                            BroadcastClientMsg::Ice { candidate, .. } =>
                                state.hub.broadcast_to_broadcaster(code, BroadcastServerMsg::Ice { peer_id: peer_id.to_string(), candidate }).await,
                            _ => {}
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
            out = rx.recv() => match out {
                Some(msg) => { if socket.send(Message::Text(serde_json::to_string(&msg).unwrap())).await.is_err() { break; } }
                None => break,
            }
        }
    }
}
