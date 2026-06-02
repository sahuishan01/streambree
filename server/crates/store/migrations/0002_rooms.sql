CREATE TABLE rooms (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    code       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_rooms_owner ON rooms(owner_id);
