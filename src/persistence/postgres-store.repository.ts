import { executeQuery } from '../db/index';
import type { CrawlLogEntry, StartupNewsRow } from '../domain/types';
import { canonicalizeSourceUrl } from '../utils/url';

export type LogEntry = CrawlLogEntry;

const UPSERT_NEWS_SQL = `
INSERT INTO agritech.news (
  entry_key, source_url, source_id, startup_name, startup_website,
  description, news_summary, entry_status, discovered_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
ON CONFLICT (entry_key) DO UPDATE SET
  startup_name = EXCLUDED.startup_name,
  startup_website = EXCLUDED.startup_website,
  description = EXCLUDED.description,
  news_summary = EXCLUDED.news_summary,
  entry_status = EXCLUDED.entry_status,
  discovered_at = EXCLUDED.discovered_at
`;

const INSERT_LOG_SQL = `
INSERT INTO agritech.logs (run_id, source_id, event, url, reason, entry_key, meta)
VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

const FILTER_KNOWN_URLS_SQL = `
SELECT source_url FROM agritech.news WHERE source_url = ANY($1)
`;

interface KnownUrlRow {
    source_url: string;
}

export class PostgresStore {
    async upsertNews(rows: StartupNewsRow[]): Promise<number> {
        if (rows.length === 0) {
            return 0;
        }
        for (const row of rows) {
            await executeQuery(UPSERT_NEWS_SQL, [
                row.entryKey,
                row.sourceUrl,
                row.sourceId,
                row.startupName,
                row.startupWebsite,
                row.description,
                row.newsSummary,
                row.entryStatus,
                row.discoveredAt,
            ]);
        }
        return rows.length;
    }

    /** Returns only URLs from the input that are NOT already in agritech.news. */
    async filterKnownUrls(urls: string[]): Promise<string[]> {
        if (urls.length === 0) {
            return [];
        }
        const canonicalUrls = urls.map((u) => canonicalizeSourceUrl(u));
        const result = await executeQuery<KnownUrlRow>(FILTER_KNOWN_URLS_SQL, [canonicalUrls]);
        const known = new Set(result.rows.map((r) => canonicalizeSourceUrl(r.source_url)));
        return urls.filter((u) => !known.has(canonicalizeSourceUrl(u)));
    }

    async insertLog(entry: LogEntry): Promise<void> {
        await executeQuery(INSERT_LOG_SQL, [
            entry.runId,
            entry.sourceId,
            entry.event,
            entry.url ?? null,
            entry.reason ?? null,
            entry.entryKey ?? null,
            entry.meta ? JSON.stringify(entry.meta) : null,
        ]);
    }
}
