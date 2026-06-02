use crate::protocol::{Mode, ServerMsg};
use crate::room::{JoinOutcome, Room};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

/// A live room: the pure state machine plus a channel to each peer.
struct LiveRoom {
    room: Room,
    senders: HashMap<String, mpsc::Sender<ServerMsg>>,
}

/// Owns all live rooms and routes relayed messages between peers.
#[derive(Clone)]
pub struct Hub {
    rooms: Arc<Mutex<HashMap<String, LiveRoom>>>,
}

impl Hub {
    pub fn new() -> Self {
        Self { rooms: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Join `peer_id` to `room_code`, registering its outbound channel.
    pub async fn join(
        &self,
        room_code: &str,
        peer_id: &str,
        mode: Mode,
        tx: mpsc::Sender<ServerMsg>,
    ) -> JoinOutcome {
        let mut rooms = self.rooms.lock().await;
        let live = rooms
            .entry(room_code.to_string())
            .or_insert_with(|| LiveRoom { room: Room::new(mode), senders: HashMap::new() });

        let outcome = live.room.join(peer_id);
        if let JoinOutcome::Joined { peer_present } = outcome {
            live.senders.insert(peer_id.to_string(), tx);
            // Tell the already-present peer that someone arrived.
            if peer_present {
                if let Some(other_id) = live.room.other(peer_id) {
                    if let Some(other_tx) = live.senders.get(&other_id) {
                        let _ = other_tx.send(ServerMsg::PeerJoined).await;
                    }
                }
            }
        }
        outcome
    }

    /// Forward `msg` from `from_peer` to the other peer in the room.
    pub async fn relay(&self, room_code: &str, from_peer: &str, msg: ServerMsg) {
        let rooms = self.rooms.lock().await;
        if let Some(live) = rooms.get(room_code) {
            if let Some(other_id) = live.room.other(from_peer) {
                if let Some(other_tx) = live.senders.get(&other_id) {
                    let _ = other_tx.send(msg).await;
                }
            }
        }
    }

    /// Remove a peer; notify the remaining peer and drop empty rooms.
    pub async fn leave(&self, room_code: &str, peer_id: &str) {
        let mut rooms = self.rooms.lock().await;
        if let Some(live) = rooms.get_mut(room_code) {
            if let Some(other_id) = live.room.other(peer_id) {
                if let Some(other_tx) = live.senders.get(&other_id) {
                    let _ = other_tx.send(ServerMsg::PeerLeft).await;
                }
            }
            live.room.leave(peer_id);
            live.senders.remove(peer_id);
            if live.room.is_empty() {
                rooms.remove(room_code);
            }
        }
    }

    pub async fn room_count(&self) -> usize {
        self.rooms.lock().await.len()
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn relays_a_message_to_the_other_peer() {
        let hub = Hub::new();
        let (tx_a, _rx_a) = mpsc::channel(8);
        let (tx_b, mut rx_b) = mpsc::channel(8);

        // A joins alone, then B joins; B should be told a peer is present.
        let out_a = hub.join("room1", "a", Mode::Realtime, tx_a).await;
        assert_eq!(out_a, JoinOutcome::Joined { peer_present: false });
        let out_b = hub.join("room1", "b", Mode::Realtime, tx_b).await;
        assert_eq!(out_b, JoinOutcome::Joined { peer_present: true });

        // A sends an offer; it must arrive at B.
        hub.relay("room1", "a", ServerMsg::Offer { sdp: "SDP".into() }).await;
        let got = rx_b.recv().await.unwrap();
        assert!(matches!(got, ServerMsg::Offer { sdp } if sdp == "SDP"));
    }

    #[tokio::test]
    async fn leaving_notifies_the_remaining_peer() {
        let hub = Hub::new();
        let (tx_a, mut rx_a) = mpsc::channel(8);
        let (tx_b, _rx_b) = mpsc::channel(8);
        hub.join("room2", "a", Mode::Realtime, tx_a).await;
        hub.join("room2", "b", Mode::Realtime, tx_b).await;

        // A is first notified that B joined.
        let joined = rx_a.recv().await.unwrap();
        assert!(matches!(joined, ServerMsg::PeerJoined));

        hub.leave("room2", "b").await;
        let got = rx_a.recv().await.unwrap();
        assert!(matches!(got, ServerMsg::PeerLeft));
    }

    #[tokio::test]
    async fn empty_room_is_removed() {
        let hub = Hub::new();
        let (tx_a, _rx_a) = mpsc::channel(8);
        hub.join("room3", "a", Mode::Realtime, tx_a).await;
        hub.leave("room3", "a").await;
        assert_eq!(hub.room_count().await, 0);
    }
}
