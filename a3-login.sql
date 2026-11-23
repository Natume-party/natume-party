CREATE TABLE IF NOT EXISTS quote_login_attempts (
  scope TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  used INTEGER NOT NULL
);
