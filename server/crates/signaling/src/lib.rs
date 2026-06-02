//! WebRTC signaling: protocol types, room state machine, and the async hub.

pub mod protocol;
pub mod room;

pub use protocol::{ClientMsg, Mode, Role, ServerMsg};
pub use room::{JoinOutcome, Room};
