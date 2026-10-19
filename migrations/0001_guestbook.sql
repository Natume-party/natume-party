CREATE TABLE IF NOT EXISTS guestbook_messages (id INTEGER PRIMARY KEY AUTOINCREMENT,author TEXT NOT NULL CHECK(length(author) BETWEEN 1 AND 32),message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 500),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','hidden')),reply TEXT,created_at INTEGER NOT NULL,approved_at INTEGER,replied_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_guestbook_status_id ON guestbook_messages(status,id DESC);
CREATE TABLE IF NOT EXISTS guestbook_rate (bucket TEXT PRIMARY KEY,day TEXT NOT NULL,count INTEGER NOT NULL,last_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS guestbook_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
-- Install SHA-256 digest of a private 256-bit bearer token into guestbook_config
-- under key admin_token_sha256. Never commit its plaintext value.
