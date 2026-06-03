# stream_lover — Phase 2a: Channels, Roles & Broadcast Streaming

**Date:** 2026-06-03
**Status:** Approved (design phase).
**Scope:** Promote saved rooms into shared **channels** with membership, roles, and invites,
plus authenticated **1-sender→N-viewer** broadcast streaming via sender-side fan-out.
**Deferred to Phase 2b:** realtime gateway — presence + text chat + pushed "X is live" events.
**Deferred to Phase 3:** SFU (server-side media fan-out for large audiences).

## 1. Purpose

Turn the single-owner "saved rooms" into Discord-like **channels**: persistent named spaces
with a member roster, owner/admin/member roles, and invites (link + by-user). A channel member
can go live and be watched by multiple other members at once. Media stays peer-to-peer — the
broadcaster opens a separate `RTCPeerConnection` to each viewer (sender-side fan-out), so the
server remains signaling-only. Owners/admins moderate: kick, change roles, force-stop any
stream, and block specific people from streaming.

## 2. Scope (decided)

| Decision | Choice |
|---|---|
| Concept | Unify `rooms` → `channels`; creator auto-enrolled as `owner` member |
| Roles | owner / admin / member (matrix in §4) |
| Invites | Invite **link/code** AND **add-by-email** (direct add; no pending-accept in v1) |
| Streaming | One active stream per channel: 1 broadcaster → N viewers, **no cap** |
| Fan-out | Sender-side: broadcaster holds N peer-connections, one shared captured stream |
| Server media load | None — media is P2P; server routes signaling only |
| Live discovery | REST poll `GET /channels/:id/stream` (no realtime in 2a) |
| Moderation | owner/admin: kick, role change, **force-stop any stream**, **block member from streaming** |
| Deferred | presence, text chat, pushed live events (2b); SFU/large audiences (3) |

## 3. Data model

Migration `0003_channels`:

```sql
ALTER TABLE rooms RENAME TO channels;   -- keeps id, owner_id, name, code, created_at

CREATE TABLE channel_members (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    can_stream  INTEGER NOT NULL DEFAULT 1,          -- 0 = blocked from streaming
    joined_at   TEXT NOT NULL,
    UNIQUE (channel_id, user_id)
);
CREATE INDEX idx_members_channel ON channel_members(channel_id);
CREATE INDEX idx_members_user    ON channel_members(user_id);

CREATE TABLE channel_invites (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,                -- redeemable invite token
    created_by  TEXT NOT NULL REFERENCES users(id),
    expires_at  TEXT,                                -- NULL = never expires
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_invites_channel ON channel_invites(channel_id);
```

**Backfill (same migration):** for each existing channel, insert a `channel_members` row making
`owner_id` the `owner` (preserves users' current saved rooms).

**Two distinct "codes":**
- `channels.code` — the **streaming** room id used by the signaling layer (unchanged role).
- `channel_invites.code` — a **membership** invite token. Separate so revoking an invite never
  breaks an active stream and the stream id is not a back door into membership.

## 4. Roles & permission matrix

Enforced server-side on every endpoint via the caller's role in that channel.

| Action | Owner | Admin | Member |
|---|:---:|:---:|:---:|
| View channel + roster | ✅ | ✅ | ✅ |
| Start/stop **own** stream · view a stream | ✅ | ✅ | ✅ (unless blocked) |
| Leave channel | ✅\* | ✅ | ✅ |
| Create/revoke invite link · add user by email | ✅ | ✅ | — |
| Kick a **member** | ✅ | ✅ | — |
| Kick / demote an **admin** | ✅ | — | — |
| Promote member→admin / demote admin→member | ✅ | — | — |
| Rename channel | ✅ | ✅ | — |
| Delete channel · transfer ownership | ✅ | — | — |
| **Force-stop any active stream** | ✅ | ✅ | — |
| **Block / unblock a member from streaming** | ✅ | ✅ (members only) | — |

\* The owner can't leave/delete-by-leaving; they must transfer ownership first (or delete the
channel). A channel always has exactly one owner. Moderation follows the kick hierarchy: an admin
may act on members; an owner may also act on admins; nobody may act on the owner.

## 5. REST endpoints

All JWT-authed; role checks per §4. Replaces the prior `/rooms` routes with `/channels`.

```
POST   /channels                       create channel (caller = owner)        → {id,name,code}
GET    /channels                       channels the caller belongs to         → [{id,name,code,role}]
GET    /channels/:id                   detail + my role + can_stream
DELETE /channels/:id                   delete (owner)
PATCH  /channels/:id                   rename (owner/admin)                    {name}

GET    /channels/:id/members           roster (members)                       → [{user_id,email,role,can_stream}]
DELETE /channels/:id/members/:uid      kick (per matrix) / leave (self)
PATCH  /channels/:id/members/:uid      change role (owner)                     {role}
PATCH  /channels/:id/members/:uid/streaming   block/unblock (owner/admin)      {allowed:bool}
POST   /channels/:id/transfer          transfer ownership (owner)              {user_id}

POST   /channels/:id/invites           create invite link (owner/admin)        {expires_at?} → {code}
GET    /channels/:id/invites           list active invites (owner/admin)
DELETE /channels/:id/invites/:code     revoke an invite (owner/admin)
POST   /channels/:id/add-user          add registered user by email (owner/admin) {email}
GET    /invites/:code                  invite preview (channel name) before accepting
POST   /invites/:code/accept           redeem invite → join as member          → {channel_id}

GET    /channels/:id/stream            is anyone live now?                     → {live:bool, broadcaster?:email}
POST   /channels/:id/stream/stop       force-stop the active stream (owner/admin)
```

`GET /channels/:id/stream` is the **no-realtime discovery** path for 2a: it reads the in-memory
broadcast session state (§6). In Phase 2b this becomes a pushed event.

## 6. Broadcast streaming (Approach A)

**Server.** A new `BroadcastRoom` lives in the existing hub beside the untouched 2-peer `Room`,
keyed by `channels.code`. It holds **one broadcaster** + **many viewers**. Joining uses a new
**authenticated** path: the join carries the JWT; the server verifies the caller is a member of
the channel owning that code (and, for a broadcaster, that `can_stream` is true) before admitting
them. Ad-hoc 2-peer code rooms keep their existing unauthenticated join.

Each viewer gets a server-assigned `peer_id`; all SDP/ICE in a broadcast is **tagged** with it so
the broadcaster knows which of its N connections a message belongs to.

```
# broadcaster
→ join-broadcast {code, role:'broadcaster', jwt}
← broadcast-joined {viewers:[id...]}        # existing viewers, if any
← viewer-joined {peer_id}                    # new viewer → sender makes a new RTCPeerConnection, offers
← viewer-left  {peer_id}                      # tear down that one connection
← force-stopped {by}                          # owner/admin ended the stream → broadcaster stops
↔ offer {peer_id,sdp}  answer {peer_id,sdp}  ice {peer_id,candidate}

# viewer
→ join-broadcast {code, role:'viewer', jwt}
← broadcast-joined {live:bool}                # is a broadcaster present?
← broadcaster-left {}                          # stream ended (or force-stopped)
↔ offer/answer/ice                             # one connection to the broadcaster
← error {code,message}                         # not-a-member | streaming-blocked | already-live | no-broadcaster
```

Routing: a viewer's `answer`/`ice` → the broadcaster tagged with that viewer's `peer_id`; the
broadcaster's `offer`/`ice {peer_id}` → that specific viewer. **One broadcaster per channel** (a
second broadcaster join → `error: already-live`). **No viewer cap.**

**Force-stop & block** are server-initiated: `POST /channels/:id/stream/stop` (and blocking a
currently-live member) call into the hub to terminate that channel's `BroadcastRoom` — emit
`force-stopped {by}` to the broadcaster and `broadcaster-left` to all viewers, then drop the room.

**Client core.** `core/broadcast-session.ts`:
- **`BroadcastSender`** — captures one source (reusing `sources.ts` + `modes.ts`); on each
  `viewer-joined`, spins up a fresh per-viewer connection seeded with the **same** local
  `MediaStream` and offers; on `viewer-left`, closes just that one. N connections, one shared
  stream = sender-side fan-out. Exposes viewer count + per-viewer state.
- **`BroadcastViewer`** — single connection to the broadcaster; renders the remote stream; reuses
  transport detection (direct/relay) and mode playout.

Media for every viewer flows **directly from the broadcaster**; the server passes only signaling.
The broadcaster's uplink scales with N (documented tradeoff; the Phase 3 SFU is the scalable fix).

## 7. Client UI

Channels become the home surface (the old "My rooms" screen evolves into **Channels**).

- **Channels list** — your channels with role + a `● live` badge (from `GET /channels/:id/stream`);
  `+ New`.
- **Channel detail** — header actions shown per *my role* (Rename / Invite / ⋯ delete·transfer);
  member roster with per-row controls (kick / promote·demote / block-streaming / leave) gated by
  role; a live banner with **Watch** (if someone's live) or **Go live** (if not), plus a
  **Stop stream** control for owner/admin when someone is live.
- **Invite dialog** — Create invite link → copyable `/invite/<code>`; Add by email.
- **Accept invite** (`/invite/:code`) — preview channel name → Join.
- **Go live (broadcaster)** — source + mode pickers → live; shows viewer count + per-viewer status.
- **Watch (viewer)** — remote video + direct/relay status chip + "stream ended" handling.

Role-driven rendering uses `my role` from `GET /channels/:id`; the **server enforces every action**
regardless of what the UI shows.

`api/rest.ts` gains the channel/member/invite/stream calls.

## 8. Error handling & edge cases

- **Not a member** opening/streaming a channel → 403 "You're not a member."
- **Insufficient role** (member tries kick/rename/invite/stop) → 403; UI hides the control but the
  server is the source of truth.
- **Invalid/expired/revoked invite** → 404/410 "This invite is no longer valid."
- **Last-owner guard**: owner leaving/removed without transfer → 409 "Transfer ownership first."
- **Add-by-email**: non-registered → 404 "No such user."; already a member → 409 "Already a member."
- **Second broadcaster** → `error: already-live` "Someone is already streaming."
- **Viewer, no broadcaster** → `broadcast-joined {live:false}` "No one is live yet."
- **Forged/missing JWT on broadcast socket** → `error: not-a-member`, socket closed.
- **Blocked member tries to broadcast** → `error: streaming-blocked`.
- **Broadcaster disconnects** → `broadcaster-left` to all viewers; **viewer disconnects** →
  `viewer-left {peer_id}` to broadcaster, which closes just that connection.
- **Force-stop / block-while-live** → broadcaster gets `force-stopped {by}`, viewers get
  `broadcaster-left`, room dropped.
- **Kicked mid-stream (as viewer)**: membership is checked at join; v1 does **not** force-disconnect
  an already-connected viewer when kicked (documented limitation; Phase 2b can revoke live).

## 9. Testing strategy

- **Server store (Rust, sqlx in-memory):** channels/members/invites CRUD; backfill correctness;
  `can_stream` toggle; invite redemption (valid/expired/revoked/already-member); last-owner guard;
  transfer ownership.
- **Permissions (Rust, table-driven):** each role × each action → allowed/denied, including
  force-stop and block (admin-on-member vs owner-on-admin vs nobody-on-owner).
- **Broadcast hub (Rust, in-process mock sockets):** authenticated `join-broadcast` membership +
  `can_stream` check; `peer_id`-tagged routing (viewer↔correct broadcaster connection);
  `already-live`; `viewer-left`/`broadcaster-left` fan-out; force-stop terminates and notifies;
  `GET /channels/:id/stream` reflects live state.
- **Client core (Vitest, injected fakes):** `BroadcastSender` opens one connection per
  `viewer-joined`, closes one per `viewer-left`, shares one `MediaStream`; `BroadcastViewer`
  single-connection flow; REST client channel/member/invite/stream calls vs mocked `fetch`.
- **UI (RTL):** role-gated controls render per `my role`; live badge from the stream endpoint;
  Channels list + Channel detail smoke tests.
- **Manual checklist:** create channel → invite (link + email) → 2nd/3rd account joins → go live on
  one, watch on the others (verify 1→N fan-out + direct/relay chips) → kick / transfer / role change
  / block-streaming / force-stop.

## 10. Out of scope (this phase)

- Presence, text chat, pushed "live now" events — **Phase 2b** (realtime gateway).
- SFU / server-side media fan-out for large audiences — **Phase 3**.
- Pending-accept invites (by-user is a direct add in v1).
- Forced live-revocation of an already-connected viewer on kick.
- Native desktop / Android clients.

## 11. Migration & compatibility notes

- The web client's existing `/rooms` REST calls and "My rooms" screen are replaced by `/channels`
  and the Channels surface. The 2-peer ad-hoc room-code flow (Home → Start/Join) stays as-is for
  guest pairing.
- `rooms` → `channels` is a table rename with a member-backfill; existing saved rooms become
  single-member channels owned by their creator.
