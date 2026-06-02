use crate::protocol::Mode;

/// Result of attempting to join a room.
#[derive(Debug, PartialEq, Eq)]
pub enum JoinOutcome {
    Joined { peer_present: bool },
    Full,
}

/// A 2-peer signaling room. Pure state — peers are identified by opaque ids.
pub struct Room {
    pub mode: Mode,
    peers: Vec<String>,
}

impl Room {
    pub fn new(mode: Mode) -> Self {
        Self { mode, peers: Vec::with_capacity(2) }
    }

    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    pub fn join(&mut self, peer_id: &str) -> JoinOutcome {
        if self.peers.len() >= 2 {
            return JoinOutcome::Full;
        }
        let peer_present = !self.peers.is_empty();
        self.peers.push(peer_id.to_string());
        JoinOutcome::Joined { peer_present }
    }

    /// The other peer in the room, if present.
    pub fn other(&self, peer_id: &str) -> Option<String> {
        self.peers.iter().find(|p| p.as_str() != peer_id).cloned()
    }

    pub fn leave(&mut self, peer_id: &str) {
        self.peers.retain(|p| p != peer_id);
    }

    pub fn is_empty(&self) -> bool {
        self.peers.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_peer_joins_alone() {
        let mut room = Room::new(Mode::Realtime);
        let res = room.join("peer-a");
        assert_eq!(res, JoinOutcome::Joined { peer_present: false });
        assert_eq!(room.peer_count(), 1);
    }

    #[test]
    fn second_peer_sees_existing_peer() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        let res = room.join("peer-b");
        assert_eq!(res, JoinOutcome::Joined { peer_present: true });
        assert_eq!(room.peer_count(), 2);
    }

    #[test]
    fn third_peer_is_rejected_as_full() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        room.join("peer-b");
        assert_eq!(room.join("peer-c"), JoinOutcome::Full);
        assert_eq!(room.peer_count(), 2);
    }

    #[test]
    fn other_returns_the_opposite_peer() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        room.join("peer-b");
        assert_eq!(room.other("peer-a"), Some("peer-b".to_string()));
        assert_eq!(room.other("peer-b"), Some("peer-a".to_string()));
    }

    #[test]
    fn leaving_frees_a_slot() {
        let mut room = Room::new(Mode::Realtime);
        room.join("peer-a");
        room.join("peer-b");
        room.leave("peer-a");
        assert_eq!(room.peer_count(), 1);
        assert_eq!(room.other("peer-b"), None);
    }
}
