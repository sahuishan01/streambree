# stream_lover web client

React + TS + Vite. Framework-agnostic WebRTC core in `src/core/`, thin UI in `src/ui/`.

## Develop
    npm install
    VITE_SERVER_URL=http://localhost:8080 npm run dev
    npm test

## Architecture
- `src/core/` — framework-agnostic, unit-tested: `protocol`, `connection-machine`,
  `signaling-client`, `rtc-session`, `modes`, `sources`. No React imports.
- `src/api/rest.ts` — auth + saved-room REST calls.
- `src/ui/` — React screens (`Home`, `Sender`, `Receiver`, `Auth`, `MyRooms`) and the
  `useSession` hook that orchestrates signaling + RTC + the connection state machine.

## Known limitations (v1) — tracked follow-ups
- **Mode is signaled but not yet applied to the local peer.** `modes.ts`
  (`applySenderParams`/`receiverPlayoutHint`) is implemented and tested but not yet invoked on
  the `RTCPeerConnection`, so Real-time vs High-quality currently has no effect on the encoding.
  Wiring needs `IPeer` to expose `getSenders()`.
- **Transport chip always shows `connected` without `direct|relay`.** The selected ICE
  candidate-pair detection (via `getStats`) isn't wired yet; `transport` is hardcoded `unknown`.
  Wiring needs `IPeer` to expose `getStats()`.

## Manual test checklist (real browsers)
Run the server first:
`cd ../server && JWT_SECRET=dev TURN_SECRET=dev cargo run -p stream_lover_server`

1. Open two tabs (or two devices). Tab A: Start streaming → Screen → Real-time → Create
   session; copy the code.
2. Tab B: Join a stream → paste code → confirm remote video appears; status shows
   `connected · direct`.
3. Repeat with Camera and with File sources.
4. Repeat with High-quality mode; confirm video plays (higher bitrate, slight delay).
5. Force relay: put the two devices on networks that block direct P2P (or firewall the
   relay range off) and confirm status shows `connected · relay`.
6. Logged in (via Account): create a named room under `/rooms`; rejoin it later via its
   stable code.
