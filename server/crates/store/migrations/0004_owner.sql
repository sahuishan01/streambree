ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
-- The first user created is the owner.
UPDATE users SET is_owner = 1 WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1);
