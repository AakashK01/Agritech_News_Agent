import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgriTechConfig } from '../config/app-config';
import { UrlContentIndexService } from './url-content-index.service';

function testConfig(indexPath: string): AgriTechConfig {
    return {
        AGRITECH_URL_CONTENT_INDEX: indexPath,
    } as AgriTechConfig;
}

describe('UrlContentIndexService', () => {
    it('loads empty map when file missing', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agritech-idx-'));
        const svc = new UrlContentIndexService(testConfig(path.join(tmp, 'missing.json')));
        const map = await svc.load();
        expect(map.size).toBe(0);
    });

    it('persists and reloads entries', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agritech-idx-'));
        const fp = path.join(tmp, 'index.json');
        const svc = new UrlContentIndexService(testConfig(fp));
        const map = new Map<string, { contentHash: string; lastSeenAt: string }>();
        map.set('https://agfundernews.com/foo', { contentHash: 'abc', lastSeenAt: '2025-01-01T00:00:00Z' });
        await svc.persist(map);
        const loaded = await svc.load();
        expect(loaded.get('https://agfundernews.com/foo')?.contentHash).toBe('abc');
    });
});
