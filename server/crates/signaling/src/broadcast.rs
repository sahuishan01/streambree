//! Pure broadcast-room state: one broadcaster + many viewers, by peer id.

#[derive(Debug, PartialEq, Eq)]
pub enum SetBroadcaster {
    Ok,
    AlreadyLive,
}

/// Pure state for one channel's broadcast: at most one broadcaster, N viewers.
#[derive(Default)]
pub struct BroadcastRoom {
    broadcaster: Option<String>,
    viewers: Vec<String>,
}

impl BroadcastRoom {
    pub fn new() -> Self { Self::default() }

    pub fn set_broadcaster(&mut self, id: &str) -> SetBroadcaster {
        if self.broadcaster.is_some() { return SetBroadcaster::AlreadyLive; }
        self.broadcaster = Some(id.to_string());
        SetBroadcaster::Ok
    }
    pub fn clear_broadcaster(&mut self) { self.broadcaster = None; }
    pub fn broadcaster(&self) -> Option<String> { self.broadcaster.clone() }
    pub fn is_live(&self) -> bool { self.broadcaster.is_some() }

    pub fn add_viewer(&mut self, id: &str) {
        if !self.viewers.iter().any(|v| v == id) { self.viewers.push(id.to_string()); }
    }
    pub fn remove_viewer(&mut self, id: &str) { self.viewers.retain(|v| v != id); }
    pub fn viewers(&self) -> Vec<String> { self.viewers.clone() }
    pub fn is_empty(&self) -> bool { self.broadcaster.is_none() && self.viewers.is_empty() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broadcaster_then_viewers_join_and_leave() {
        let mut room = BroadcastRoom::new();
        assert_eq!(room.set_broadcaster("b1"), SetBroadcaster::Ok);
        assert_eq!(room.set_broadcaster("b2"), SetBroadcaster::AlreadyLive);
        room.add_viewer("v1");
        room.add_viewer("v2");
        assert_eq!(room.viewers(), vec!["v1".to_string(), "v2".to_string()]);
        assert!(room.is_live());
        room.remove_viewer("v1");
        assert_eq!(room.viewers(), vec!["v2".to_string()]);
        room.clear_broadcaster();
        assert!(!room.is_live());
    }

    #[test]
    fn tracks_broadcaster_id() {
        let mut room = BroadcastRoom::new();
        room.set_broadcaster("b1");
        assert_eq!(room.broadcaster(), Some("b1".to_string()));
    }
}
