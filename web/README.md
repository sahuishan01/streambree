# stream_lover web client

React + TS + Vite. Framework-agnostic WebRTC core in `src/core/`, thin UI in `src/ui/`.

## Develop
    npm install
    VITE_SERVER_URL=http://localhost:8080 npm run dev
    npm test

## Architecture
- `src/core/` — framework-agnostic, unit-tested: `protocol`, `connection-machine`,
  `signaling-client`, `rtc-session`, `modes`, `sources`. No React imports.
- `src/api/rest.ts` — auth + channel/member/invite/stream REST calls.
- `src/ui/` — React screens (`Home`, `Sender`, `Receiver`, `Auth`, `Channels`,
  `ChannelDetail`, `GoLive`, `Watch`, `InviteAccept`) and the `useSession` hook that
  orchestrates signaling + RTC + the connection state machine.

## Channels & broadcast
- `core/broadcast-protocol.ts` + `core/broadcast-session.ts` (`BroadcastSender` fan-out,
  `BroadcastViewer`) implement 1→N broadcast over `/ws/broadcast`.
- Screens: `Channels` (list), `ChannelDetail` (roster + role-gated moderation + invite +
  live banner + owner delete/transfer), `GoLive` (broadcaster), `Watch` (viewer),
  `InviteAccept`.
- ICE servers for broadcast are fetched via `POST /turn-credentials` (the `broadcast-joined`
  message does not carry them).

## Mode & transport
- **Mode is applied to the peer.** On connect, `modes.applyMode` sets the video sender's
  `maxBitrate` + `degradationPreference` and the receivers' `playoutDelayHint` from the chosen
  Real-time / High-quality mode (`rtc-session.ts`). The receiver currently uses `realtime`
  playout (the sender's mode is not yet signaled to the receiver — a small future follow-up).
- **Transport is detected.** On connect, `transport.detectTransport` reads `getStats()` to find
  the selected ICE candidate pair and reports `direct` or `relay`; the status chip shows it.

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
6. Logged in: open `/channels`, create a channel, make an invite link; a second account
   opens `/invite/<code>` and joins.

### Channels broadcast (real browsers)
1. Two logged-in accounts. A creates a channel, makes an invite link, B opens `/invite/<code>`
   and joins.
2. A opens the channel → Go live (screen/camera/file). B (and more tabs) open the channel →
   Watch. Confirm all viewers see A's stream and the viewer count rises (sender-side fan-out).
3. Owner/admin: kick, block-streaming, promote/demote, transfer ownership, Stop stream, Delete
   channel. Confirm a blocked member can't go live.
