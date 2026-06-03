# stream_lover

Peer-to-peer media/screen streaming between devices. Media flows directly device-to-device
via WebRTC; the server only does signaling and supplies STUN/TURN so connections survive
CGNAT. Two modes: low-latency real-time and high-quality buffered (a client-side WebRTC
config choice — the server is identical for both).

## Status
- **Server:** signaling + REST API + ephemeral TURN credentials + saved rooms + coturn deploy. Done.
- **Web client:** screen/camera/file streaming, real-time & quality modes, room-code & account
  pairing, personal saved rooms. Done.
- **Native clients (desktop, Android) & shared channels with roles:** later phases.

## Server layout
See `server/` — a Rust workspace: `turn`, `auth`, `store`, `signaling`, `api` crates and a
`stream_lover_server` binary. Deploy assets in `server/deploy/`.

## Web client
See `web/` — React + TS + Vite. Streams screen/camera/file peer-to-peer to another device.
    cd web && npm install && VITE_SERVER_URL=http://localhost:8080 npm run dev

## Develop
    cd server && cargo test      # run the whole server test suite
    JWT_SECRET=dev TURN_SECRET=dev cargo run -p stream_lover_server
    cd web && npm test           # run the web client test suite

## Deploy
See `server/deploy/README.md`.
