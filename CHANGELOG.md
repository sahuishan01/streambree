# Changelog

## [0.3.0] - 2026-06-04
### Added
- Channels: `rooms` renamed to `channels` with membership, owner/admin/member roles, and a
  `can_stream` block flag. Personal saved rooms backfilled as single-member channels.
- Invites: revocable invite links (create/accept/preview) and add-by-email.
- Moderation: kick, role change, transfer ownership, force-stop any stream, block a member from streaming.
- Authenticated 1-broadcaster->N-viewer broadcast signaling (`/ws/broadcast`) with peer-id-tagged
  routing; media stays peer-to-peer (sender-side fan-out). `GET /channels/:id/stream` live status.
### Changed
- REST: `/rooms*` replaced by `/channels*`.

## [0.2.1] - 2026-06-03
### Added
- Web client: mode is now applied to the live peer (`applyMode` — sender bitrate/degradation +
  receiver playout hint) on connect.
- Web client: real direct/relay transport detection via `getStats` (`detectTransport`); the
  status chip reflects it. Connection now advances to `connected` on real ICE connectivity,
  not on receiving an answer.

## [0.2.0] - 2026-06-03
### Added
- Server: persistent saved rooms (`rooms` table; create/list/delete/resolve endpoints).
- Web client (React + TS + Vite): screen/camera/file streaming, real-time & quality modes,
  room-code and account pairing, personal saved rooms, direct/relay status indicator.
- Framework-agnostic, unit-tested core: protocol, connection state machine, signaling client,
  RTC session, modes, capture sources, REST client.

## [0.1.0] - 2026-06-02
### Added
- Server workspace: `turn`, `auth`, `store`, `signaling`, `api` crates + `stream_lover_server` binary.
- Ephemeral coturn TURN credential generation (REST auth-secret scheme).
- JWT auth, argon2 password hashing, room-code generation.
- SQLite persistence for users and devices.
- WebRTC signaling: 2-peer room state machine, async Hub, WebSocket endpoint (end-to-end tested).
- REST API: signup/login, device registry, room creation, TURN credentials.
- Deployment: coturn config, Dockerfile, docker-compose.
