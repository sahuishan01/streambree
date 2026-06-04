# stream_lover Phase 2a — Web Client (Channels + Broadcast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the web client up to the Phase 2a server: a Channels surface (membership, roles, invites) replacing "My rooms", and 1-broadcaster→N-viewer broadcast streaming via sender-side fan-out, while keeping the existing ad-hoc 2-peer code flow working against the now-`/channels` server.

**Architecture:** Reuse the framework-agnostic core pattern — a new `core/broadcast-protocol.ts` (types matching the Rust `Broadcast*` enums) and `core/broadcast-session.ts` (`BroadcastSender` fan-out + `BroadcastViewer`, both over the existing injectable `ISocket`/`IPeer` factories). `api/rest.ts` swaps dead `/rooms*` methods for `/channels*` + invite/member/stream + `turnCredentials()`. Thin React screens on top.

**Tech Stack:** React 18 + TS + Vite + Vitest (existing `web/`). Reuses `core/rtc-session.ts` `IPeer`/`PeerFactory`, `core/signaling-client.ts` `ISocket`/`SocketFactory`, `core/modes.ts`, `core/transport.ts`.

---

## Context the server now provides (already built & on master)
- REST (all JWT-authed unless noted): `POST/GET /channels`, `GET/PATCH/DELETE /channels/:id`, `GET /channels/:id/members`, `DELETE/PATCH /channels/:id/members/:uid`, `PATCH /channels/:id/members/:uid/streaming`, `POST /channels/:id/transfer`, `POST/GET /channels/:id/invites`, `DELETE /channels/:id/invites/:code`, `POST /channels/:id/add-user`, `GET /invites/:code` (authed), `POST /invites/:code/accept`, `GET /channels/:id/stream`, `POST /channels/:id/stream/stop`, `POST /turn-credentials` (returns ICE servers array).
- `GET /channels` returns `[{id,name,code,role}]`; `GET /channels/:id` returns `{id,name,code,role,can_stream}`; `GET /channels/:id/members` returns `[{user_id,email,role,can_stream}]`.
- Broadcast WS at `/ws/broadcast`. First frame `join-broadcast {code, role, jwt}`. Server messages are JSON tagged `type` in kebab-case (`broadcast-joined`,`viewer-joined`,`viewer-left`,`broadcaster-left`,`force-stopped`,`offer`,`answer`,`ice`,`error`); field names are snake (`peer_id`). **`broadcast-joined` carries `{live, viewers}` but NOT ice servers** — clients fetch ICE via `POST /turn-credentials`.
- The 2-peer `/ws` endpoint is unchanged; its room is created on demand by the first `join`, so ad-hoc streaming needs no REST pre-registration.

## File Structure
```
web/src/
├── core/
│   ├── broadcast-protocol.ts     # NEW: Broadcast client/server message types
│   └── broadcast-session.ts      # NEW: BroadcastSender (fan-out) + BroadcastViewer
├── api/rest.ts                   # MODIFY: drop /rooms*, add channel/member/invite/stream/turn
└── ui/
    ├── App.tsx                   # MODIFY: routes (Channels, ChannelDetail, InviteAccept, GoLive, Watch)
    ├── screens/
    │   ├── Channels.tsx          # NEW (replaces MyRooms.tsx)
    │   ├── ChannelDetail.tsx     # NEW
    │   ├── InviteAccept.tsx      # NEW
    │   ├── GoLive.tsx            # NEW (broadcaster)
    │   ├── Watch.tsx             # NEW (viewer)
    │   ├── Sender.tsx            # MODIFY: ad-hoc code generated locally (no dead /rooms call)
    │   ├── Receiver.tsx          # MODIFY: drop resolveRoom; join /ws directly
    │   └── MyRooms.tsx           # DELETE
    └── Home.tsx                  # MODIFY: link to /channels
```

---

## Task 1: REST client — channels, members, invites, stream, TURN

**Files:**
- Modify: `web/src/api/rest.ts`, `web/src/api/__tests__/rest.test.ts`

- [ ] **Step 1: Replace the failing/dead room tests with channel tests**

In `web/src/api/__tests__/rest.test.ts`, remove the `createNamedRoom`/`resolveRoom` tests and add:

```ts
  it('createChannel posts the name and returns the channel', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { id: '1', name: 'Movie', code: 'ABC123' }));
    api.setToken('JWT');
    const ch = await api.createChannel('Movie');
    expect(ch.code).toBe('ABC123');
  });

  it('listChannels returns channels with my role', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, [{ id: '1', name: 'C', code: 'X', role: 'owner' }]));
    api.setToken('JWT');
    const chans = await api.listChannels();
    expect(chans[0].role).toBe('owner');
  });

  it('streamStatus reports live', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { live: true }));
    api.setToken('JWT');
    expect(await api.streamStatus('1')).toBe(true);
  });

  it('createInvite returns a code', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { code: 'INVITELONGTOKEN' }));
    api.setToken('JWT');
    expect(await api.createInvite('1')).toBe('INVITELONGTOKEN');
  });

  it('turnCredentials returns the ICE servers array', async () => {
    const servers = [{ urls: ['stun:x'] }];
    const api = new ApiClient('http://srv', mockFetch(200, servers));
    api.setToken('JWT');
    expect(await api.turnCredentials()).toEqual(servers);
  });
```

Keep the existing `login stores token` and `attaches the bearer token` tests but change the latter to call `api.listChannels()` instead of `api.listRooms()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/api/__tests__/rest.test.ts`
Expected: FAIL — channel methods undefined.

- [ ] **Step 3: Rewrite `rest.ts`**

Replace `web/src/api/rest.ts` with:

```ts
export interface Channel {
  id: string;
  name: string;
  code: string;
  role?: string;
  can_stream?: boolean;
}

export interface Member {
  user_id: string;
  email: string;
  role: string;
  can_stream: boolean;
}

export class ApiClient {
  token: string | null = null;

  constructor(private base: string, private fetchImpl: typeof fetch = fetch) {
    this.token = localStorage.getItem('sl_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) localStorage.setItem('sl_token', token);
    else localStorage.removeItem('sl_token');
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async signup(email: string, password: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/signup`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) this.setToken(data.token);
    else throw new Error('signup failed');
  }

  async login(email: string, password: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/login`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) this.setToken(data.token);
    else throw new Error('login failed');
  }

  // --- channels ---
  async createChannel(name: string): Promise<Channel> {
    const res = await this.fetchImpl(`${this.base}/channels`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ name }),
    });
    return res.json();
  }
  async listChannels(): Promise<Channel[]> {
    const res = await this.fetchImpl(`${this.base}/channels`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }
  async getChannel(id: string): Promise<Channel> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }
  async renameChannel(id: string, name: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ name }) });
  }
  async deleteChannel(id: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}`, { method: 'DELETE', headers: this.headers(false) });
  }

  // --- members ---
  async listMembers(id: string): Promise<Member[]> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}/members`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }
  async removeMember(id: string, uid: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/members/${uid}`, { method: 'DELETE', headers: this.headers(false) });
  }
  async changeRole(id: string, uid: string, role: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/members/${uid}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ role }) });
  }
  async setStreaming(id: string, uid: string, allowed: boolean): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/members/${uid}/streaming`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify({ allowed }) });
  }
  async transferOwner(id: string, userId: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/transfer`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ user_id: userId }) });
  }

  // --- invites ---
  async createInvite(id: string): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}/invites`, { method: 'POST', headers: this.headers(), body: JSON.stringify({}) });
    return (await res.json()).code;
  }
  async addUser(id: string, email: string): Promise<Response> {
    return this.fetchImpl(`${this.base}/channels/${id}/add-user`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ email }) });
  }
  async previewInvite(code: string): Promise<{ channel_id: string; name: string } | null> {
    const res = await this.fetchImpl(`${this.base}/invites/${code}`, { method: 'GET', headers: this.headers(false) });
    return res.ok ? res.json() : null;
  }
  async acceptInvite(code: string): Promise<{ channel_id: string } | null> {
    const res = await this.fetchImpl(`${this.base}/invites/${code}/accept`, { method: 'POST', headers: this.headers(false) });
    return res.ok ? res.json() : null;
  }

  // --- stream / turn ---
  async streamStatus(id: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.base}/channels/${id}/stream`, { method: 'GET', headers: this.headers(false) });
    return res.ok ? (await res.json()).live === true : false;
  }
  async stopStream(id: string): Promise<void> {
    await this.fetchImpl(`${this.base}/channels/${id}/stream/stop`, { method: 'POST', headers: this.headers(false) });
  }
  async turnCredentials(): Promise<RTCIceServer[]> {
    const res = await this.fetchImpl(`${this.base}/turn-credentials`, { method: 'POST', headers: this.headers(false) });
    return res.ok ? res.json() : [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/api/__tests__/rest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /data/data/com.termux/files/home/opencode-projects/stream_lover
git add web/src/api
git commit -m "feat(web): REST client for channels/members/invites/stream (replaces rooms)"
```

---

## Task 2: Fix ad-hoc Sender/Receiver against the `/channels` server

The ad-hoc 2-peer flow used `POST /rooms` (gone). The 2-peer `/ws` room is created on demand, so generate the code client-side and drop the dead calls.

**Files:**
- Modify: `web/src/ui/screens/Sender.tsx`, `web/src/ui/screens/Receiver.tsx`, `web/src/ui/__tests__/flow.test.tsx`

- [ ] **Step 1: Update the Sender to generate a local ad-hoc code**

In `web/src/ui/screens/Sender.tsx`, replace the `createSession` body's room-creation with a locally-generated code and remove the `ApiClient` import/usage:

```tsx
  function makeCode(): string {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('');
  }

  async function createSession() {
    try {
      const captured = await capture();
      setStream(captured);
      const c = makeCode();
      setCode(c);
      setRoom(c);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start capture (permission denied?).');
    }
  }
```
Remove the now-unused `import { ApiClient } from '../../api/rest';` line.

- [ ] **Step 2: Update the Receiver to join directly (drop resolveRoom)**

In `web/src/ui/screens/Receiver.tsx`, replace `join()` with:

```tsx
  function join() {
    if (input.trim().length < 4) { setError('Enter a valid code.'); return; }
    setError('');
    setRoom(input.trim());
  }
```
Remove the now-unused `import { ApiClient } from '../../api/rest';` and the `SERVER` const if it becomes unused (keep `WS`).

- [ ] **Step 3: Run the existing smoke tests**

Run: `cd web && npx vitest run src/ui/__tests__/flow.test.tsx`
Expected: PASS — Home + Sender source/mode pickers still render (these don't call REST).

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc -b`
Expected: clean (no unused-import errors).

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/screens/Sender.tsx web/src/ui/screens/Receiver.tsx
git commit -m "fix(web): ad-hoc 2-peer flow uses client-generated code (no /rooms)"
```

---

## Task 3: Broadcast protocol types

**Files:**
- Create: `web/src/core/broadcast-protocol.ts`, `web/src/core/__tests__/broadcast-protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/broadcast-protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeBroadcastMsg, parseBroadcastServerMsg } from '../broadcast-protocol';

describe('broadcast-protocol', () => {
  it('serializes a broadcaster join', () => {
    const j = serializeBroadcastMsg({ type: 'join-broadcast', code: 'C', role: 'broadcaster', jwt: 'T' });
    expect(JSON.parse(j)).toEqual({ type: 'join-broadcast', code: 'C', role: 'broadcaster', jwt: 'T' });
  });

  it('serializes an offer with peer_id', () => {
    const o = serializeBroadcastMsg({ type: 'offer', peer_id: 'v1', sdp: 'S' });
    expect(JSON.parse(o)).toEqual({ type: 'offer', peer_id: 'v1', sdp: 'S' });
  });

  it('parses viewer-joined', () => {
    expect(parseBroadcastServerMsg('{"type":"viewer-joined","peer_id":"v1"}'))
      .toEqual({ type: 'viewer-joined', peer_id: 'v1' });
  });

  it('parses broadcaster-left and returns null for garbage', () => {
    expect(parseBroadcastServerMsg('{"type":"broadcaster-left"}')).toEqual({ type: 'broadcaster-left' });
    expect(parseBroadcastServerMsg('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/broadcast-protocol.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/broadcast-protocol.ts`**

```ts
export type BroadcastRole = 'broadcaster' | 'viewer';

export type BroadcastClientMsg =
  | { type: 'join-broadcast'; code: string; role: BroadcastRole; jwt: string }
  | { type: 'offer'; peer_id: string; sdp: string }
  | { type: 'answer'; peer_id: string; sdp: string }
  | { type: 'ice'; peer_id: string; candidate: RTCIceCandidateInit };

export type BroadcastServerMsg =
  | { type: 'broadcast-joined'; live: boolean; viewers: string[] }
  | { type: 'viewer-joined'; peer_id: string }
  | { type: 'viewer-left'; peer_id: string }
  | { type: 'broadcaster-left' }
  | { type: 'force-stopped'; by: string }
  | { type: 'offer'; peer_id: string; sdp: string }
  | { type: 'answer'; peer_id: string; sdp: string }
  | { type: 'ice'; peer_id: string; candidate: RTCIceCandidateInit }
  | { type: 'error'; code: string; message: string };

export function serializeBroadcastMsg(msg: BroadcastClientMsg): string {
  return JSON.stringify(msg);
}

export function parseBroadcastServerMsg(raw: string): BroadcastServerMsg | null {
  try {
    return JSON.parse(raw) as BroadcastServerMsg;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/broadcast-protocol.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/broadcast-protocol.ts web/src/core/__tests__/broadcast-protocol.test.ts
git commit -m "feat(web): broadcast protocol types"
```

---

## Task 4: BroadcastViewer

**Files:**
- Create: `web/src/core/broadcast-session.ts`, `web/src/core/__tests__/broadcast-viewer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/broadcast-viewer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { BroadcastViewer } from '../broadcast-session';
import type { ISocket } from '../signaling-client';
import type { IPeer } from '../rtc-session';

class FakeSocket implements ISocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() {}
  open() { this.onopen?.(); }
  emit(m: string) { this.onmessage?.({ data: m }); }
}

function fakePeer(): IPeer {
  return {
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'O' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'ANSWER' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    getSenders: () => [], getReceivers: () => [],
    getStats: async () => new Map() as unknown as RTCStatsReport,
    connectionState: 'new',
    close: vi.fn(), onicecandidate: null, ontrack: null, onconnectionstatechange: null,
  };
}

describe('BroadcastViewer', () => {
  it('joins as viewer and answers the broadcaster offer', async () => {
    const socket = new FakeSocket();
    const viewer = new BroadcastViewer('ws://x', 'JWT', 'CODE', [], () => socket, () => fakePeer());
    viewer.start();
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'join-broadcast', code: 'CODE', role: 'viewer', jwt: 'JWT' });

    socket.emit('{"type":"broadcast-joined","live":true,"viewers":[]}');
    socket.emit('{"type":"offer","peer_id":"ignored","sdp":"REMOTE"}');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(socket.sent.some((f) => f.includes('"type":"answer"') && f.includes('ANSWER'))).toBe(true);
  });

  it('reports the stream ending', async () => {
    const socket = new FakeSocket();
    const viewer = new BroadcastViewer('ws://x', 'JWT', 'CODE', [], () => socket, () => fakePeer());
    let ended = false;
    viewer.onEnded(() => { ended = true; });
    viewer.start();
    socket.open();
    socket.emit('{"type":"broadcaster-left"}');
    expect(ended).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/broadcast-viewer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/broadcast-session.ts` (viewer half; the sender is appended in Task 5)**

```ts
import type { ISocket, SocketFactory } from './signaling-client';
import type { IPeer, PeerFactory } from './rtc-session';
import {
  type BroadcastServerMsg,
  parseBroadcastServerMsg,
  serializeBroadcastMsg,
} from './broadcast-protocol';
import { detectTransport } from './transport';
import type { Transport } from './connection-machine';

const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as ISocket;
const defaultPeerFactory: PeerFactory = (iceServers) =>
  new RTCPeerConnection({ iceServers }) as unknown as IPeer;

/** A single viewer connection to the broadcaster. */
export class BroadcastViewer {
  private socket: ISocket | null = null;
  private peer: IPeer | null = null;
  private remoteHandler: ((s: MediaStream) => void) | null = null;
  private endedHandler: (() => void) | null = null;
  private transportHandler: ((t: Transport) => void) | null = null;

  constructor(
    private url: string,
    private jwt: string,
    private code: string,
    private iceServers: RTCIceServer[],
    private socketFactory: SocketFactory = defaultSocketFactory,
    private peerFactory: PeerFactory = defaultPeerFactory,
  ) {}

  onRemoteStream(h: (s: MediaStream) => void) { this.remoteHandler = h; }
  onEnded(h: () => void) { this.endedHandler = h; }
  onTransport(h: (t: Transport) => void) { this.transportHandler = h; }

  start() {
    const socket = this.socketFactory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(serializeBroadcastMsg({ type: 'join-broadcast', code: this.code, role: 'viewer', jwt: this.jwt }));
    };
    socket.onmessage = (ev) => {
      const msg = parseBroadcastServerMsg(ev.data);
      if (msg) void this.onServer(msg);
    };
  }

  private ensurePeer(): IPeer {
    if (this.peer) return this.peer;
    const peer = this.peerFactory(this.iceServers);
    this.peer = peer;
    peer.onicecandidate = (e) => {
      if (e.candidate) this.socket?.send(serializeBroadcastMsg({ type: 'ice', peer_id: '', candidate: e.candidate }));
    };
    peer.ontrack = (e) => { if (e.streams[0]) this.remoteHandler?.(e.streams[0]); };
    peer.onconnectionstatechange = () => { void this.onConn(); };
    return peer;
  }

  private async onConn() {
    if (this.peer && this.peer.connectionState === 'connected') {
      this.transportHandler?.(await detectTransport(this.peer));
    }
  }

  private async onServer(msg: BroadcastServerMsg) {
    switch (msg.type) {
      case 'offer': {
        const peer = this.ensurePeer();
        await peer.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.socket?.send(serializeBroadcastMsg({ type: 'answer', peer_id: '', sdp: answer.sdp ?? '' }));
        break;
      }
      case 'ice':
        await this.ensurePeer().addIceCandidate(msg.candidate);
        break;
      case 'broadcaster-left':
      case 'force-stopped':
        this.endedHandler?.();
        this.close();
        break;
      default:
        break;
    }
  }

  close() {
    this.peer?.close();
    this.peer = null;
    this.socket?.close();
    this.socket = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/broadcast-viewer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/broadcast-session.ts web/src/core/__tests__/broadcast-viewer.test.ts
git commit -m "feat(web): BroadcastViewer (single connection to broadcaster)"
```

---

## Task 5: BroadcastSender (sender-side fan-out)

**Files:**
- Modify: `web/src/core/broadcast-session.ts`
- Create: `web/src/core/__tests__/broadcast-sender.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/broadcast-sender.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { BroadcastSender } from '../broadcast-session';
import type { ISocket } from '../signaling-client';
import type { IPeer } from '../rtc-session';

class FakeSocket implements ISocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() {}
  open() { this.onopen?.(); }
  emit(m: string) { this.onmessage?.({ data: m }); }
}

function fakePeer(): IPeer {
  return {
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'A' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    getSenders: () => [], getReceivers: () => [],
    getStats: async () => new Map() as unknown as RTCStatsReport,
    connectionState: 'new',
    close: vi.fn(), onicecandidate: null, ontrack: null, onconnectionstatechange: null,
  };
}

const fakeStream = { getTracks: () => [] } as unknown as MediaStream;

describe('BroadcastSender', () => {
  it('joins as broadcaster and offers to each viewer who joins', async () => {
    const socket = new FakeSocket();
    const peers: IPeer[] = [];
    const sender = new BroadcastSender('ws://x', 'JWT', 'CODE', 'realtime', fakeStream, [],
      () => socket, () => { const p = fakePeer(); peers.push(p); return p; });
    sender.start();
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'join-broadcast', code: 'CODE', role: 'broadcaster', jwt: 'JWT' });

    socket.emit('{"type":"broadcast-joined","live":true,"viewers":[]}');
    socket.emit('{"type":"viewer-joined","peer_id":"v1"}');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(peers.length).toBe(1);
    expect(socket.sent.some((f) => f.includes('"type":"offer"') && f.includes('"peer_id":"v1"'))).toBe(true);
  });

  it('tracks viewer count and closes a connection when a viewer leaves', async () => {
    const socket = new FakeSocket();
    const sender = new BroadcastSender('ws://x', 'JWT', 'CODE', 'realtime', fakeStream, [],
      () => socket, () => fakePeer());
    const counts: number[] = [];
    sender.onViewerCount((n) => counts.push(n));
    sender.start();
    socket.open();
    socket.emit('{"type":"viewer-joined","peer_id":"v1"}');
    await Promise.resolve(); await Promise.resolve();
    socket.emit('{"type":"viewer-left","peer_id":"v1"}');
    await Promise.resolve();
    expect(counts[counts.length - 1]).toBe(0);
  });

  it('reports being force-stopped', async () => {
    const socket = new FakeSocket();
    const sender = new BroadcastSender('ws://x', 'JWT', 'CODE', 'realtime', fakeStream, [],
      () => socket, () => fakePeer());
    let stopped = false;
    sender.onStopped(() => { stopped = true; });
    sender.start();
    socket.open();
    socket.emit('{"type":"force-stopped","by":"owner"}');
    expect(stopped).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/broadcast-sender.test.ts`
Expected: FAIL — `BroadcastSender` not exported.

- [ ] **Step 3: Append `BroadcastSender` to `web/src/core/broadcast-session.ts`**

```ts
import type { Mode } from './protocol';
import { applyMode } from './modes';

interface ViewerConn {
  peer: IPeer;
}

/** Broadcaster: one captured stream fanned out to N viewers (one peer each). */
export class BroadcastSender {
  private socket: ISocket | null = null;
  private viewers = new Map<string, ViewerConn>();
  private countHandler: ((n: number) => void) | null = null;
  private stoppedHandler: (() => void) | null = null;

  constructor(
    private url: string,
    private jwt: string,
    private code: string,
    private mode: Mode,
    private localStream: MediaStream,
    private iceServers: RTCIceServer[],
    private socketFactory: SocketFactory = defaultSocketFactory,
    private peerFactory: PeerFactory = defaultPeerFactory,
  ) {}

  onViewerCount(h: (n: number) => void) { this.countHandler = h; }
  onStopped(h: () => void) { this.stoppedHandler = h; }

  start() {
    const socket = this.socketFactory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(serializeBroadcastMsg({ type: 'join-broadcast', code: this.code, role: 'broadcaster', jwt: this.jwt }));
    };
    socket.onmessage = (ev) => {
      const msg = parseBroadcastServerMsg(ev.data);
      if (msg) void this.onServer(msg);
    };
  }

  private async addViewer(peerId: string) {
    const peer = this.peerFactory(this.iceServers);
    peer.onicecandidate = (e) => {
      if (e.candidate) this.socket?.send(serializeBroadcastMsg({ type: 'ice', peer_id: peerId, candidate: e.candidate }));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') void applyMode(peer, this.mode);
    };
    for (const track of this.localStream.getTracks()) peer.addTrack(track, this.localStream);
    this.viewers.set(peerId, { peer });
    this.countHandler?.(this.viewers.size);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.socket?.send(serializeBroadcastMsg({ type: 'offer', peer_id: peerId, sdp: offer.sdp ?? '' }));
  }

  private removeViewer(peerId: string) {
    const v = this.viewers.get(peerId);
    if (v) { v.peer.close(); this.viewers.delete(peerId); this.countHandler?.(this.viewers.size); }
  }

  private async onServer(msg: BroadcastServerMsg) {
    switch (msg.type) {
      case 'viewer-joined': await this.addViewer(msg.peer_id); break;
      case 'viewer-left': this.removeViewer(msg.peer_id); break;
      case 'answer': {
        const v = this.viewers.get(msg.peer_id);
        if (v) await v.peer.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        break;
      }
      case 'ice': {
        const v = this.viewers.get(msg.peer_id);
        if (v) await v.peer.addIceCandidate(msg.candidate);
        break;
      }
      case 'force-stopped':
        this.stoppedHandler?.();
        this.close();
        break;
      default:
        break;
    }
  }

  close() {
    for (const v of this.viewers.values()) v.peer.close();
    this.viewers.clear();
    this.socket?.close();
    this.socket = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/broadcast-sender.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole core suite**

Run: `cd web && npx vitest run src/core src/api`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/broadcast-session.ts web/src/core/__tests__/broadcast-sender.test.ts
git commit -m "feat(web): BroadcastSender with sender-side fan-out"
```

---

## Task 6: Channels list screen (replaces MyRooms)

**Files:**
- Create: `web/src/ui/screens/Channels.tsx`
- Delete: `web/src/ui/screens/MyRooms.tsx`
- Modify: `web/src/ui/App.tsx`, `web/src/ui/screens/Home.tsx`, `web/src/ui/__tests__/flow.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Add to `web/src/ui/__tests__/flow.test.tsx`:

```tsx
  it('channels screen shows a create form', () => {
    render(<MemoryRouter initialEntries={['/channels']}><App /></MemoryRouter>);
    expect(screen.getByLabelText(/channel name/i)).toBeInTheDocument();
    expect(screen.getByText(/Create/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/ui/__tests__/flow.test.tsx`
Expected: FAIL — `/channels` route not defined.

- [ ] **Step 3: Create `web/src/ui/screens/Channels.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient, type Channel } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState('');
  const api = new ApiClient(SERVER);

  async function refresh() {
    if (!api.token) return;
    setChannels(await api.listChannels());
  }
  useEffect(() => { void refresh(); }, []);

  async function create() {
    if (!name) return;
    await api.createChannel(name);
    setName('');
    await refresh();
  }

  return (
    <main>
      <h2>Channels</h2>
      <input aria-label="channel name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New channel name" />
      <button onClick={create}>Create</button>
      <ul>
        {channels.map((c) => (
          <li key={c.id}>
            <Link to={`/channels/${c.id}`}>{c.name}</Link> — <small>{c.role}</small>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Delete MyRooms and wire routing**

Delete `web/src/ui/screens/MyRooms.tsx`. In `web/src/ui/App.tsx`, remove the `MyRooms` import + its `/rooms` route, and add:
```tsx
import Channels from './screens/Channels';
// ...
        <Route path="/channels" element={<Channels />} />
```
In `web/src/ui/screens/Home.tsx`, change the `/rooms`/"My rooms" link (if present) to `<Link to="/channels">Channels</Link>`.

- [ ] **Step 5: Run smoke test + typecheck**

Run: `cd web && npx vitest run src/ui/__tests__/flow.test.tsx && npx tsc -b`
Expected: PASS + clean (no dangling MyRooms import).

- [ ] **Step 6: Commit**

```bash
git add web/src/ui
git commit -m "feat(web): Channels list screen (replaces My rooms)"
```

---

## Task 7: Channel detail (roster + role-gated actions + invite + live banner)

**Files:**
- Create: `web/src/ui/screens/ChannelDetail.tsx`
- Modify: `web/src/ui/App.tsx`, `web/src/ui/__tests__/flow.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Add to `web/src/ui/__tests__/flow.test.tsx` (mock fetch so the screen renders deterministically):

```tsx
  it('channel detail renders members and the go-live action for a member', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = u.endsWith('/members')
        ? [{ user_id: 'u1', email: 'me@b.com', role: 'owner', can_stream: true }]
        : u.includes('/stream') ? { live: false }
        : { id: 'c1', name: 'Movie', code: 'X', role: 'owner', can_stream: true };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch;
    localStorage.setItem('sl_token', 'JWT');
    render(<MemoryRouter initialEntries={['/channels/c1']}><App /></MemoryRouter>);
    expect(await screen.findByText(/Movie/)).toBeInTheDocument();
    expect(await screen.findByText(/Go live/i)).toBeInTheDocument();
    globalThis.fetch = orig;
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/ui/__tests__/flow.test.tsx`
Expected: FAIL — `/channels/:id` route not defined.

- [ ] **Step 3: Create `web/src/ui/screens/ChannelDetail.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiClient, type Channel, type Member } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function ChannelDetail() {
  const { id = '' } = useParams();
  const api = new ApiClient(SERVER);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [live, setLive] = useState(false);
  const [invite, setInvite] = useState('');

  async function refresh() {
    setChannel(await api.getChannel(id));
    setMembers(await api.listMembers(id));
    setLive(await api.streamStatus(id));
  }
  useEffect(() => { void refresh(); }, [id]);

  const myRole = channel?.role ?? 'member';
  const canModerate = myRole === 'owner' || myRole === 'admin';

  async function makeInvite() { setInvite(await api.createInvite(id)); }

  if (!channel) return <main><p>Loading…</p></main>;
  return (
    <main>
      <h2>{channel.name}</h2>
      <p>your role: {myRole}</p>

      {live
        ? <p>● Live now — <Link to={`/watch/${channel.code}`}>Watch</Link>
            {canModerate && <button onClick={() => api.stopStream(id).then(refresh)}>Stop stream</button>}</p>
        : <p><Link to={`/golive/${channel.code}`}>Go live</Link></p>}

      {canModerate && <p><button onClick={makeInvite}>Create invite link</button>
        {invite && <code>{`${location.origin}/invite/${invite}`}</code>}</p>}

      <h3>Members ({members.length})</h3>
      <ul>
        {members.map((m) => (
          <li key={m.user_id}>
            {m.email} — {m.role}{!m.can_stream && ' (blocked)'}
            {canModerate && m.role !== 'owner' && (
              <>
                <button onClick={() => api.removeMember(id, m.user_id).then(refresh)}>kick</button>
                <button onClick={() => api.setStreaming(id, m.user_id, m.can_stream === false).then(refresh)}>
                  {m.can_stream === false ? 'unblock' : 'block'} streaming
                </button>
                {myRole === 'owner' && (
                  <button onClick={() => api.changeRole(id, m.user_id, m.role === 'admin' ? 'member' : 'admin').then(refresh)}>
                    {m.role === 'admin' ? 'demote' : 'promote'}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Wire route in `App.tsx`**

```tsx
import ChannelDetail from './screens/ChannelDetail';
// ...
        <Route path="/channels/:id" element={<ChannelDetail />} />
```

- [ ] **Step 5: Run smoke test + typecheck**

Run: `cd web && npx vitest run src/ui/__tests__/flow.test.tsx && npx tsc -b`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/ui
git commit -m "feat(web): channel detail with roster, role-gated moderation, invite, live banner"
```

---

## Task 8: GoLive, Watch, and InviteAccept screens

**Files:**
- Create: `web/src/ui/screens/GoLive.tsx`, `web/src/ui/screens/Watch.tsx`, `web/src/ui/screens/InviteAccept.tsx`
- Modify: `web/src/ui/App.tsx`, `web/src/ui/__tests__/flow.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Add to `web/src/ui/__tests__/flow.test.tsx`:

```tsx
  it('go-live screen shows source and mode pickers', () => {
    localStorage.setItem('sl_token', 'JWT');
    render(<MemoryRouter initialEntries={['/golive/CODE']}><App /></MemoryRouter>);
    expect(screen.getByLabelText(/Screen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Real-time/i)).toBeInTheDocument();
  });

  it('watch screen renders a video element', () => {
    localStorage.setItem('sl_token', 'JWT');
    const { container } = render(<MemoryRouter initialEntries={['/watch/CODE']}><App /></MemoryRouter>);
    expect(container.querySelector('video')).not.toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/ui/__tests__/flow.test.tsx`
Expected: FAIL — routes not defined.

- [ ] **Step 3: Create `web/src/ui/screens/GoLive.tsx`**

```tsx
import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera, captureFile } from '../../core/sources';
import { BroadcastSender } from '../../core/broadcast-session';
import { ApiClient } from '../../api/rest';

type SourceKind = 'screen' | 'camera' | 'file';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

export default function GoLive() {
  const { code = '' } = useParams();
  const [source, setSource] = useState<SourceKind>('screen');
  const [mode, setMode] = useState<Mode>('realtime');
  const [file, setFile] = useState<File | null>(null);
  const [viewers, setViewers] = useState(0);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const fileVideoRef = useRef<HTMLVideoElement>(null);
  const senderRef = useRef<BroadcastSender | null>(null);
  const api = new ApiClient(SERVER);

  async function capture(): Promise<MediaStream> {
    if (source === 'camera') return captureCamera();
    if (source === 'file') {
      if (!file || !fileVideoRef.current) throw new Error('Choose a file first.');
      return captureFile(file, fileVideoRef.current as HTMLVideoElement & { captureStream?: () => MediaStream });
    }
    return captureScreen();
  }

  async function start() {
    try {
      const stream = await capture();
      const ice = await api.turnCredentials();
      const sender = new BroadcastSender(WS, api.token ?? '', code, mode, stream, ice);
      sender.onViewerCount(setViewers);
      sender.onStopped(() => { setLive(false); setError('Stream was stopped.'); });
      sender.start();
      senderRef.current = sender;
      setLive(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start.');
    }
  }

  return (
    <main>
      <h2>Go live</h2>
      <fieldset>
        <legend>Source</legend>
        <label><input type="radio" name="src" checked={source === 'screen'} onChange={() => setSource('screen')} /> Screen</label>
        <label><input type="radio" name="src" checked={source === 'camera'} onChange={() => setSource('camera')} /> Camera</label>
        <label><input type="radio" name="src" checked={source === 'file'} onChange={() => setSource('file')} /> File</label>
      </fieldset>
      {source === 'file' && <input type="file" accept="video/*,audio/*" aria-label="media file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
      <fieldset>
        <legend>Mode</legend>
        <label><input type="radio" name="mode" checked={mode === 'realtime'} onChange={() => setMode('realtime')} /> Real-time</label>
        <label><input type="radio" name="mode" checked={mode === 'quality'} onChange={() => setMode('quality')} /> High quality</label>
      </fieldset>
      {!live ? <button onClick={start}>Go live</button>
             : <p>● Live · {viewers} watching <button onClick={() => { senderRef.current?.close(); setLive(false); }}>Stop</button></p>}
      {error && <p role="alert">{error}</p>}
      <video ref={fileVideoRef} muted playsInline style={{ display: source === 'file' ? 'block' : 'none', width: '100%' }} />
    </main>
  );
}
```

- [ ] **Step 4: Create `web/src/ui/screens/Watch.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BroadcastViewer } from '../../core/broadcast-session';
import type { Transport } from '../../core/connection-machine';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws/broadcast';

export default function Watch() {
  const { code = '' } = useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [transport, setTransport] = useState<Transport>('unknown');
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    let viewer: BroadcastViewer | null = null;
    (async () => {
      const api = new ApiClient(SERVER);
      const ice = await api.turnCredentials();
      viewer = new BroadcastViewer(WS, api.token ?? '', code, ice);
      viewer.onRemoteStream((s) => { if (videoRef.current) { videoRef.current.srcObject = s; setStatus('connected'); } });
      viewer.onTransport(setTransport);
      viewer.onEnded(() => setStatus('stream ended'));
      viewer.start();
    })();
    return () => viewer?.close();
  }, [code]);

  return (
    <main>
      <h2>Watching</h2>
      <p>{status}{transport !== 'unknown' ? ` · ${transport}` : ''}</p>
      <video ref={videoRef} autoPlay playsInline controls style={{ width: '100%' }} />
    </main>
  );
}
```

- [ ] **Step 5: Create `web/src/ui/screens/InviteAccept.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function InviteAccept() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const api = new ApiClient(SERVER);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const preview = await api.previewInvite(code);
      if (preview) setName(preview.name);
      else setError('This invite is no longer valid.');
    })();
  }, [code]);

  async function join() {
    const res = await api.acceptInvite(code);
    if (res) nav(`/channels/${res.channel_id}`);
    else setError('This invite is no longer valid.');
  }

  return (
    <main>
      <h2>Join channel</h2>
      {error && <p role="alert">{error}</p>}
      {name && <><p>Join <strong>{name}</strong>?</p><button onClick={join}>Join</button></>}
    </main>
  );
}
```

- [ ] **Step 6: Wire routes in `App.tsx`**

```tsx
import GoLive from './screens/GoLive';
import Watch from './screens/Watch';
import InviteAccept from './screens/InviteAccept';
// ...
        <Route path="/golive/:code" element={<GoLive />} />
        <Route path="/watch/:code" element={<Watch />} />
        <Route path="/invite/:code" element={<InviteAccept />} />
```

- [ ] **Step 7: Run the full web suite + build**

Run: `cd web && npx vitest run && npm run build`
Expected: all tests PASS; `tsc -b` + Vite build clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/ui
git commit -m "feat(web): GoLive, Watch, and InviteAccept screens (channel broadcast)"
```

---

## Task 9: Docs + changelog

**Files:**
- Modify: `web/README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update `web/README.md`**

Add a section after the architecture notes:

```markdown
## Channels & broadcast
- `core/broadcast-protocol.ts` + `core/broadcast-session.ts` (`BroadcastSender` fan-out,
  `BroadcastViewer`) implement 1→N broadcast over `/ws/broadcast`.
- Screens: `Channels` (list), `ChannelDetail` (roster + role-gated moderation + invite +
  live banner), `GoLive` (broadcaster), `Watch` (viewer), `InviteAccept`.
- ICE servers for broadcast are fetched via `POST /turn-credentials`.

### Manual test
1. Two logged-in accounts. A creates a channel, makes an invite link, B opens `/invite/<code>` and joins.
2. A opens the channel → Go live (screen/camera/file). B (and more tabs) open the channel → Watch.
   Confirm all viewers see A's stream and the viewer count rises (sender-side fan-out).
3. Owner/admin: kick, block-streaming, promote/demote, Stop stream. Confirm a blocked member can't go live.
```

- [ ] **Step 2: Update `CHANGELOG.md`**

Add at the top:

```markdown
## [0.4.0] - 2026-06-04
### Added
- Web client: Channels surface (list, detail with role-gated moderation, invites), replacing "My rooms".
- Web client: 1→N broadcast — `BroadcastSender` (sender-side fan-out) + `BroadcastViewer` over
  `/ws/broadcast`, with GoLive/Watch/InviteAccept screens and direct/relay status.
### Changed
- Web REST client targets `/channels*` (the `/rooms*` endpoints were removed server-side); the
  ad-hoc 2-peer flow now uses a client-generated code.
```

- [ ] **Step 3: Commit**

```bash
git add web/README.md CHANGELOG.md
git commit -m "docs: web channels + broadcast README and changelog"
```

---

## Definition of Done
- `cd web && npx vitest run` passes (broadcast-protocol, broadcast-viewer, broadcast-sender, rest, plus existing core + UI smoke tests).
- `cd web && npm run build` clean.
- `/channels` replaces `/rooms` in the client; no calls to removed `/rooms*` endpoints remain.
- Broadcast: one broadcaster fans out to N viewers, viewer count updates, force-stop/leave handled.

## Notes for the implementer
- **Reuse, don't duplicate:** `BroadcastViewer`/`BroadcastSender` reuse `ISocket`/`SocketFactory` (signaling-client.ts), `IPeer`/`PeerFactory` (rtc-session.ts), `applyMode` (modes.ts), `detectTransport` (transport.ts).
- **Viewer answer/ice carry `peer_id:''`** — the server ignores the client-supplied peer_id for viewers and tags by its server-assigned id. Don't try to send a real one.
- **ICE servers**: broadcast `broadcast-joined` does NOT include them; always fetch via `api.turnCredentials()` before constructing a sender/viewer.
- **Env:** Node 26 + vitest need the localStorage shim already in `src/test-setup.ts`. `grep` is broken on this box (use awk); never commit `node_modules`.
- **Owner delete/transfer UI (small gap to close):** `rest.ts` has `deleteChannel` and `transferOwner`, but `ChannelDetail` only wires moderation/invite. Add an owner-only "Delete channel" button (`api.deleteChannel(id)` → navigate to `/channels`) in Task 7, and a transfer control (a member-select calling `api.transferOwner`) — transfer can be a quick follow-up since it needs a picker. Spec §7 lists both as owner actions.
- **YAGNI:** no presence/chat (Phase 2b), no multi-broadcaster, no native code.
```
