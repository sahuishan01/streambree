use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Sender,
    Receiver,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Realtime,
    Quality,
}

/// Messages a client sends up the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientMsg {
    Join { room: String, role: Role, mode: Mode },
    Offer { sdp: String },
    Answer { sdp: String },
    Ice { candidate: serde_json::Value },
}

/// Messages the server pushes down the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerMsg {
    Joined { peer_present: bool, ice_servers: serde_json::Value },
    PeerJoined,
    Offer { sdp: String },
    Answer { sdp: String },
    Ice { candidate: serde_json::Value },
    PeerLeft,
    Error { code: String, message: String },
}

/// Messages a broadcast participant sends up the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum BroadcastClientMsg {
    JoinBroadcast { code: String, role: BroadcastRole, jwt: String },
    Offer { peer_id: String, sdp: String },
    Answer { peer_id: String, sdp: String },
    Ice { peer_id: String, candidate: serde_json::Value },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BroadcastRole {
    Broadcaster,
    Viewer,
}

/// Messages the server pushes to a broadcast participant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum BroadcastServerMsg {
    BroadcastJoined { live: bool, viewers: Vec<String> },
    ViewerJoined { peer_id: String },
    ViewerLeft { peer_id: String },
    BroadcasterLeft,
    ForceStopped { by: String },
    Offer { peer_id: String, sdp: String },
    Answer { peer_id: String, sdp: String },
    Ice { peer_id: String, candidate: serde_json::Value },
    Error { code: String, message: String },
}
