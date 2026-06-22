import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExcelStoreService } from './excel-store.service';
import type { StartupNewsRow } from '../domain/types';

describe('ExcelStoreService', () => {
    it('writes dated workbook with rows', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agritech-xlsx-'));
        const store = new ExcelStoreService();
        const row: StartupNewsRow = {
            entryKey: 'abc',
            sourceUrl: 'https://agfundernews.com/test-article',
            startupName: 'Test Co',
            startupWebsite: null,
            description: 'Does agtech',
            newsSummary: 'Raised seed',
            sourceId: 'agfunder',
            entryStatus: 'new',
            contentHash: 'hash1',
            discoveredAt: new Date().toISOString(),
        };
        const out = await store.createWorkbook(tmp, [row]);
        const stat = await fs.stat(out);
        expect(stat.size).toBeGreaterThan(0);
        expect(out).toContain('agritech-startups.xlsx');
    });
});
