CREATE SCHEMA IF NOT EXISTS agritech;

-- All sources (AgFunder, future sites) write here. entry_key is the sole row identity.
CREATE TABLE IF NOT EXISTS agritech.news (
  entry_key       TEXT PRIMARY KEY,
  source_url      TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  startup_name    TEXT,
  startup_website TEXT,
  description     TEXT,
  news_summary    TEXT,
  entry_status    TEXT NOT NULL CHECK (entry_status IN ('new', 'updated')),
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_source_url ON agritech.news (source_url);
CREATE INDEX IF NOT EXISTS idx_news_source_id ON agritech.news (source_id);

-- Section listing fingerprints (incremental crawl skip). One row per section URL.
CREATE TABLE IF NOT EXISTS agritech.section_snapshot (
  section_url   TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
