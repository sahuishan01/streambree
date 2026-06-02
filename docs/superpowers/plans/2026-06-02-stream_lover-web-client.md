# stream_lover Web Client + Saved Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the stream_lover web client (React + TS + Vite) that streams screen/camera/file peer-to-peer over WebRTC via the existing signaling server, plus a small server delta adding persistent personal "saved rooms".

**Architecture:** A framework-agnostic, unit-tested TypeScript core (`signaling-client`, `rtc-session`, `connection-machine`, `modes`, `sources`) wraps the WebSocket protocol and `RTCPeerConnection`; a thin React UI sits on top. The server gains a persistent `rooms` table and CRUD/resolve endpoints. Dependency injection (socket factory, peer-connection factory) keeps the core testable without a real browser.

**Tech Stack:** Rust/Axum/sqlx (server delta), TypeScript, React 18, Vite, Vitest, jsdom, React Testing Library.

---

## File Structure

```
server/crates/store/
├── migrations/0002_rooms.sql        # NEW persistent rooms table
└── src/lib.rs                        # + Room model, room CRUD methods

server/crates/api/src/
└── handlers.rs                       # + create/list/delete/resolve room handlers
└── lib.rs                            # + routes

web/                                  # NEW web client
├── package.json, tsconfig.json, vite.config.ts, index.html
├── src/
│   ├── core/
│   │   ├── protocol.ts               # ClientMsg/ServerMsg types
│   │   ├── connection-machine.ts     # pure lifecycle reducer
│   │   ├── signaling-client.ts       # WebSocket wrapper (injected socket factory)
│   │   ├── rtc-session.ts            # RTCPeerConnection wrapper (injected pc factory)
│   │   ├── modes.ts                  # realtime|quality params
│   │   └── sources.ts                # capture screen/camera/file
│   ├── api/rest.ts                   # REST client
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── hooks/useSession.ts
│   │   └── screens/{Home,Sender,Receiver,Auth,MyRooms}.tsx
│   └── main.tsx
└── src/**/__tests__/*.test.ts        # vitest specs
```

The server delta reuses existing patterns in `store`/`api`. The web core never imports React; the UI never touches `RTCPeerConnection` directly.

---

# PART A — Server delta: saved rooms

## Task 1: Persistent rooms table + store methods

**Files:**
- Create: `server/crates/store/migrations/0002_rooms.sql`
- Modify: `server/crates/store/src/lib.rs`

- [ ] **Step 1: Write the migration**

Create `server/crates/store/migrations/0002_rooms.sql`:

```sql
CREATE TABLE rooms (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    code       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_rooms_owner ON rooms(owner_id);
```

- [ ] **Step 2: Write the failing test**

Add to the `tests` module in `server/crates/store/src/lib.rs` (inside `mod tests { ... }`):

```rust
    #[tokio::test]
    async fn create_list_resolve_and_delete_rooms() {
        let store = fresh().await;
        let user = store.create_user("a@b.com", "h").await.unwrap();

        let room = store.create_room(&user.id, "Movie Night", "ABC123").await.unwrap();
        assert_eq!(room.name, "Movie Night");
        assert_eq!(room.code, "ABC123");

        let rooms = store.rooms_for_user(&user.id).await.unwrap();
        assert_eq!(rooms.len(), 1);

        let resolved = store.room_by_code("ABC123").await.unwrap();
        assert!(resolved.is_some());
        assert!(store.room_by_code("NOPE99").await.unwrap().is_none());

        store.delete_room(&user.id, &room.id).await.unwrap();
        assert_eq!(store.rooms_for_user(&user.id).await.unwrap().len(), 0);
    }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && cargo test -p store create_list_resolve`
Expected: FAIL — `Room` / `create_room` not defined.

- [ ] **Step 4: Add the Room model and methods**

In `server/crates/store/src/lib.rs`, add the model after the `Device` struct:

```rust
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Room {
    pub id: String,
    pub owner_id: String,
    pub name: String,
    pub code: String,
    pub created_at: String,
}
```

Add these methods inside `impl Store { ... }` (after `devices_for_user`):

```rust
    pub async fn create_room(&self, owner_id: &str, name: &str, code: &str) -> Result<Room, StoreError> {
        let room = Room {
            id: Uuid::new_v4().to_string(),
            owner_id: owner_id.to_string(),
            name: name.to_string(),
            code: code.to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        sqlx::query("INSERT INTO rooms (id, owner_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&room.id)
            .bind(&room.owner_id)
            .bind(&room.name)
            .bind(&room.code)
            .bind(&room.created_at)
            .execute(&self.pool)
            .await?;
        Ok(room)
    }

    pub async fn rooms_for_user(&self, owner_id: &str) -> Result<Vec<Room>, StoreError> {
        let rooms = sqlx::query_as::<_, Room>("SELECT * FROM rooms WHERE owner_id = ? ORDER BY created_at DESC")
            .bind(owner_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rooms)
    }

    pub async fn room_by_code(&self, code: &str) -> Result<Option<Room>, StoreError> {
        let room = sqlx::query_as::<_, Room>("SELECT * FROM rooms WHERE code = ?")
            .bind(code)
            .fetch_optional(&self.pool)
            .await?;
        Ok(room)
    }

    pub async fn delete_room(&self, owner_id: &str, room_id: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM rooms WHERE id = ? AND owner_id = ?")
            .bind(room_id)
            .bind(owner_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && cargo test -p store`
Expected: PASS (4 tests — the original 3 plus the new one).

- [ ] **Step 6: Commit**

```bash
git add server/crates/store
git commit -m "feat(store): persistent rooms table and CRUD"
```

---

## Task 2: Saved-room REST endpoints

`POST /rooms` becomes auth-aware: with a valid JWT + `{name}` it creates a persistent room; without auth it returns a one-off ephemeral code (preserving guest behaviour). Adds `GET /rooms`, `DELETE /rooms/{id}`, `GET /rooms/resolve/{code}`.

**Files:**
- Modify: `server/crates/api/src/handlers.rs`
- Modify: `server/crates/api/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `server/crates/api/src/handlers.rs`:

```rust
    async fn token_for(app: &axum::Router, email: &str) -> String {
        let res = app
            .clone()
            .oneshot(
                Request::post("/signup")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"email":"{email}","password":"pw123456"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        v["token"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn create_named_room_then_list_and_resolve() {
        let app = crate::router(test_state().await);
        let token = token_for(&app, "host@b.com").await;

        // create named, persistent room
        let res = app
            .clone()
            .oneshot(
                Request::post("/rooms")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(r#"{"name":"Movie Night"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let room: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let code = room["code"].as_str().unwrap().to_string();
        assert_eq!(room["name"], "Movie Night");

        // list my rooms
        let list = app
            .clone()
            .oneshot(
                Request::get("/rooms")
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = list.into_body().collect().await.unwrap().to_bytes();
        let rooms: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(rooms.as_array().unwrap().len(), 1);

        // resolve the code (public)
        let resolve = app
            .clone()
            .oneshot(Request::get(format!("/rooms/resolve/{code}")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resolve.status(), StatusCode::OK);

        let missing = app
            .oneshot(Request::get("/rooms/resolve/NOPE99").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn guest_create_room_without_auth_returns_ephemeral_code() {
        let app = crate::router(test_state().await);
        let res = app
            .oneshot(
                Request::post("/rooms")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["code"].as_str().unwrap().len(), 6);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && cargo test -p api create_named_room`
Expected: FAIL — `/rooms` doesn't accept a body / new routes missing.

- [ ] **Step 3: Remove the now-obsolete test**

The old `create_room` returned a code for an empty body; the handler now requires a JSON
body, so the original test no longer applies (the new `guest_create_room_without_auth_returns_ephemeral_code`
replaces it). In `server/crates/api/src/handlers.rs`, delete the entire
`create_room_returns_a_code` test function from the `tests` module.

- [ ] **Step 4: Replace the `create_room` handler and add the new ones**

In `server/crates/api/src/handlers.rs`, remove the old `create_room` function and the `RoomResponse` struct, and add:

```rust
use axum::extract::Path;

#[derive(Deserialize, Default)]
pub struct NewRoom {
    pub name: Option<String>,
}

/// Optional auth: returns Some(user_id) if a valid bearer token is present, else None.
fn optional_user(state: &AppState, headers: &axum::http::HeaderMap) -> Option<String> {
    let header = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = header.strip_prefix("Bearer ")?;
    auth::verify_token(&state.jwt_secret, token).ok().map(|c| c.sub)
}

/// POST /rooms — authed + name => persistent saved room; otherwise ephemeral code.
pub async fn create_room(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<NewRoom>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let code = auth::generate_room_code();
    match (optional_user(&state, &headers), body.name) {
        (Some(user_id), Some(name)) if !name.is_empty() => {
            let room = state
                .store
                .create_room(&user_id, &name, &code)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(Json(serde_json::json!({
                "id": room.id, "name": room.name, "code": room.code
            })))
        }
        _ => Ok(Json(serde_json::json!({ "code": code }))),
    }
}

pub async fn list_rooms(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<store::Room>>, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    let rooms = state
        .store
        .rooms_for_user(&user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rooms))
}

pub async fn delete_room(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(room_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let user_id = require_user(&state, &headers)?;
    state
        .store
        .delete_room(&user_id, &room_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn resolve_room(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let room = state
        .store
        .room_by_code(&code)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(serde_json::json!({ "name": room.name, "code": room.code })))
}
```

- [ ] **Step 5: Wire the routes**

In `server/crates/api/src/lib.rs`, replace the `/rooms` route line with:

```rust
        .route("/rooms", post(handlers::create_room).get(handlers::list_rooms))
        .route("/rooms/:id", axum::routing::delete(handlers::delete_room))
        .route("/rooms/resolve/:code", get(handlers::resolve_room))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && cargo test -p api`
Expected: PASS (existing auth/device/turn tests + 2 new room tests; obsolete `create_room_returns_a_code` removed).

- [ ] **Step 7: Commit**

```bash
git add server/crates/api
git commit -m "feat(api): saved-room endpoints (create/list/delete/resolve)"
```

---

# PART B — Web client

## Task 3: Scaffold the web app

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/ui/App.tsx`, `web/.gitignore`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "stream_lover-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 4: Create `web/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 5: Create `web/index.html`, `web/src/main.tsx`, `web/src/ui/App.tsx`**

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>stream_lover</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/ui/App.tsx`:
```tsx
export default function App() {
  return <h1>stream_lover</h1>;
}
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Create `web/.gitignore`**

```
node_modules
dist
*.local
```

- [ ] **Step 7: Install and verify build + empty test run**

Run:
```bash
cd web && npm install && npm run build && npm test
```
Expected: build succeeds; `vitest` reports "no test files found" (exit 0) or runs 0 tests. If `npm` is unavailable in this environment, note it and continue — later tasks' tests are still authored and run where Node exists.

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "chore(web): scaffold Vite + React + TS app with vitest"
```

---

## Task 4: Protocol types

**Files:**
- Create: `web/src/core/protocol.ts`, `web/src/core/__tests__/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseServerMsg, serializeClientMsg } from '../protocol';

describe('protocol', () => {
  it('serializes a join message to the server wire format', () => {
    const json = serializeClientMsg({ type: 'join', room: 'R1', role: 'sender', mode: 'realtime' });
    expect(JSON.parse(json)).toEqual({ type: 'join', room: 'R1', role: 'sender', mode: 'realtime' });
  });

  it('parses a joined server message', () => {
    const msg = parseServerMsg('{"type":"joined","peer_present":true,"ice_servers":[]}');
    expect(msg).toEqual({ type: 'joined', peer_present: true, ice_servers: [] });
  });

  it('parses a kebab-case peer-left message', () => {
    expect(parseServerMsg('{"type":"peer-left"}')).toEqual({ type: 'peer-left' });
  });

  it('returns null for malformed JSON', () => {
    expect(parseServerMsg('not json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/protocol.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/protocol.ts`**

```ts
export type Role = 'sender' | 'receiver';
export type Mode = 'realtime' | 'quality';

export type ClientMsg =
  | { type: 'join'; room: string; role: Role; mode: Mode }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

export type ServerMsg =
  | { type: 'joined'; peer_present: boolean; ice_servers: RTCIceServer[] }
  | { type: 'peer-joined' }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'peer-left' }
  | { type: 'error'; code: string; message: string };

export function serializeClientMsg(msg: ClientMsg): string {
  return JSON.stringify(msg);
}

export function parseServerMsg(raw: string): ServerMsg | null {
  try {
    return JSON.parse(raw) as ServerMsg;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/protocol.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/protocol.ts web/src/core/__tests__/protocol.test.ts
git commit -m "feat(web): signaling protocol types"
```

---

## Task 5: Connection state machine (pure)

**Files:**
- Create: `web/src/core/connection-machine.ts`, `web/src/core/__tests__/connection-machine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/connection-machine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initial, reduce } from '../connection-machine';

describe('connection-machine', () => {
  it('goes idle -> joining -> waiting-for-peer when alone', () => {
    let s = reduce(initial, { type: 'join' });
    expect(s.conn).toBe('joining');
    s = reduce(s, { type: 'joined', peerPresent: false });
    expect(s.conn).toBe('waiting-for-peer');
  });

  it('negotiates immediately when a peer is already present', () => {
    let s = reduce(initial, { type: 'join' });
    s = reduce(s, { type: 'joined', peerPresent: true });
    expect(s.conn).toBe('negotiating');
  });

  it('reaches connected and records transport', () => {
    let s = reduce(initial, { type: 'join' });
    s = reduce(s, { type: 'joined', peerPresent: true });
    s = reduce(s, { type: 'connected', transport: 'relay' });
    expect(s.conn).toBe('connected');
    expect(s.transport).toBe('relay');
  });

  it('peer leaving returns to waiting and clears transport', () => {
    let s = { conn: 'connected', transport: 'direct' } as const;
    const next = reduce(s, { type: 'peer-left' });
    expect(next.conn).toBe('waiting-for-peer');
    expect(next.transport).toBe('unknown');
  });

  it('socket loss enters reconnecting; restore re-joins', () => {
    let s = reduce(initial, { type: 'join' });
    s = reduce(s, { type: 'socket-lost' });
    expect(s.conn).toBe('reconnecting');
    s = reduce(s, { type: 'socket-restored' });
    expect(s.conn).toBe('joining');
  });

  it('close is terminal from any state', () => {
    const s = reduce({ conn: 'connected', transport: 'direct' }, { type: 'close' });
    expect(s.conn).toBe('closed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/connection-machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/connection-machine.ts`**

```ts
export type ConnState =
  | 'idle'
  | 'joining'
  | 'waiting-for-peer'
  | 'negotiating'
  | 'connected'
  | 'reconnecting'
  | 'closed';

export type Transport = 'unknown' | 'direct' | 'relay';

export interface MachineState {
  conn: ConnState;
  transport: Transport;
}

export type MachineEvent =
  | { type: 'join' }
  | { type: 'joined'; peerPresent: boolean }
  | { type: 'peer-joined' }
  | { type: 'negotiation-started' }
  | { type: 'connected'; transport: Transport }
  | { type: 'peer-left' }
  | { type: 'socket-lost' }
  | { type: 'socket-restored' }
  | { type: 'close' };

export const initial: MachineState = { conn: 'idle', transport: 'unknown' };

export function reduce(state: MachineState, event: MachineEvent): MachineState {
  if (event.type === 'close') {
    return { conn: 'closed', transport: 'unknown' };
  }
  if (event.type === 'socket-lost') {
    return { ...state, conn: 'reconnecting' };
  }
  if (event.type === 'socket-restored') {
    return { ...state, conn: 'joining' };
  }

  switch (state.conn) {
    case 'idle':
      if (event.type === 'join') return { ...state, conn: 'joining' };
      return state;
    case 'joining':
      if (event.type === 'joined') {
        return { ...state, conn: event.peerPresent ? 'negotiating' : 'waiting-for-peer' };
      }
      return state;
    case 'waiting-for-peer':
      if (event.type === 'peer-joined') return { ...state, conn: 'negotiating' };
      return state;
    case 'negotiating':
      if (event.type === 'connected') return { conn: 'connected', transport: event.transport };
      return state;
    case 'connected':
      if (event.type === 'peer-left') return { conn: 'waiting-for-peer', transport: 'unknown' };
      return state;
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/connection-machine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/connection-machine.ts web/src/core/__tests__/connection-machine.test.ts
git commit -m "feat(web): pure connection lifecycle state machine"
```

---

## Task 6: Signaling client (injected socket)

**Files:**
- Create: `web/src/core/signaling-client.ts`, `web/src/core/__tests__/signaling-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/signaling-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SignalingClient, type ISocket } from '../signaling-client';
import type { ServerMsg } from '../protocol';

class FakeSocket implements ISocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }
  open() { this.onopen?.(); }
  emit(msg: string) { this.onmessage?.({ data: msg }); }
}

describe('SignalingClient', () => {
  it('sends a join frame once the socket opens', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    client.join('R1', 'sender', 'realtime');
    fake.open();
    expect(JSON.parse(fake.sent[0])).toEqual({
      type: 'join', room: 'R1', role: 'sender', mode: 'realtime',
    });
  });

  it('delivers parsed inbound messages to the handler', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    const received: ServerMsg[] = [];
    client.onMessage((m) => received.push(m));
    client.join('R1', 'receiver', 'quality');
    fake.open();
    fake.emit('{"type":"peer-joined"}');
    expect(received).toEqual([{ type: 'peer-joined' }]);
  });

  it('serializes outbound client messages', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    client.join('R1', 'sender', 'realtime');
    fake.open();
    client.send({ type: 'offer', sdp: 'SDP' });
    expect(JSON.parse(fake.sent[1])).toEqual({ type: 'offer', sdp: 'SDP' });
  });

  it('ignores malformed inbound frames without throwing', () => {
    const fake = new FakeSocket();
    const client = new SignalingClient('ws://x/ws', () => fake);
    const handler = vi.fn();
    client.onMessage(handler);
    client.join('R1', 'sender', 'realtime');
    fake.open();
    fake.emit('garbage');
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/signaling-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/signaling-client.ts`**

```ts
import { type ClientMsg, type Mode, type Role, type ServerMsg, parseServerMsg, serializeClientMsg } from './protocol';

export interface ISocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => ISocket;

const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as ISocket;

export class SignalingClient {
  private socket: ISocket | null = null;
  private handler: ((msg: ServerMsg) => void) | null = null;
  private pendingJoin: ClientMsg | null = null;

  constructor(private url: string, private factory: SocketFactory = defaultFactory) {}

  onMessage(handler: (msg: ServerMsg) => void) {
    this.handler = handler;
  }

  join(room: string, role: Role, mode: Mode) {
    this.pendingJoin = { type: 'join', room, role, mode };
    const socket = this.factory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.pendingJoin) socket.send(serializeClientMsg(this.pendingJoin));
    };
    socket.onmessage = (ev) => {
      const msg = parseServerMsg(ev.data);
      if (msg && this.handler) this.handler(msg);
    };
  }

  send(msg: ClientMsg) {
    this.socket?.send(serializeClientMsg(msg));
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/signaling-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/signaling-client.ts web/src/core/__tests__/signaling-client.test.ts
git commit -m "feat(web): signaling client over injected WebSocket"
```

---

## Task 7: RTC session (injected peer connection)

**Files:**
- Create: `web/src/core/rtc-session.ts`, `web/src/core/__tests__/rtc-session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/rtc-session.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RtcSession, type IPeer } from '../rtc-session';
import type { ClientMsg } from '../protocol';

function fakePeer(): IPeer & { trigger: (h: string, arg?: unknown) => void } {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'OFFER' }) as RTCSessionDescriptionInit),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'ANSWER' }) as RTCSessionDescriptionInit),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    close: vi.fn(),
    set onicecandidate(h: (arg?: unknown) => void) { handlers.ice = h; },
    set ontrack(h: (arg?: unknown) => void) { handlers.track = h; },
    trigger: (h, arg) => handlers[h]?.(arg),
  };
}

describe('RtcSession', () => {
  it('sender creates and emits an offer when negotiation starts', async () => {
    const peer = fakePeer();
    const sent: ClientMsg[] = [];
    const session = new RtcSession('sender', () => peer, (m) => sent.push(m));
    await session.start([]);
    await session.onPeerReady();
    expect(peer.createOffer).toHaveBeenCalled();
    expect(sent).toContainEqual({ type: 'offer', sdp: 'OFFER' });
  });

  it('receiver answers a remote offer', async () => {
    const peer = fakePeer();
    const sent: ClientMsg[] = [];
    const session = new RtcSession('receiver', () => peer, (m) => sent.push(m));
    await session.start([]);
    await session.handleSignal({ type: 'offer', sdp: 'REMOTE' });
    expect(peer.setRemoteDescription).toHaveBeenCalled();
    expect(sent).toContainEqual({ type: 'answer', sdp: 'ANSWER' });
  });

  it('forwards local ICE candidates to signaling', async () => {
    const peer = fakePeer();
    const sent: ClientMsg[] = [];
    const session = new RtcSession('sender', () => peer, (m) => sent.push(m));
    await session.start([]);
    peer.trigger('ice', { candidate: { candidate: 'cand', sdpMid: '0' } });
    expect(sent).toContainEqual({ type: 'ice', candidate: { candidate: 'cand', sdpMid: '0' } });
  });

  it('surfaces a remote track stream to the render callback', async () => {
    const peer = fakePeer();
    const session = new RtcSession('receiver', () => peer, () => {});
    const streams: MediaStream[] = [];
    session.onRemoteStream((s) => streams.push(s));
    await session.start([]);
    const stream = {} as MediaStream;
    peer.trigger('track', { streams: [stream] });
    expect(streams).toEqual([stream]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/rtc-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/rtc-session.ts`**

```ts
import type { ClientMsg, Role, ServerMsg } from './protocol';

/** Subset of RTCPeerConnection we use — lets tests inject a fake. */
export interface IPeer {
  addTrack(track: MediaStreamTrack, stream: MediaStream): void;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null;
  ontrack: ((ev: { streams: MediaStream[] }) => void) | null;
}

export type PeerFactory = (iceServers: RTCIceServer[]) => IPeer;

const defaultFactory: PeerFactory = (iceServers) =>
  new RTCPeerConnection({ iceServers }) as unknown as IPeer;

export class RtcSession {
  private peer: IPeer | null = null;
  private remoteStreamHandler: ((s: MediaStream) => void) | null = null;

  constructor(
    private role: Role,
    private factory: PeerFactory = defaultFactory,
    private sendSignal: (msg: ClientMsg) => void = () => {},
  ) {}

  onRemoteStream(handler: (stream: MediaStream) => void) {
    this.remoteStreamHandler = handler;
  }

  async start(iceServers: RTCIceServer[], localStream?: MediaStream) {
    const peer = this.factory(iceServers);
    this.peer = peer;
    peer.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal({ type: 'ice', candidate: ev.candidate });
    };
    peer.ontrack = (ev) => {
      if (ev.streams[0]) this.remoteStreamHandler?.(ev.streams[0]);
    };
    if (localStream) {
      for (const track of localStream.getTracks()) peer.addTrack(track, localStream);
    }
  }

  /** Called when the other peer is ready; the sender initiates the offer. */
  async onPeerReady() {
    if (this.role !== 'sender' || !this.peer) return;
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: offer.sdp ?? '' });
  }

  async handleSignal(msg: ServerMsg) {
    if (!this.peer) return;
    if (msg.type === 'offer') {
      await this.peer.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      this.sendSignal({ type: 'answer', sdp: answer.sdp ?? '' });
    } else if (msg.type === 'answer') {
      await this.peer.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === 'ice') {
      await this.peer.addIceCandidate(msg.candidate);
    }
  }

  close() {
    this.peer?.close();
    this.peer = null;
  }
}
```

> Note: the test's fake `createOffer` returns `{ type:'offer', sdp:'OFFER' }`, so `offer.sdp` is `'OFFER'` and the emitted message is `{ type:'offer', sdp:'OFFER' }`. Same pattern for the answer.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/rtc-session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/rtc-session.ts web/src/core/__tests__/rtc-session.test.ts
git commit -m "feat(web): RTC session over injected peer connection"
```

---

## Task 8: Mode parameters

**Files:**
- Create: `web/src/core/modes.ts`, `web/src/core/__tests__/modes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/modes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { senderParams, receiverPlayoutHint } from '../modes';

describe('modes', () => {
  it('realtime favors framerate with a low playout buffer', () => {
    const p = senderParams('realtime');
    expect(p.degradationPreference).toBe('maintain-framerate');
    expect(receiverPlayoutHint('realtime')).toBe(0);
  });

  it('quality favors resolution with a larger buffer and higher bitrate', () => {
    const p = senderParams('quality');
    expect(p.degradationPreference).toBe('maintain-resolution');
    expect(p.maxBitrate).toBeGreaterThan(senderParams('realtime').maxBitrate);
    expect(receiverPlayoutHint('quality')).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/modes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/modes.ts`**

```ts
import type { Mode } from './protocol';

export interface SenderParams {
  degradationPreference: RTCDegradationPreference;
  maxBitrate: number;
}

export function senderParams(mode: Mode): SenderParams {
  return mode === 'quality'
    ? { degradationPreference: 'maintain-resolution', maxBitrate: 6_000_000 }
    : { degradationPreference: 'maintain-framerate', maxBitrate: 2_500_000 };
}

/** Receiver jitter/playout buffer hint in seconds. */
export function receiverPlayoutHint(mode: Mode): number {
  return mode === 'quality' ? 0.5 : 0;
}

/** Apply sender params to the first video sender of a peer connection. */
export async function applySenderParams(pc: RTCPeerConnection, mode: Mode): Promise<void> {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
  const { degradationPreference, maxBitrate } = senderParams(mode);
  params.degradationPreference = degradationPreference;
  params.encodings[0].maxBitrate = maxBitrate;
  await sender.setParameters(params);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/modes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/modes.ts web/src/core/__tests__/modes.test.ts
git commit -m "feat(web): real-time vs quality mode parameters"
```

---

## Task 9: Capture sources

**Files:**
- Create: `web/src/core/sources.ts`, `web/src/core/__tests__/sources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/core/__tests__/sources.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureScreen, captureCamera, captureFile } from '../sources';

const fakeStream = { id: 'stream' } as unknown as MediaStream;

beforeEach(() => {
  (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn(async () => fakeStream),
    getDisplayMedia: vi.fn(async () => fakeStream),
  };
});

describe('sources', () => {
  it('captureScreen uses getDisplayMedia', async () => {
    const s = await captureScreen();
    expect(s).toBe(fakeStream);
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
  });

  it('captureCamera uses getUserMedia with audio+video', async () => {
    await captureCamera();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
  });

  it('captureFile plays the file element and captures its stream', async () => {
    const captureStreamMock = vi.fn(() => fakeStream);
    const video = {
      srcObject: null,
      play: vi.fn(async () => {}),
      captureStream: captureStreamMock,
    } as unknown as HTMLVideoElement & { captureStream: () => MediaStream };
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    const s = await captureFile(file, video);
    expect(video.play).toHaveBeenCalled();
    expect(s).toBe(fakeStream);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/core/__tests__/sources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/core/sources.ts`**

```ts
export async function captureScreen(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
}

export async function captureCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

/**
 * Stream a local media file: load it into a <video>, play, and capture its stream.
 * The caller supplies the video element so it can also show a local preview.
 */
export async function captureFile(
  file: File,
  video: HTMLVideoElement & { captureStream?: () => MediaStream },
): Promise<MediaStream> {
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  await video.play();
  const capture =
    video.captureStream ??
    (video as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;
  if (!capture) throw new Error('captureStream not supported in this browser');
  return capture.call(video);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/core/__tests__/sources.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/sources.ts web/src/core/__tests__/sources.test.ts
git commit -m "feat(web): screen/camera/file capture sources"
```

---

## Task 10: REST client

**Files:**
- Create: `web/src/api/rest.ts`, `web/src/api/__tests__/rest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/api/__tests__/rest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../rest';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  localStorage.clear();
});

describe('ApiClient', () => {
  it('stores the token on login', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { token: 'JWT' }));
    await api.login('a@b.com', 'pw');
    expect(api.token).toBe('JWT');
    expect(localStorage.getItem('sl_token')).toBe('JWT');
  });

  it('attaches the bearer token to authed calls', async () => {
    const fetchMock = mockFetch(200, []);
    const api = new ApiClient('http://srv', fetchMock);
    api.setToken('JWT');
    await api.listRooms();
    const init = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer JWT');
  });

  it('createNamedRoom posts the name and returns room', async () => {
    const api = new ApiClient('http://srv', mockFetch(200, { id: '1', name: 'Movie', code: 'ABC123' }));
    api.setToken('JWT');
    const room = await api.createNamedRoom('Movie');
    expect(room.code).toBe('ABC123');
  });

  it('resolveRoom returns false on 404', async () => {
    const api = new ApiClient('http://srv', mockFetch(404, {}));
    expect(await api.resolveRoom('NOPE')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/api/__tests__/rest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/api/rest.ts`**

```ts
export interface Room {
  id: string;
  name: string;
  code: string;
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

  async createNamedRoom(name: string): Promise<Room> {
    const res = await this.fetchImpl(`${this.base}/rooms`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ name }),
    });
    return res.json();
  }

  async createGuestRoom(): Promise<{ code: string }> {
    const res = await this.fetchImpl(`${this.base}/rooms`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({}),
    });
    return res.json();
  }

  async listRooms(): Promise<Room[]> {
    const res = await this.fetchImpl(`${this.base}/rooms`, { method: 'GET', headers: this.headers(false) });
    return res.json();
  }

  async deleteRoom(id: string): Promise<void> {
    await this.fetchImpl(`${this.base}/rooms/${id}`, { method: 'DELETE', headers: this.headers(false) });
  }

  async resolveRoom(code: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.base}/rooms/resolve/${code}`, { method: 'GET' });
    return res.ok;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/api/__tests__/rest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/api
git commit -m "feat(web): REST client for auth and saved rooms"
```

---

## Task 11: Session orchestration hook

Ties `SignalingClient` + `RtcSession` + `connection-machine` together for the UI. Tested by driving it with injected fakes.

**Files:**
- Create: `web/src/ui/hooks/useSession.ts`, `web/src/ui/hooks/__tests__/useSession.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/ui/hooks/__tests__/useSession.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Session } from '../useSession';
import type { ISocket } from '../../../core/signaling-client';
import type { IPeer } from '../../../core/rtc-session';

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
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'ANSWER' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    close: vi.fn(),
    onicecandidate: null,
    ontrack: null,
  };
}

describe('Session orchestration', () => {
  it('moves to negotiating and sends an offer when a peer is already present', async () => {
    const socket = new FakeSocket();
    const session = new Session('ws://x/ws', 'sender', 'realtime', () => socket, () => fakePeer());
    const states: string[] = [];
    session.onState((s) => states.push(s.conn));
    session.start('R1');
    socket.open();
    socket.emit('{"type":"joined","peer_present":true,"ice_servers":[]}');
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toContain('negotiating');
    // an offer frame was sent (first frame is the join)
    expect(socket.sent.some((f) => f.includes('"type":"offer"'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/ui/hooks/__tests__/useSession.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `web/src/ui/hooks/useSession.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import { SignalingClient, type SocketFactory } from '../../core/signaling-client';
import { RtcSession, type PeerFactory } from '../../core/rtc-session';
import { initial, reduce, type MachineState } from '../../core/connection-machine';
import type { Mode, Role, ServerMsg } from '../../core/protocol';

/** Framework-agnostic orchestrator (also unit-testable without React). */
export class Session {
  private signaling: SignalingClient;
  private rtc: RtcSession;
  private state: MachineState = initial;
  private stateHandler: ((s: MachineState) => void) | null = null;
  private remoteHandler: ((s: MediaStream) => void) | null = null;
  private iceServers: RTCIceServer[] = [];

  constructor(
    url: string,
    private role: Role,
    private mode: Mode,
    socketFactory?: SocketFactory,
    peerFactory?: PeerFactory,
    private localStream?: MediaStream,
  ) {
    this.signaling = new SignalingClient(url, socketFactory);
    this.rtc = new RtcSession(role, peerFactory, (m) => this.signaling.send(m));
    this.signaling.onMessage((m) => this.onServer(m));
    this.rtc.onRemoteStream((s) => this.remoteHandler?.(s));
  }

  onState(h: (s: MachineState) => void) { this.stateHandler = h; }
  onRemoteStream(h: (s: MediaStream) => void) { this.remoteHandler = h; }

  start(room: string) {
    this.dispatch({ type: 'join' });
    this.signaling.join(room, this.role, this.mode);
  }

  private dispatch(ev: Parameters<typeof reduce>[1]) {
    this.state = reduce(this.state, ev);
    this.stateHandler?.(this.state);
  }

  private async onServer(msg: ServerMsg) {
    switch (msg.type) {
      case 'joined':
        this.iceServers = msg.ice_servers;
        await this.rtc.start(this.iceServers, this.localStream);
        this.dispatch({ type: 'joined', peerPresent: msg.peer_present });
        if (msg.peer_present) await this.rtc.onPeerReady();
        break;
      case 'peer-joined':
        this.dispatch({ type: 'peer-joined' });
        await this.rtc.onPeerReady();
        break;
      case 'offer':
      case 'answer':
      case 'ice':
        await this.rtc.handleSignal(msg);
        if (msg.type === 'answer') this.dispatch({ type: 'connected', transport: 'unknown' });
        break;
      case 'peer-left':
        this.dispatch({ type: 'peer-left' });
        break;
      case 'error':
        // surfaced via state consumer; close the session
        this.dispatch({ type: 'close' });
        break;
    }
  }

  close() {
    this.dispatch({ type: 'close' });
    this.signaling.close();
    this.rtc.close();
  }
}

/** React binding around Session. */
export function useSession(
  url: string,
  role: Role,
  mode: Mode,
  room: string | null,
  localStream?: MediaStream,
) {
  const [state, setState] = useState<MachineState>(initial);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const ref = useRef<Session | null>(null);

  useEffect(() => {
    if (!room) return;
    const session = new Session(url, role, mode, undefined, undefined, localStream);
    ref.current = session;
    session.onState(setState);
    session.onRemoteStream(setRemote);
    session.start(room);
    return () => session.close();
  }, [url, role, mode, room, localStream]);

  return { state, remote };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/ui/hooks/__tests__/useSession.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/hooks
git commit -m "feat(web): session orchestrator tying signaling, rtc, and state machine"
```

---

## Task 12: UI screens + routing

Thin React screens. One representative RTL smoke test; the heavy logic is already covered in the core.

**Files:**
- Create: `web/src/ui/screens/Home.tsx`, `Sender.tsx`, `Receiver.tsx`, `Auth.tsx`, `MyRooms.tsx`
- Modify: `web/src/ui/App.tsx`
- Create: `web/src/ui/__tests__/flow.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `web/src/ui/__tests__/flow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

describe('app flow', () => {
  it('home shows the two primary actions', () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(screen.getByText(/Start streaming/i)).toBeInTheDocument();
    expect(screen.getByText(/Join a stream/i)).toBeInTheDocument();
  });

  it('sender screen lets you pick a source and mode', () => {
    render(<MemoryRouter initialEntries={['/send']}><App /></MemoryRouter>);
    expect(screen.getByLabelText(/Screen/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Real-time/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Camera/i));
    expect((screen.getByLabelText(/Camera/i) as HTMLInputElement).checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/ui/__tests__/flow.test.tsx`
Expected: FAIL — screens not defined.

- [ ] **Step 3: Write the screens**

Create `web/src/ui/screens/Home.tsx`:
```tsx
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <main>
      <h1>stream_lover</h1>
      <nav>
        <Link to="/send">Start streaming</Link>
        <Link to="/join">Join a stream</Link>
      </nav>
      <p><Link to="/auth">Log in / Sign up</Link></p>
    </main>
  );
}
```

Create `web/src/ui/screens/Sender.tsx`:
```tsx
import { useState } from 'react';
import type { Mode } from '../../core/protocol';
import { captureScreen, captureCamera } from '../../core/sources';
import { ApiClient } from '../../api/rest';
import { useSession } from '../hooks/useSession';

type SourceKind = 'screen' | 'camera' | 'file';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';

export default function Sender() {
  const [source, setSource] = useState<SourceKind>('screen');
  const [mode, setMode] = useState<Mode>('realtime');
  const [room, setRoom] = useState<string | null>(null);
  const [code, setCode] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | undefined>();
  const [error, setError] = useState<string>('');
  const { state } = useSession(WS, 'sender', mode, room, stream);

  async function createSession() {
    try {
      const captured = source === 'camera' ? await captureCamera() : await captureScreen();
      setStream(captured);
      const api = new ApiClient(SERVER);
      const res = await api.createGuestRoom();
      setCode(res.code);
      setRoom(res.code);
    } catch {
      setError('Could not start capture (permission denied?).');
    }
  }

  return (
    <main>
      <h2>Start streaming</h2>
      <fieldset>
        <legend>Source</legend>
        <label><input type="radio" name="src" checked={source === 'screen'} onChange={() => setSource('screen')} /> Screen</label>
        <label><input type="radio" name="src" checked={source === 'camera'} onChange={() => setSource('camera')} /> Camera</label>
        <label><input type="radio" name="src" checked={source === 'file'} onChange={() => setSource('file')} /> File</label>
      </fieldset>
      <fieldset>
        <legend>Mode</legend>
        <label><input type="radio" name="mode" checked={mode === 'realtime'} onChange={() => setMode('realtime')} /> Real-time</label>
        <label><input type="radio" name="mode" checked={mode === 'quality'} onChange={() => setMode('quality')} /> High quality</label>
      </fieldset>
      <button onClick={createSession}>Create session</button>
      {error && <p role="alert">{error}</p>}
      {code && <p>Room code: <strong>{code}</strong> · {state.conn} {state.transport !== 'unknown' && `· ${state.transport}`}</p>}
    </main>
  );
}
```

Create `web/src/ui/screens/Receiver.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../../api/rest';
import { useSession } from '../hooks/useSession';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';
const WS = SERVER.replace(/^http/, 'ws') + '/ws';

export default function Receiver() {
  const [input, setInput] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state, remote } = useSession(WS, 'receiver', 'realtime', room);

  useEffect(() => {
    if (remote && videoRef.current) videoRef.current.srcObject = remote;
  }, [remote]);

  async function join() {
    const api = new ApiClient(SERVER);
    // room codes from guests aren't persisted; only validate named rooms
    const ok = input.length === 6 ? true : await api.resolveRoom(input);
    if (!ok) { setError('No such room.'); return; }
    setError('');
    setRoom(input);
  }

  return (
    <main>
      <h2>Join a stream</h2>
      <input aria-label="code" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Enter code" />
      <button onClick={join}>Join</button>
      {error && <p role="alert">{error}</p>}
      <p>{state.conn} {state.transport !== 'unknown' && `· ${state.transport}`}</p>
      <video ref={videoRef} autoPlay playsInline controls style={{ width: '100%' }} />
    </main>
  );
}
```

Create `web/src/ui/screens/Auth.tsx`:
```tsx
import { useState } from 'react';
import { ApiClient } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const api = new ApiClient(SERVER);

  async function run(kind: 'login' | 'signup') {
    try {
      if (kind === 'login') await api.login(email, password);
      else await api.signup(email, password);
      setMsg('Signed in.');
    } catch {
      setMsg('Authentication failed.');
    }
  }

  return (
    <main>
      <h2>Account</h2>
      <input aria-label="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input aria-label="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
      <button onClick={() => run('login')}>Log in</button>
      <button onClick={() => run('signup')}>Sign up</button>
      {msg && <p>{msg}</p>}
    </main>
  );
}
```

Create `web/src/ui/screens/MyRooms.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { ApiClient, type Room } from '../../api/rest';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8080';

export default function MyRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const api = new ApiClient(SERVER);

  async function refresh() {
    if (!api.token) return;
    setRooms(await api.listRooms());
  }
  useEffect(() => { void refresh(); }, []);

  async function create() {
    if (!name) return;
    await api.createNamedRoom(name);
    setName('');
    await refresh();
  }

  return (
    <main>
      <h2>My rooms</h2>
      <input aria-label="room name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name" />
      <button onClick={create}>Create</button>
      <ul>
        {rooms.map((r) => (
          <li key={r.id}>
            {r.name} — <code>{r.code}</code>
            <button onClick={async () => { await api.deleteRoom(r.id); await refresh(); }}>delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Wire routing in `web/src/ui/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import Home from './screens/Home';
import Sender from './screens/Sender';
import Receiver from './screens/Receiver';
import Auth from './screens/Auth';
import MyRooms from './screens/MyRooms';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/send" element={<Sender />} />
      <Route path="/join" element={<Receiver />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/rooms" element={<MyRooms />} />
    </Routes>
  );
}
```

- [ ] **Step 5: Wrap the app in a router in `web/src/main.tsx`**

Replace `web/src/main.tsx` with:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: Run the smoke test and the full suite**

Run: `cd web && npx vitest run`
Expected: PASS — all core tests plus the 2 UI smoke tests.

- [ ] **Step 7: Typecheck and build**

Run: `cd web && npm run build`
Expected: `tsc -b` clean, Vite build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(web): screens, routing, and UI smoke tests"
```

---

## Task 13: Docs — manual test checklist + READMEs

**Files:**
- Create: `web/README.md`
- Modify: `README.md` (root), `CHANGELOG.md` (root)

- [ ] **Step 1: Write `web/README.md`**

```markdown
# stream_lover web client

React + TS + Vite. Framework-agnostic WebRTC core in `src/core/`, thin UI in `src/ui/`.

## Develop
    npm install
    VITE_SERVER_URL=http://localhost:8080 npm run dev
    npm test

## Manual test checklist (real browsers)
Run the server (`cd ../server && JWT_SECRET=dev TURN_SECRET=dev cargo run -p stream_lover_server`).
1. Open two tabs (or two devices). Tab A: Start streaming → Screen → Real-time → Create session; copy code.
2. Tab B: Join a stream → paste code → confirm remote video appears; status shows `connected · direct`.
3. Repeat with Camera and with File sources.
4. Repeat with High-quality mode; confirm video plays (higher bitrate, slight delay).
5. Force relay: block direct connectivity (e.g. different networks / firewall) and confirm status shows `connected · relay`.
6. Logged in: create a named room under My rooms; rejoin it later via its stable code.
```

- [ ] **Step 2: Update root `README.md`**

Add this section after the "Server layout" section:

```markdown
## Web client
See `web/` — React + TS + Vite. Streams screen/camera/file peer-to-peer to another device.
    cd web && npm install && VITE_SERVER_URL=http://localhost:8080 npm run dev
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add at the top under a new heading:

```markdown
## [0.2.0] - 2026-06-02
### Added
- Server: persistent saved rooms (`rooms` table; create/list/delete/resolve endpoints).
- Web client (React + TS + Vite): screen/camera/file streaming, real-time & quality modes,
  room-code and account pairing, personal saved rooms, direct/relay status indicator.
- Framework-agnostic, unit-tested core: protocol, connection state machine, signaling client,
  RTC session, modes, capture sources, REST client.
```

- [ ] **Step 4: Commit**

```bash
git add web/README.md README.md CHANGELOG.md
git commit -m "docs: web client README, manual test checklist, changelog"
```

---

## Definition of Done

- `cd server && cargo test` passes (store + api gain the saved-room tests).
- `cd web && npx vitest run` passes (protocol, connection-machine, signaling-client, rtc-session, modes, sources, rest, useSession, UI smoke).
- `cd web && npm run build` is clean (tsc + Vite).
- Manual checklist in `web/README.md` exercises all three sources, both modes, and a forced-relay case.

## Notes for the implementer

- **Node/npm may be limited on Termux.** The Rust tasks (Part A) run locally. For Part B, if `npm install` can't run here, author the files and run `vitest`/`build` where Node is available; the code is written framework-correct.
- **DI everywhere:** the core takes injected socket/peer factories so tests never need a real browser. Don't reach for global mocks.
- **`import.meta.env.VITE_SERVER_URL`** configures the server origin; defaults to `http://localhost:8080`.
- **File source wiring:** `captureFile` (Task 9) is built and tested. The Sender screen exposes a
  `File` radio but `createSession` only branches screen/camera; when implementing, add an
  `<input type="file" accept="video/*,audio/*">` plus a hidden `<video>` preview and, for
  `source === 'file'`, call `captureFile(selectedFile, videoEl)` to get the stream. This is the
  only place the three-source spec requirement is completed in the UI.
- **YAGNI:** no channels/roles/presence, no multi-party, no native code in this phase (see spec §11).
```
