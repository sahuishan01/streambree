# stream_lover — server deployment handoff

A runbook to bring stream_lover up on a **Debian VPS that already has podman + caddy**.
The whole deploy is one script (`setup.sh`); this doc is the surrounding checklist plus
day-2 operations.

---

## 0. What gets deployed

| Piece | Where it runs | Notes |
|-------|---------------|-------|
| Web app (React SPA) | static files in `/srv/stream_lover/web`, served by Caddy | built in a throwaway `node` container |
| Signaling + REST API | podman container `stream_lover-signaling`, bound to `127.0.0.1:8080` | Rust, SQLite on a named volume |
| STUN/TURN | podman container `coturn`, host networking | survives CGNAT |
| TLS + routing | Caddy (`/etc/caddy/Caddyfile`) | auto-HTTPS; SPA at `/`, API/WS under `/api/*` |

Media is peer-to-peer (WebRTC). The server only does signaling + hands out TURN credentials.

---

## 1. Prerequisites (do these first)

1. **A domain name** pointed at the VPS. Create a DNS **A record** (and AAAA if you have IPv6):
   ```
   stream.example.com  ->  <your VPS public IP>
   ```
   Caddy needs this resolving *before* you run, or the TLS cert request fails.

2. **A sudo-capable user.** The script uses `sudo` for the Caddyfile, the web root, and
   reloading Caddy.

3. **podman + caddy installed** (you said they are). Sanity check:
   ```bash
   podman --version
   caddy version
   openssl version      # used to generate secrets
   ```

4. **Open the firewall ports** (UFW / cloud security group — whichever you use):

   | Port | Proto | For |
   |------|-------|-----|
   | 443 | TCP | web app + API + `wss://` (Caddy, auto-HTTPS) |
   | 80 | TCP | HTTP→HTTPS redirect + ACME challenge |
   | 3478 | UDP **and** TCP | STUN / TURN |
   | 49152–65535 | UDP | TURN relay range |

   Example with UFW:
   ```bash
   sudo ufw allow 80,443/tcp
   sudo ufw allow 3478
   sudo ufw allow 49152:65535/udp
   ```

---

## 2. Deploy

```bash
# clone (or pull) the repo
git clone git@github.com:sahuishan01/streambree.git stream_lover
cd stream_lover

# run it — pass your domain
./setup.sh stream.example.com
```

First run takes a while (it compiles the Rust server inside a container). It will:
- generate secrets into `deploy-runtime/.env` (kept secret, git-ignored),
- build the server image and the web client,
- start `coturn` and `stream_lover-signaling`,
- write `/etc/caddy/Caddyfile` and reload Caddy.

When it finishes it prints the URL and a port checklist.

---

## 3. Verify

```bash
curl https://stream.example.com/api/healthz     # -> ok
podman ps                                        # coturn + stream_lover-signaling, both Up
```

Then open `https://stream.example.com` in a browser:
1. Sign up two accounts (two browsers / one incognito).
2. Account A: create a channel → make an invite link.
3. Account B: open the invite link → join.
4. A: open the channel → **Go live** (screen/camera). B: open the channel → **Watch**.
   The stream should appear and the viewer count should rise.

To confirm TURN works (the hard part behind CGNAT), put the two devices on networks that
block direct P2P; the status chip should read `connected · relay`.

---

## 4. Day-2 operations

**Logs**
```bash
podman logs -f stream_lover-signaling
podman logs -f coturn
journalctl -u caddy -f
```

**Restart a piece**
```bash
podman restart stream_lover-signaling
sudo systemctl reload caddy
```

**Update to a new version** (rebuilds + redeploys; safe to re-run any time)
```bash
cd stream_lover
git pull
./setup.sh stream.example.com
```

**Back up the database** (accounts, channels, invites live here)
```bash
podman volume export stream_lover_data --output stream_lover_data.tar
# restore:  podman volume import stream_lover_data stream_lover_data.tar
```

**Rotate all secrets** (invalidates existing logins)
```bash
rm deploy-runtime/.env
./setup.sh stream.example.com
```

---

## 5. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `curl …/api/healthz` hangs or 502 | signaling container not up → `podman logs stream_lover-signaling` |
| Browser loads but TLS error / no cert | DNS not pointing at the VPS yet, or port 80/443 closed. Check `journalctl -u caddy`. |
| Stream connects only on same network, never `relay` | UDP 3478 or relay range 49152–65535 closed on the firewall |
| Cloud VPS where TURN never relays | the box is behind NAT; add `external-ip=<public-ip>` to `deploy-runtime/coturn.conf`, then `podman restart coturn` |
| Restrictive network (only 443 allowed) blocks TURN | switch to TURNS over 443 — see note below |
| Containers gone after reboot | rootless restart needs lingering: `loginctl enable-linger $USER` (the script attempts this) |

**TURNS over 443 (optional hardening):** the default deploy uses plain `turn:…:3478`, which is
fine for most CGNAT but not networks that only permit 443. To support those, give coturn the TLS
cert Caddy already obtained and switch the signaling env to `turns:<domain>:5349`. See
`server/deploy/README.md` for the cert wiring.

---

## 6. Key files & names (for reference)

- `setup.sh` — the deploy script (re-runnable)
- `deploy-runtime/.env` — generated `JWT_SECRET` + `TURN_SECRET` (**secret**, git-ignored)
- `deploy-runtime/coturn.conf` — generated coturn config (contains the TURN secret)
- `/etc/caddy/Caddyfile` — routing + TLS
- `/srv/stream_lover/web` — published SPA
- podman volume `stream_lover_data` — the SQLite database
- containers: `stream_lover-signaling`, `coturn`
