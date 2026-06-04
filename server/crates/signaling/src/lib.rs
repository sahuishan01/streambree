//! WebRTC signaling: protocol types, room state machine, and the async hub.

pub mod broadcast;
pub mod hub;
pub mod protocol;
pub mod room;

pub use broadcast::{BroadcastRoom, SetBroadcaster};
pub use hub::Hub;
pub use protocol::{BroadcastClientMsg, BroadcastRole, BroadcastServerMsg};
pub use protocol::{ClientMsg, Mode, Role, ServerMsg};
pub use room::{JoinOutcome, Room};
