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
