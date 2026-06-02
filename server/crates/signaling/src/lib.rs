//! WebRTC signaling: protocol types, room state machine, and the async hub.

pub mod hub;
pub mod protocol;
pub mod room;

pub use hub::Hub;
pub use protocol::{ClientMsg, Mode, Role, ServerMsg};
pub use room::{JoinOutcome, Room};
