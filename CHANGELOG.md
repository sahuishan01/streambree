# Changelog

## [0.1.0] - 2026-06-02
### Added
- Server workspace: `turn`, `auth`, `store`, `signaling`, `api` crates + `stream_lover_server` binary.
- Ephemeral coturn TURN credential generation (REST auth-secret scheme).
- JWT auth, argon2 password hashing, room-code generation.
- SQLite persistence for users and devices.
- WebRTC signaling: 2-peer room state machine, async Hub, WebSocket endpoint (end-to-end tested).
- REST API: signup/login, device registry, room creation, TURN credentials.
- Deployment: coturn config, Dockerfile, docker-compose.
