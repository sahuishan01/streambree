use api::{router, AppState};
use futures_util::{SinkExt, StreamExt};
use signaling::Hub;
use std::sync::Arc;
use store::Store;
use tokio_tungstenite::tungstenite::Message;

async fn spawn() -> (std::net::SocketAddr, String, String) {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    store.migrate().await.unwrap();
    let owner = store.create_user("o@b.com", "h", false).await.unwrap();
    let ch = store.create_channel(&owner.id, "C", "CODE12").await.unwrap();
    let jwt = auth::issue_token(b"t", &owner.id, 3600).unwrap();
    let state = AppState {
        store, hub: Hub::new(), jwt_secret: Arc::new(b"t".to_vec()),
        turn_secret: Arc::new("s".into()), turn_url: Arc::new("turns:t:5349".into()),
        stun_url: Arc::new("stun:t:3478".into()), turn_ttl: 600,
        signups_allowed: true,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap(); });
    (addr, ch.code, jwt)
}

#[tokio::test]
async fn broadcaster_and_viewer_exchange_via_channel() {
    let (addr, code, jwt) = spawn().await;
    let url = format!("ws://{}/ws/broadcast", addr);

    let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    b.send(Message::Text(format!(r#"{{"type":"join-broadcast","code":"{code}","role":"broadcaster","jwt":"{jwt}"}}"#))).await.unwrap();
    let first = next_text(&mut b).await;
    assert!(first.contains("broadcast-joined"));

    let (mut v, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    v.send(Message::Text(format!(r#"{{"type":"join-broadcast","code":"{code}","role":"viewer","jwt":"{jwt}"}}"#))).await.unwrap();
    let _ = next_text(&mut v).await;

    let vj = next_text(&mut b).await;
    assert!(vj.contains("viewer-joined"));
    let val: serde_json::Value = serde_json::from_str(&vj).unwrap();
    let peer_id = val["peer_id"].as_str().unwrap().to_string();

    b.send(Message::Text(format!(r#"{{"type":"offer","peer_id":"{peer_id}","sdp":"SDP-B"}}"#))).await.unwrap();
    let off = next_text(&mut v).await;
    assert!(off.contains("\"type\":\"offer\"") && off.contains("SDP-B"));

    v.send(Message::Text(r#"{"type":"answer","peer_id":"ignored","sdp":"SDP-V"}"#.into())).await.unwrap();
    let ans = next_text(&mut b).await;
    assert!(ans.contains("\"type\":\"answer\"") && ans.contains("SDP-V") && ans.contains(&peer_id));
}

async fn next_text<S>(s: &mut S) -> String
where S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin {
    loop {
        match s.next().await {
            Some(Ok(Message::Text(t))) => return t,
            Some(Ok(_)) => continue,
            other => panic!("expected text, got {:?}", other),
        }
    }
}
