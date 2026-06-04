use crate::broadcast::{BroadcastRoom, SetBroadcaster};
use crate::protocol::{BroadcastServerMsg, Mode, ServerMsg};
use crate::room::{JoinOutcome, Room};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

/// A live room: the pure state machine plus a channel to each peer.
struct LiveRoom {
    room: Room,
    senders: HashMap<String, mpsc::Sender<ServerMsg>>,
}

/// A live broadcast: the pure room state plus channels to broadcaster + viewers.
struct LiveBroadcast {
    room: BroadcastRoom,
    broadcaster_tx: Option<mpsc::Sender<BroadcastServerMsg>>,
    viewer_tx: HashMap<String, mpsc::Sender<BroadcastServerMsg>>,
}

/// Owns all live rooms and routes relayed messages between peers.
#[derive(Clone)]
pub struct Hub {
    rooms: Arc<Mutex<HashMap<String, LiveRoom>>>,
    broadcasts: Arc<Mutex<HashMap<String, LiveBroadcast>>>,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            broadcasts: Arc::new(Mutex::new(HashMap::new())),
        }
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

    pub async fn join_broadcaster(&self, code: &str, id: &str, tx: mpsc::Sender<BroadcastServerMsg>) -> bool {
        let mut bcs = self.broadcasts.lock().await;
        let lb = bcs.entry(code.to_string()).or_insert_with(|| LiveBroadcast {
            room: BroadcastRoom::new(), broadcaster_tx: None, viewer_tx: HashMap::new(),
        });
        match lb.room.set_broadcaster(id) {
            SetBroadcaster::Ok => {
                lb.broadcaster_tx = Some(tx);
                // Announce any viewers who were already waiting before we went live,
                // so the broadcaster offers to them too.
                for peer_id in lb.room.viewers() {
                    if let Some(btx) = &lb.broadcaster_tx {
                        let _ = btx.send(BroadcastServerMsg::ViewerJoined { peer_id }).await;
                    }
                }
                true
            }
            SetBroadcaster::AlreadyLive => false,
        }
    }

    pub async fn join_viewer(&self, code: &str, peer_id: &str, tx: mpsc::Sender<BroadcastServerMsg>) {
        let mut bcs = self.broadcasts.lock().await;
        let lb = bcs.entry(code.to_string()).or_insert_with(|| LiveBroadcast {
            room: BroadcastRoom::new(), broadcaster_tx: None, viewer_tx: HashMap::new(),
        });
        lb.room.add_viewer(peer_id);
        lb.viewer_tx.insert(peer_id.to_string(), tx);
        if let Some(btx) = &lb.broadcaster_tx {
            let _ = btx.send(BroadcastServerMsg::ViewerJoined { peer_id: peer_id.to_string() }).await;
        }
    }

    pub async fn broadcast_to_viewer(&self, code: &str, peer_id: &str, msg: BroadcastServerMsg) {
        let bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get(code) {
            if let Some(vtx) = lb.viewer_tx.get(peer_id) { let _ = vtx.send(msg).await; }
        }
    }

    pub async fn broadcast_to_broadcaster(&self, code: &str, msg: BroadcastServerMsg) {
        let bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get(code) {
            if let Some(btx) = &lb.broadcaster_tx { let _ = btx.send(msg).await; }
        }
    }

    pub async fn viewer_left(&self, code: &str, peer_id: &str) {
        let mut bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get_mut(code) {
            lb.room.remove_viewer(peer_id);
            lb.viewer_tx.remove(peer_id);
            if let Some(btx) = &lb.broadcaster_tx {
                let _ = btx.send(BroadcastServerMsg::ViewerLeft { peer_id: peer_id.to_string() }).await;
            }
        }
    }

    pub async fn broadcaster_left(&self, code: &str) {
        let mut bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get_mut(code) {
            for vtx in lb.viewer_tx.values() {
                let _ = vtx.send(BroadcastServerMsg::BroadcasterLeft).await;
            }
            lb.room.clear_broadcaster();
            lb.broadcaster_tx = None;
            if lb.room.is_empty() { bcs.remove(code); }
        }
    }

    pub async fn stop_broadcast(&self, code: &str, by: &str) {
        let mut bcs = self.broadcasts.lock().await;
        if let Some(lb) = bcs.get(code) {
            if let Some(btx) = &lb.broadcaster_tx {
                let _ = btx.send(BroadcastServerMsg::ForceStopped { by: by.to_string() }).await;
            }
            for vtx in lb.viewer_tx.values() {
                let _ = vtx.send(BroadcastServerMsg::BroadcasterLeft).await;
            }
        }
        bcs.remove(code);
    }

    pub async fn is_broadcasting(&self, code: &str) -> bool {
        self.broadcasts.lock().await.get(code).map(|lb| lb.room.is_live()).unwrap_or(false)
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
    async fn broadcast_routes_viewer_to_broadcaster_and_back() {
        use crate::protocol::BroadcastServerMsg;
        let hub = Hub::new();
        let (btx, mut brx) = mpsc::channel(8);
        assert!(hub.join_broadcaster("chanA", "b1", btx).await);
        let (btx2, _r) = mpsc::channel(8);
        assert!(!hub.join_broadcaster("chanA", "b2", btx2).await);

        let (vtx, mut vrx) = mpsc::channel(8);
        hub.join_viewer("chanA", "v1", vtx).await;
        let got = brx.recv().await.unwrap();
        assert!(matches!(got, BroadcastServerMsg::ViewerJoined { peer_id } if peer_id == "v1"));

        hub.broadcast_to_viewer("chanA", "v1", BroadcastServerMsg::Offer { peer_id: "v1".into(), sdp: "S".into() }).await;
        let got = vrx.recv().await.unwrap();
        assert!(matches!(got, BroadcastServerMsg::Offer { sdp, .. } if sdp == "S"));

        hub.broadcast_to_broadcaster("chanA", BroadcastServerMsg::Answer { peer_id: "v1".into(), sdp: "A".into() }).await;
        let got = brx.recv().await.unwrap();
        assert!(matches!(got, BroadcastServerMsg::Answer { sdp, .. } if sdp == "A"));

        hub.stop_broadcast("chanA", "owner").await;
        let b = brx.recv().await.unwrap();
        assert!(matches!(b, BroadcastServerMsg::ForceStopped { .. }));
        let v = vrx.recv().await.unwrap();
        assert!(matches!(v, BroadcastServerMsg::BroadcasterLeft));
    }

    #[tokio::test]
    async fn stream_state_reports_live() {
        let hub = Hub::new();
        assert!(!hub.is_broadcasting("chanB").await);
        let (btx, _r) = mpsc::channel(8);
        hub.join_broadcaster("chanB", "b1", btx).await;
        assert!(hub.is_broadcasting("chanB").await);
    }

    #[tokio::test]
    async fn broadcaster_is_told_about_viewers_who_waited() {
        use crate::protocol::BroadcastServerMsg;
        let hub = Hub::new();
        // viewer arrives before anyone is live
        let (vtx, _vrx) = mpsc::channel(8);
        hub.join_viewer("chanC", "v1", vtx).await;
        // broadcaster goes live and must be told about the waiting viewer
        let (btx, mut brx) = mpsc::channel(8);
        assert!(hub.join_broadcaster("chanC", "b1", btx).await);
        let got = brx.recv().await.unwrap();
        assert!(matches!(got, BroadcastServerMsg::ViewerJoined { peer_id } if peer_id == "v1"));
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
