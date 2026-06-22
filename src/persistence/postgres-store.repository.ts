import { executeQuery } from '../db/index';
import type { StartupNewsRow } from '../domain/types';
import type { SectionSnapshotMap } from './section-snapshot.service';

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

const UPSERT_SECTION_SQL = `
INSERT INTO agritech.section_snapshot (section_url, content_hash, checked_at)
VALUES ($1, $2, now())
ON CONFLICT (section_url) DO UPDATE SET
  content_hash = EXCLUDED.content_hash,
  checked_at = now()
`;

const LOAD_INCOMPLETE_NEWS_SQL = `
SELECT source_url
FROM agritech.news
WHERE news_summary IS NULL OR TRIM(news_summary) = ''
`;

const LOAD_SECTIONS_SQL = `
SELECT section_url, content_hash, checked_at
FROM agritech.section_snapshot
`;

interface SectionRow {
    section_url: string;
    content_hash: string;
    checked_at: Date;
}

interface IncompleteNewsRow {
    source_url: string;
}

export class PostgresStore {
    async loadIncompleteNewsUrls(): Promise<string[]> {
        const result = await executeQuery<IncompleteNewsRow>(LOAD_INCOMPLETE_NEWS_SQL);
        return result.rows.map((row) => row.source_url);
    }

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

    async loadSectionSnapshots(): Promise<SectionSnapshotMap> {
        const result = await executeQuery<SectionRow>(LOAD_SECTIONS_SQL);
        const map: SectionSnapshotMap = new Map();
        for (const row of result.rows) {
            map.set(row.section_url, {
                contentHash: row.content_hash,
                lastCheckedAt: row.checked_at.toISOString(),
            });
        }
        return map;
    }

    async saveSectionSnapshots(snapshots: SectionSnapshotMap): Promise<void> {
        for (const [sectionUrl, rec] of snapshots.entries()) {
            await executeQuery(UPSERT_SECTION_SQL, [sectionUrl, rec.contentHash]);
        }
    }
}
