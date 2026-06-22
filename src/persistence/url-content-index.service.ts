import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgriTechConfig } from '../config/app-config';

export interface UrlContentRecord {
    contentHash: string;
    lastSeenAt: string;
    lastRunId?: string;
    /** false when AI extraction failed or returned incomplete data — retry on next run. */
    extractionComplete?: boolean;
}

export type UrlContentIndexMap = Map<string, UrlContentRecord>;

type StoredIndex = Record<string, UrlContentRecord>;

export class UrlContentIndexService {
    constructor(private readonly config: AgriTechConfig) {}

    private filePath(): string {
        return path.resolve(process.cwd(), this.config.AGRITECH_URL_CONTENT_INDEX);
    }

    async load(): Promise<UrlContentIndexMap> {
        const map: UrlContentIndexMap = new Map();
        try {
            const raw = await fs.readFile(this.filePath(), 'utf8');
            const parsed = JSON.parse(raw) as StoredIndex;
            for (const [url, rec] of Object.entries(parsed)) {
                map.set(url, rec);
            }
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }
        return map;
    }

    async persist(index: UrlContentIndexMap): Promise<void> {
        const obj: StoredIndex = {};
        for (const [url, rec] of index.entries()) {
            obj[url] = rec;
        }
        const fp = this.filePath();
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, JSON.stringify(obj, null, 2), 'utf8');
    }
}
