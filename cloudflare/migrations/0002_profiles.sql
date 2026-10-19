-- Add public profiles without rewriting the existing private saves or sessions.
CREATE TABLE profiles (id TEXT PRIMARY KEY, created INTEGER NOT NULL);
CREATE TABLE profile_sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL, owner TEXT NOT NULL);
CREATE INDEX profile_sessions_expires ON profile_sessions(expires);
CREATE TABLE profile_saves (
  owner TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL,
  updated INTEGER NOT NULL, mutation TEXT NOT NULL, PRIMARY KEY (owner, id)
);
CREATE TABLE profile_history (
  owner TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL,
  updated INTEGER NOT NULL, PRIMARY KEY (owner, id, revision)
);
CREATE INDEX profile_history_owner_updated ON profile_history(owner, updated DESC);
