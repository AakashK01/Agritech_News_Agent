import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgriTechConfig } from '../config/app-config';
import type { PostgresStore } from './postgres-store.repository';

export interface SectionSnapshotRecord {
    contentHash: string;
    lastCheckedAt: string;
}

export type SectionSnapshotMap = Map<string, SectionSnapshotRecord>;

type StoredSections = Record<string, SectionSnapshotRecord>;

export class SectionSnapshotService {
    constructor(
        private readonly config: AgriTechConfig,
        private readonly postgres: PostgresStore | null,
    ) {}

    private jsonPath(): string {
        return path.resolve(process.cwd(), this.config.AGRITECH_SECTION_SNAPSHOTS);
    }

    async load(): Promise<SectionSnapshotMap> {
        if (this.postgres) {
            return this.postgres.loadSectionSnapshots();
        }

        const map: SectionSnapshotMap = new Map();
        try {
            const raw = await fs.readFile(this.jsonPath(), 'utf8');
            const parsed = JSON.parse(raw) as StoredSections;
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

    async persist(snapshots: SectionSnapshotMap): Promise<void> {
        if (this.postgres) {
            await this.postgres.saveSectionSnapshots(snapshots);
            return;
        }

        const obj: StoredSections = {};
        for (const [url, rec] of snapshots.entries()) {
            obj[url] = rec;
        }
        const fp = this.jsonPath();
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, JSON.stringify(obj, null, 2), 'utf8');
    }
}
