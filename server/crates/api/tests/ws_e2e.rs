use api::{router, AppState};
use futures_util::{SinkExt, StreamExt};
use signaling::Hub;
use std::sync::Arc;
use store::Store;
use tokio_tungstenite::tungstenite::Message;

async fn spawn_server() -> std::net::SocketAddr {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    store.migrate().await.unwrap();
    let state = AppState {
        store,
        hub: Hub::new(),
        jwt_secret: Arc::new(b"test".to_vec()),
        turn_secret: Arc::new("s".to_string()),
        turn_url: Arc::new("turns:t:5349".to_string()),
        stun_url: Arc::new("stun:t:3478".to_string()),
        turn_ttl: 600,
        signups_allowed: true,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router(state)).await.unwrap();
    });
    addr
}

#[tokio::test]
async fn two_peers_complete_an_offer_answer_exchange() {
    let addr = spawn_server().await;
    let url = format!("ws://{}/ws", addr);

    let (mut a, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut b, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // A joins first.
    a.send(Message::Text(
        r#"{"type":"join","room":"R1","role":"sender","mode":"realtime"}"#.into(),
    ))
    .await
    .unwrap();
    // A's first server message is "joined" with peer_present=false.
    let a_joined = next_text(&mut a).await;
    assert!(a_joined.contains("\"type\":\"joined\""));
    assert!(a_joined.contains("\"peer_present\":false"));

    // B joins second.
    b.send(Message::Text(
        r#"{"type":"join","room":"R1","role":"receiver","mode":"realtime"}"#.into(),
    ))
    .await
    .unwrap();
    let b_joined = next_text(&mut b).await;
    assert!(b_joined.contains("\"peer_present\":true"));

    // A receives "peer-joined".
    let a_peer = next_text(&mut a).await;
    assert!(a_peer.contains("peer-joined"));

    // A sends an offer; B must receive it.
    a.send(Message::Text(r#"{"type":"offer","sdp":"SDP-A"}"#.into()))
        .await
        .unwrap();
    let b_offer = next_text(&mut b).await;
    assert!(b_offer.contains("\"type\":\"offer\""));
    assert!(b_offer.contains("SDP-A"));

    // B answers; A must receive it.
    b.send(Message::Text(r#"{"type":"answer","sdp":"SDP-B"}"#.into()))
        .await
        .unwrap();
    let a_answer = next_text(&mut a).await;
    assert!(a_answer.contains("\"type\":\"answer\""));
    assert!(a_answer.contains("SDP-B"));
}

async fn next_text<S>(stream: &mut S) -> String
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        match stream.next().await {
            Some(Ok(Message::Text(t))) => return t,
            Some(Ok(_)) => continue,
            other => panic!("expected text frame, got {:?}", other),
        }
    }
}
