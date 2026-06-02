# Deploying stream_lover server

## Prereqs
- A Linux VPS with a public IP and a DNS name (e.g. `turn.example.com`).
- Docker + Docker Compose.
- Open ports: TCP 8080 (signaling, ideally behind a TLS reverse proxy → 443),
  UDP/TCP 3478 and 5349 (STUN/TURN), UDP 49152-65535 (TURN relay).

## Configure
1. Set a strong shared secret in BOTH places — they must match exactly:
   - `coturn.conf` → `static-auth-secret`
   - `docker-compose.yml` → `signaling.environment.TURN_SECRET`
2. Set a strong `JWT_SECRET`.
3. Replace `turn.example.com` with your domain in `coturn.conf`, `TURN_URL`, `STUN_URL`, `realm`.

## TLS
WebRTC requires secure contexts. Put a reverse proxy (Caddy/nginx) in front of the
signaling service to serve `wss://.../ws` over 443. For TURNS, point coturn's
`cert`/`pkey` at your certificate (e.g. Let's Encrypt) and uncomment those lines.

## Run
    docker compose up -d --build

Check: `curl https://your-domain/healthz` → `ok`.
