# stream_lover

Peer-to-peer media/screen streaming between devices. Media flows directly device-to-device
via WebRTC; the server only does signaling and supplies STUN/TURN so connections survive
CGNAT. Two modes: low-latency real-time and high-quality buffered (a client-side WebRTC
config choice — the server is identical for both).

## Status
- **Server (this phase):** signaling + REST API + ephemeral TURN credentials + coturn deploy. Done.
- **Client:** designed in a later spec.

## Server layout
See `server/` — a Rust workspace: `turn`, `auth`, `store`, `signaling`, `api` crates and a
`stream_lover_server` binary. Deploy assets in `server/deploy/`.

## Develop
    cd server && cargo test      # run the whole test suite
    JWT_SECRET=dev TURN_SECRET=dev cargo run -p stream_lover_server

## Deploy
See `server/deploy/README.md`.
