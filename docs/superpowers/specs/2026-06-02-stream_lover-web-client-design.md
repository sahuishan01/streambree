# stream_lover — Web Client Design

**Date:** 2026-06-02
**Status:** Approved (design phase).
**Scope of this doc:** the **web client v1** plus a small **server delta** for personal saved rooms.
Native clients (desktop, Android) and shared channels-with-roles are separate, later specs.

## 1. Purpose

The reference client for stream_lover: a browser app that streams a screen, camera, or media
file from one device to another, peer-to-peer over WebRTC, using the signaling server already
built. It runs on every desktop OS and on Android with no install, and directly exercises the
server end-to-end. It supports both a low-latency real-time mode and a high-quality buffered
mode, and pairs devices via one-off room codes **or** logged-in accounts with personal saved
rooms.

## 2. Why web first

WebRTC, `getUserMedia`, and `getDisplayMedia` are native in browsers; no install; cross-platform;
fastest proof of the whole system. Native desktop/Android wrappers follow once the protocol and
UX are proven and can reuse the framework-agnostic core defined here.

## 3. Scope (decided)

| Decision | Choice |
|---|---|
| First client | Web browser (React + TypeScript + Vite); native later |
| Sources (v1) | Screen/window share, Camera + mic, Media file (`<video>` + `captureStream()`) |
| Excluded source | "App audio only" — not reliable in a browser; deferred to native clients |
| Modes | Real-time and High-quality, as `RTCPeerConnection`/encoding parameters |
| Pairing | One-off room codes **and** accounts (login/signup) + device list |
| Saved rooms | **Personal** saved rooms (named, persistent, reusable, in the owner's list) |
| Type sync | Hand-written TS types mirroring the Rust `ClientMsg`/`ServerMsg` enums |
| Code structure | Framework-agnostic core + thin React UI; hand-rolled connection state machine |
| Room size | Strictly 2-peer (1 sender + 1 receiver); multi-party/SFU is a future phase |
| Deferred | Shared channels + membership + roles (Phase 2); multi-party/SFU (Phase 3); native clients |

## 4. Roadmap context

- **Phase 1 (this spec):** Web client v1 + personal saved rooms (introduces the persistent
  `rooms` table).
- **Phase 2 (next spec):** Promote saved rooms into shared channels — member rosters, invites,
  owner/admin/member roles, presence. References the `rooms` table from Phase 1.
- **Phase 3 (future):** Multi-party (3+) via an SFU; then native desktop/Android clients.

## 5. Architecture & module layout

```
web/
├── src/
│   ├── core/                         # framework-agnostic, unit-tested
│   │   ├── protocol.ts               # hand-written ClientMsg/ServerMsg types (match Rust)
│   │   ├── signaling-client.ts       # WebSocket wrapper: join, typed send/recv, reconnect
│   │   ├── rtc-session.ts            # RTCPeerConnection wrapper: offer/answer/ICE, tracks
│   │   ├── connection-machine.ts     # explicit lifecycle state machine (pure)
│   │   ├── modes.ts                  # realtime|quality → sender params / playout hints
│   │   └── sources.ts                # getDisplayMedia / getUserMedia / file→captureStream
│   ├── api/
│   │   └── rest.ts                   # signup/login/devices/rooms/turn-credentials calls
│   ├── ui/                           # React components (thin)
│   │   ├── App.tsx + routes
│   │   ├── auth/   (login, signup)
│   │   ├── pair/   (create room, join room, my-rooms, device list)
│   │   ├── session/(SenderView, ReceiverView, controls, status chip)
│   │   └── hooks/  (useSignaling, useRtcSession)
│   └── main.tsx
├── index.html
├── package.json, tsconfig.json, vite.config.ts
└── tests/  (vitest)
```

The core never imports React; the UI never touches `RTCPeerConnection` directly. Each core
module has one job and is testable with mocks (fake WebSocket, fake `RTCPeerConnection`).

### Data flow for a session
```
UI picks source + mode
   │
   ▼
SignalingClient.join(room, role, mode) ──WS──► server
   ◄── joined { peer_present, ice_servers }
   │
   ▼
RtcSession.start(ice_servers, mode)
   • sender:   addTrack(source stream) → createOffer → send via SignalingClient
   • receiver: ontrack → render to <video>; createAnswer
   • both:     onicecandidate → send ice; on remote ice → addIceCandidate
   │
   ▼
ConnectionMachine: idle→joining→waiting-for-peer→negotiating→connected
                   (or →reconnecting→…→closed); transport = direct|relay
   │
   ▼
Media flows peer-to-peer (server idle unless TURN relay)
```

## 6. Core modules

### protocol.ts
Hand-written discriminated unions matching the Rust enums exactly:
```ts
type Role = 'sender' | 'receiver';
type Mode = 'realtime' | 'quality';

type ClientMsg =
  | { type: 'join'; room: string; role: Role; mode: Mode }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

type ServerMsg =
  | { type: 'joined'; peer_present: boolean; ice_servers: RTCIceServer[] }
  | { type: 'peer-joined' }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'peer-left' }
  | { type: 'error'; code: string; message: string };
```

### signaling-client.ts
Owns the `WebSocket`. `join(room, role, mode)`, typed `send(msg)`, an event emitter for inbound
`ServerMsg`, and bounded auto-reconnect that re-`join`s the room on reconnect (matches the
server's v1 "re-join to resume" model). Knows nothing about media.

### rtc-session.ts
Owns one `RTCPeerConnection`. Wires `onicecandidate` → signaling, `ontrack` → a render callback,
applies remote offers/answers. Exposes `addStream(stream)` (sender) and `close()`. Implements
**perfect negotiation** (deterministic polite/impolite roles by `Role`) so glare cannot deadlock
the handshake.

### connection-machine.ts
Pure `reduce(state, event) → state` over:
`idle → joining → waiting-for-peer → negotiating → connected → reconnecting → closed`,
plus a derived `transport: 'direct' | 'relay'` read from the selected ICE candidate pair.
No I/O — fully unit-tested.

### modes.ts
`applyMode(pc, mode)`:
- **realtime:** sender `setParameters` with `degradationPreference: 'maintain-framerate'`, a modest
  `maxBitrate`; receiver `playoutDelayHint ≈ 0`.
- **quality:** `degradationPreference: 'maintain-resolution'`, higher `maxBitrate`; larger receiver
  playout buffer.

### sources.ts
`captureScreen()`, `captureCamera()`, `captureFile(file)` — each returns a `MediaStream` and
centralizes browser-API quirks and permission-error handling.

### api/rest.ts
`fetch` wrappers: `signup`/`login` (store JWT), `listDevices`/`registerDevice`,
`createRoom`/`listRooms`/`deleteRoom`/`resolveRoom`, and `getIceServers`. JWT kept in memory and
mirrored to `localStorage`; attached as `Authorization: Bearer` on authed calls.

## 7. Server delta — personal saved rooms

New persistent table:
```
rooms( id, owner_id → users.id, name, code UNIQUE, created_at )
```

New/changed endpoints:
- `POST /rooms` — create a **named, persistent** room: `{ name }` → `{ id, name, code }`, saved to
  the authed owner. An unnamed/guest create still returns a one-off ephemeral `{ code }`.
- `GET /rooms` — list the authed user's saved rooms.
- `DELETE /rooms/{id}` — delete a saved room the user owns.
- `GET /rooms/resolve/{code}` — public: 200 if the code maps to a real room, 404 otherwise.

The signaling `join` is unchanged on the wire — it keys the in-memory session by `code`; codes
are now stable and may be validated against the table. Live media sessions remain in-memory and
strictly 2-peer.

## 8. UX & screens

Role-driven, minimal. Routed screens:

- **Home:** `Start streaming` / `Join a stream`; logged-out users see `Log in / Sign up` but can
  skip and use codes.
- **Start streaming (sender):** choose source (Screen / Camera / File) and mode (Real-time /
  High quality) → `Create session` → shows room code + copyable link + local preview + a status
  chip (`waiting → connecting → connected · direct|relay`). On `peer-joined`, negotiates and
  streams.
- **Join a stream (receiver):** enter code → `Join` → remote video with fullscreen toggle + the
  same status chip.
- **My Rooms (logged in):** create a named room, list saved rooms, open one as sender/receiver,
  copy its stable link, delete it.
- **Auth + My Devices:** login/signup; register the current browser as a device and see the
  account's devices.

**Controls:** stop/leave, mute mic (camera mode), copy link, fullscreen.

**direct vs relay chip:** reads the selected ICE candidate pair; `relay` means the session is
going through TURN (CGNAT fallback). Makes P2P-vs-relay visible and aids debugging.

## 9. Error handling

Every failure is an explicit UI state, never silent:
- **Permission denied** (camera/screen rejected) → inline message on the source picker; stay on setup.
- **Room full** (`error: room-full`) → "This room already has two people."
- **Peer left** (`peer-left`) → receiver: "Stream ended"; sender: "Viewer disconnected"; re-negotiate on return.
- **Signaling socket drop** → `reconnecting` with bounded backoff + re-join; after N attempts, "Disconnected — retry."
- **ICE failure** (no candidate pair, even via TURN) → "Couldn't connect — network may be blocking it."
- **Bad/expired code** (`resolve` 404) → "No such room."
- **Auth failure** (401) → redirect to login, preserve intended destination.

## 10. Testing (Vitest)

Mirrors the server's pure-core discipline:
- **connection-machine.ts** — exhaustive pure transition tests, incl. `direct`/`relay` derivation
  and drop→reconnect→connected.
- **signaling-client.ts** — mock WebSocket: join sent, each `ServerMsg` parsed to typed events,
  re-join on reconnect.
- **rtc-session.ts** — fake `RTCPeerConnection`: offer on `peer-joined`, answer on remote offer,
  ICE forwarded, glare resolved, tracks surfaced.
- **modes.ts** — realtime vs quality produce expected parameters/playout hints.
- **api/rest.ts** — mocked `fetch`: token stored on login, auth header attached, room
  create/list/resolve shapes.
- **UI** — React Testing Library smoke tests of the key flows (source pick → create → code shown;
  join → connecting). WebRTC mocked.
- **Manual checklist** in the README: two tabs / two devices, each source, each mode, and a
  forced-relay check.

## 11. Out of scope (this phase)

- Shared channels, membership rosters, invites, roles/permissions, presence (Phase 2).
- Multi-party (3+) / SFU (Phase 3).
- Native desktop and Android clients.
- "App audio only" capture.
- Recording, chat.

## 12. Open questions / future

- Reconnect/resume semantics beyond "re-join the room" (revisit if sessions need to survive longer outages).
- Whether saved-room links should carry a short-lived token vs. relying on `resolve` (revisit in Phase 2 with membership).
