CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO metadata VALUES ('serverId', lower(hex(randomblob(24))));
CREATE TABLE IF NOT EXISTS saves (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL, record TEXT NOT NULL,
  updated INTEGER NOT NULL, mutation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL,
  updated INTEGER NOT NULL, PRIMARY KEY (id, revision)
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
);
