# Streambree — Session Handoff

**Session:** `streambree-audio-polish`  
**Date:** 2026-06-05  
**Repo:** `git@github.com:sahuishan01/streambree.git`  
**Live URL:** `https://stream.algosculptor.com`  
**VPS:** Debian, podman/podman-compose, Caddy reverse proxy  

---

## How to continue

Start a new Claude Code session in `/root/services/streambree` and say:

> "continue from the streambree-audio-polish handoff"

---

## What was built this session

### Features added
- **User management** — owner-only add/delete users, `POST /users`, `DELETE /users/:id`
- **Signups disabled by default** — `SIGNUPS_ALLOWED=false`; admin seeded via `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars on first boot
- **Profile page** (`/profile`) — username update, password change
- **Full dark UI redesign** — CSS custom properties, Inter font, component classes in `styles.css`
- **Audio-only file streaming** — MP3, WAV, FLAC, OGG, AAC, M4A routed through `<audio>` element with native controls
- **Mobile: Screen option hidden** — `getDisplayMedia` not available on Android/iOS; page auto-hides it and defaults to File

### Audio fixes (in order)
1. `video.muted = false` before `captureStream()` — Chrome skips audio pipeline for muted elements
2. `el.oncanplay` before `play()` — avoids AbortError race on receiver
3. Removed `muted` JSX prop — React was re-applying `muted=true` on re-renders
4. `position:fixed; left:-9999px` instead of `display:none` — Chrome throttles audio for hidden elements
5. SDP `a=fmtp` rewrite — Opus 320 kbps stereo 48 kHz VBR with FEC (`sdp-utils.ts`)
6. `RTCRtpSender.setParameters({ maxBitrate: 320_000 })` at connection time — enforces bitrate at encoder level
7. `applyConstraints({ echoCancellation:false, noiseSuppression:false, autoGainControl:false })` on captured audio track — disables Chrome's WebRTC voice processing pipeline
8. All Web Audio API processing (GainNode, DynamicsCompressor) removed — audio passes through as-is

---

## Current architecture

```
Browser (sender)
  captureFile() / captureScreen() / captureCamera()
    └─ <video> or <audio> element → captureStream()
    └─ applyConstraints() disables echo/noise/AGC
  BroadcastSender / RtcSession
    └─ enhanceAudioSdp() rewrites Opus fmtp before offer
    └─ applyMode() sets video + audio bitrate via setParameters()
  WebSocket signaling → stream_lover-signaling:8080

Browser (receiver/viewer)
  BroadcastViewer / useSession hook
  <video ref> — srcObject = remote stream
  el.muted = true → autoplay → "Click to unmute" overlay → el.muted = false
```

### Server (Rust workspace at `server/`)
| Crate | Purpose |
|-------|---------|
| `api` | REST: auth, user CRUD, TURN credentials |
| `auth` | JWT issue/verify, Argon2 hashing |
| `signaling` | WebSocket: 1-to-1 and broadcast signaling |
| `store` | SQLite via sqlx, migrations |
| `turn` | coturn credential generation |

### Key env vars (set in podman run / docker-compose)
| Var | Default | Notes |
|-----|---------|-------|
| `SIGNUPS_ALLOWED` | `false` | Set `true` to allow public signup |
| `ADMIN_EMAIL` | — | Seeds owner account on first boot |
| `ADMIN_PASSWORD` | — | Cleared from env after first boot |
| `JWT_SECRET` | required | Long random string |
| `DATABASE_URL` | `sqlite:///data/db.sqlite` | Mounted volume |

---

## Key files

| File | Notes |
|------|-------|
| `web/src/core/sources.ts` | `captureFile`, `captureScreen`, `captureCamera`, `isAudioFile` |
| `web/src/core/sdp-utils.ts` | `enhanceAudioSdp` — Opus SDP rewrite |
| `web/src/core/modes.ts` | `applyMode` — sets video + audio bitrate at runtime |
| `web/src/core/broadcast-session.ts` | `BroadcastSender`, `BroadcastViewer` |
| `web/src/core/rtc-session.ts` | `RtcSession` — 1-to-1 P2P |
| `web/src/ui/screens/GoLive.tsx` | Channel broadcast sender |
| `web/src/ui/screens/Sender.tsx` | 1-to-1 sender |
| `web/src/ui/screens/Watch.tsx` | Channel broadcast viewer |
| `web/src/ui/screens/Receiver.tsx` | 1-to-1 receiver |
| `web/src/ui/styles.css` | Full design system (CSS vars, components) |
| `server/crates/api/src/handlers.rs` | All REST handlers |
| `server/crates/store/src/lib.rs` | DB layer, User struct |
| `server/crates/store/migrations/` | SQLite migrations 0001–0005 |

---

## Build and deploy

```bash
# Build + publish the web UI to /srv/streambree/web (backs up the old build, prints rollback)
./deploy-web.sh stream.algosculptor.com

# Rebuild + restart the signaling server (runs natively under systemd on this VPS)
(cd server && cargo build --release)
systemctl restart streambree-signaling
```

Do not run `setup.sh` on this VPS: it would replace `/etc/caddy/Caddyfile` (which imports
every site in `/etc/caddy/sites/`) and start a second, podman-based API server. It now
refuses to run here.

---

## Known limitations / pending work

- **AC3 / DTS audio in MKV** — browser cannot decode; user must convert:
  `ffmpeg -i input.mkv -t 180 -c:v copy -c:a aac output.mkv`
- **Android screen share** — `getDisplayMedia` is not available on any mobile browser; Screen option is now hidden on mobile, no workaround exists
- **Debug box** in `GoLive.tsx` — `dbg` state was removed but double-check it's fully gone
- **iOS Safari** — untested; `captureStream()` is not supported on iOS at all (file streaming will silently have no audio)

---

## Infrastructure (VPS)

- **Caddy** reverse proxy in container `reverse-proxy`, config at `/root/services/Caddyfile`
- **Cloudflare** proxy (orange cloud) on `stream.algosculptor.com` — Origin CA cert in `/root/services/certs/`
- **UFW** firewall; `ufw allow in on podman2` required for container DNS
- **coturn** on host network for TURN/STUN (ports 3478, 49152-65535/udp)
- **SQLite** data on named podman volume `stream_lover_data`
- **docker-compose** at `/root/services/docker-compose.yml` manages all services
