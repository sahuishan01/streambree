# stream_lover — Server Design

**Date:** 2026-06-02
**Status:** Approved (design phase). Scope of this doc: **server only**. Client is a later, separate spec.

## 1. Purpose

stream_lover lets a user stream media or a screen from one device to another in real
time, peer-to-peer, without the media passing through a central server in the common
case. It must still work when devices are behind CGNAT, and must support both a
low-latency real-time mode and a high-quality buffered mode.

The transport is **WebRTC**. The server's job is **signaling + connectivity assistance
only** — it is a matchmaker and a fallback relay, never a media transcoder or SFU.

## 2. Guiding principles

- **Media never touches the server unless it absolutely has to.** Direct P2P is the
  default path; the server stays idle during a normal session.
- **CGNAT is handled by ICE, not by us.** We supply STUN + ephemeral TURN credentials;
  the client's `RTCPeerConnection` decides when a relay is needed.
- **Mode is a client concern.** "Real-time" vs "high-quality" are different WebRTC
  configurations (jitter buffer, FEC, bitrate, codec), not different server paths. The
  server is identical for both and only records the chosen `mode` as metadata.
- **Small, focused, independently testable units** (one clear purpose per crate).
- **Hot path is in-memory; only durable data hits SQLite.**

## 3. Constraints & scope (decided)

| Decision | Choice |
|---|---|
| Latency model | Both low-latency real-time and high-quality buffered, switchable per session |
| Sources (client, later) | Screen/display, camera+mic, media files, app audio |
| Platforms (client, later) | Desktop (Win/Mac/Linux), Android, Web; iOS later |
| Scale | Small multi-user (tens of concurrent sessions, not thousands) |
| Pairing | Both: accounts + device list, **and** ad-hoc room codes for guests |
| Server stack | Rust (Axum + tokio + tokio-tungstenite) |
| TURN/STUN | coturn (industry standard) on the same VPS, via Docker |
| Deployment | Single Linux VPS, docker-compose, TLS via reverse proxy |
| v1 leanness | No email verification. Rate limiting noted as optional hardening, not core. |

## 4. Architecture

```
        ┌─────────────────────────────────────────────┐
        │              stream_lover server (VPS)        │
        │   ┌──────────────┐      ┌──────────────────┐  │
        │   │  signaling   │      │   coturn          │  │
        │   │  (Rust/Axum  │      │  STUN  (free)     │  │
        │   │   WebSocket) │      │  TURN  (relay,    │  │
        │   │  + REST API  │      │   fallback only)  │  │
        │   └──────────────┘      └──────────────────┘  │
        └───────▲───────────────────────▲───────────────┘
                │ (1) signaling only     │ (3) relay IF needed
                │     (SDP + ICE)        │     (CGNAT fallback)
        ┌───────┴────────┐      ┌────────┴───────┐
        │   Device A     │◄────►│   Device B     │
        │  (sender)      │ (2)  │  (receiver)    │
        └────────────────┘ P2P  └────────────────┘
              direct media flow (the normal case)
```

1. Both devices open a WebSocket to **signaling** and exchange SDP + ICE (tiny text
   messages, near-zero load).
2. **STUN** lets each device discover its public address; ICE usually punches a direct
   **P2P** path → media flows device-to-device, server idle.
3. **Only when both peers are behind CGNAT** and no direct path exists, ICE falls back to
   **TURN relay** in coturn for that one session.

## 5. Component breakdown (Rust workspace)

```
stream_lover/
├── server/
│   ├── crates/
│   │   ├── signaling/   WebSocket hub: rooms, peer matching, relays SDP+ICE
│   │   ├── api/         REST: auth, device registry, room create/join, TURN creds
│   │   ├── auth/        JWT issue/verify, password hashing, room-code logic
│   │   ├── store/       SQLite (sqlx): users + devices.  rooms/sessions in-memory
│   │   └── turn/        coturn ephemeral-credential generation (HMAC)
│   ├── bin/             server binary wiring crates together
│   └── deploy/          docker-compose (server + coturn), coturn.conf, TLS notes
```

### signaling (hot path)
In-memory registry of live sessions. A session is `{ room_id, peer_a, peer_b, mode }`.
When two peers share a room it forwards `offer` / `answer` / `ice` between them verbatim
— it never parses media. On socket drop, the surviving peer gets `peer-left`.

### api (cold path / setup)
- `POST /signup`, `POST /login` → JWT
- `GET /devices`, `POST /devices` (register this device to my account)
- `POST /rooms` (create code/link), `POST /rooms/{code}/join`
- `POST /turn-credentials` → time-limited TURN username/password

### auth
JWT for account sessions; argon2 password hashing. Room codes are short, random,
TTL-bounded. Enforces that a device belongs to the account claiming it.

### store
Only persistent state: `users`, `devices` tables (SQLite via sqlx). Rooms and live
sessions are deliberately **in-memory** — ephemeral, fast, zero DB load on the hot path.

### turn
Generates **ephemeral coturn credentials** using coturn's REST-auth scheme:
`username = "<expiry_unix>"` (optionally `:<account>`), `password = base64(HMAC_SHA1(secret, username))`.
Clients never receive a static TURN password; creds expire in minutes.

## 6. Signaling protocol (JSON over WSS)

```
→ join        {room, jwt|room_code, role: sender|receiver, mode: realtime|quality}
← joined      {peer_present: bool, ice_servers: [...stun/turn with ephemeral creds]}
← peer-joined {}                      (the other side arrived)
↔ offer       {sdp}                   (relayed peer→peer)
↔ answer      {sdp}
↔ ice         {candidate}
← peer-left   {}
← error       {code, message}
```

`ice_servers` is built at join time and includes the STUN URL plus a TURN URL with fresh
ephemeral creds. The client's `RTCPeerConnection` then uses TURN as a fallback only when
ICE can't find a direct path. **This is the entire CGNAT story.**

## 7. Data model (SQLite)

```
users(   id, email, password_hash, created_at )
devices( id, user_id → users.id, name, platform, last_seen )
```

Rooms / sessions are in-memory only (a `HashMap<room_id, Session>` guarded by an async
lock, plus per-socket sender handles). They never persist.

## 8. Connectivity / CGNAT handling

- STUN (coturn) for address discovery — covers most NATs.
- TURN (coturn) relay as fallback when both peers are behind CGNAT / symmetric NAT and no
  direct candidate pair succeeds. ICE selects this automatically.
- TURN over TLS (TURNS) so it survives restrictive networks and stays encrypted.
- Relay cost is bounded to genuinely un-punchable sessions, preserving "minimal server
  load" for the common case.

## 9. Security baseline

- TLS everywhere: WSS for signaling, TURNS for relay (WebRTC requires secure contexts).
- JWT required to open a signaling socket, **or** a valid unexpired room code for guests.
- TURN credentials are always ephemeral (minutes-long TTL).
- Room codes are random, short-lived, and bound to a single pairing.
- (Optional hardening, not v1-blocking: per-IP rate limiting on auth + room creation.)

## 10. Testing strategy (TDD)

**Pure unit tests:**
- Room state machine: join → match → relay → leave transitions.
- Room-code generation + expiry.
- TURN HMAC credential generation, verified against coturn's expected format.
- JWT issue/verify round-trip; password hash/verify.

**Integration tests:**
- Start the signaling service; connect two in-process WebSocket mock clients; assert a
  full `offer`/`answer`/`ice` exchange routes correctly and a disconnect fires `peer-left`.
- One manual/integration check that an ephemeral credential authenticates against a
  running coturn instance.

coturn itself is not unit-tested (battle-tested upstream).

## 11. Out of scope for the server phase

- All client capture/render code (screen, camera, media files, app audio).
- iOS support.
- Email verification, billing, horizontal scaling / load-balanced signaling (revisit only
  if scale assumptions change).

## 12. Open questions / future

- Multi-receiver (1→N) streaming would need an SFU; out of scope for v1 P2P.
- Reconnection/resume semantics after transient network loss (v1: re-join the room).
