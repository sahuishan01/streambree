ALTER TABLE rooms RENAME TO channels;

CREATE TABLE channel_members (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    can_stream  INTEGER NOT NULL DEFAULT 1,
    joined_at   TEXT NOT NULL,
    UNIQUE (channel_id, user_id)
);
CREATE INDEX idx_members_channel ON channel_members(channel_id);
CREATE INDEX idx_members_user    ON channel_members(user_id);

CREATE TABLE channel_invites (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    created_by  TEXT NOT NULL REFERENCES users(id),
    expires_at  TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_invites_channel ON channel_invites(channel_id);

INSERT INTO channel_members (id, channel_id, user_id, role, can_stream, joined_at)
SELECT lower(hex(randomblob(16))), id, owner_id, 'owner', 1, created_at FROM channels;
