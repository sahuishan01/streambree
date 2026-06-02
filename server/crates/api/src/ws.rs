//! WebSocket signaling endpoint: bridges a client socket to the Hub.
use crate::{ice_servers_json, AppState};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use signaling::protocol::{ClientMsg, ServerMsg};
use signaling::JoinOutcome;
use tokio::sync::mpsc;
use uuid::Uuid;

pub async fn ws_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let peer_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::channel::<ServerMsg>(32);

    // Wait for the first message: it must be a Join.
    let join = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => match serde_json::from_str::<ClientMsg>(&t) {
                Ok(ClientMsg::Join { room, role: _, mode }) => break (room, mode),
                _ => continue,
            },
            Some(Ok(_)) => continue,
            _ => return, // closed before joining
        }
    };
    let (room_code, mode) = join;

    let outcome = state.hub.join(&room_code, &peer_id, mode, tx).await;
    if let JoinOutcome::Full = outcome {
        let _ = socket
            .send(Message::Text(
                serde_json::to_string(&ServerMsg::Error {
                    code: "room-full".into(),
                    message: "room already has two peers".into(),
                })
                .unwrap(),
            ))
            .await;
        return;
    }
    let peer_present = matches!(outcome, JoinOutcome::Joined { peer_present: true });

    // Acknowledge join with ICE servers (STUN + ephemeral TURN).
    let _ = socket
        .send(Message::Text(
            serde_json::to_string(&ServerMsg::Joined {
                peer_present,
                ice_servers: ice_servers_json(&state),
            })
            .unwrap(),
        ))
        .await;

    // Main loop: forward inbound client msgs to the hub, outbound hub msgs to the socket.
    loop {
        tokio::select! {
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(t))) => {
                        if let Ok(msg) = serde_json::from_str::<ClientMsg>(&t) {
                            let relayed = match msg {
                                ClientMsg::Offer { sdp } => Some(ServerMsg::Offer { sdp }),
                                ClientMsg::Answer { sdp } => Some(ServerMsg::Answer { sdp }),
                                ClientMsg::Ice { candidate } => Some(ServerMsg::Ice { candidate }),
                                ClientMsg::Join { .. } => None, // ignore re-join
                            };
                            if let Some(m) = relayed {
                                state.hub.relay(&room_code, &peer_id, m).await;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            outbound = rx.recv() => {
                match outbound {
                    Some(msg) => {
                        if socket
                            .send(Message::Text(serde_json::to_string(&msg).unwrap()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    state.hub.leave(&room_code, &peer_id).await;
}
