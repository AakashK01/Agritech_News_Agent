-- Drop section_snapshot — replaced by agritech.logs
DROP TABLE IF EXISTS agritech.section_snapshot;

-- Per-event crawl log: one row per article action + one run_complete row per run.
-- Replaces: section_snapshot table, crawl.json, run-summary.json, url-content-index.json, section-snapshots.json
CREATE TABLE IF NOT EXISTS agritech.logs (
  id         BIGSERIAL PRIMARY KEY,
  run_id     TEXT        NOT NULL,
  source_id  TEXT        NOT NULL,
  event      TEXT        NOT NULL CHECK (event IN ('new', 'updated', 'skipped', 'not_relevant', 'error', 'run_complete')),
  url        TEXT,
  reason     TEXT,
  entry_key  TEXT,
  meta       JSONB,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_run_id ON agritech.logs (run_id);
CREATE INDEX IF NOT EXISTS idx_logs_url    ON agritech.logs (url);
