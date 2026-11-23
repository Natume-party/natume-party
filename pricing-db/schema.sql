CREATE TABLE IF NOT EXISTS quote_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE TABLE IF NOT EXISTS quote_login_attempts (
  scope TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  used INTEGER NOT NULL
);
