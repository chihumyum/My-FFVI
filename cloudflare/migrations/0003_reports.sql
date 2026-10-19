-- Diagnostics are separate from saves. R2 REPORTS must remain private.
CREATE TABLE bug_reports (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  submission TEXT NOT NULL,
  created INTEGER NOT NULL,
  captured TEXT NOT NULL,
  map_id INTEGER,
  map_name TEXT,
  script_name TEXT,
  instruction INTEGER,
  description TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  UNIQUE(owner, submission)
);
CREATE INDEX bug_reports_created ON bug_reports(created DESC, id DESC);
CREATE TABLE report_limits (
  owner TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(owner, window)
);
