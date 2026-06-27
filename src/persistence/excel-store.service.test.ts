import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { EXCEL_LOGS_FILENAME, EXCEL_NEWS_FILENAME } from '../constants/excel';
import { ExcelStoreService } from './excel-store.service';
import type { LogEntry } from './postgres-store.repository';
import type { StartupNewsRow } from '../domain/types';

function sampleRow(entryKey: string, startupName: string): StartupNewsRow {
    return {
        entryKey,
        sourceUrl: 'https://agfundernews.com/test-article',
        startupName,
        startupWebsite: null,
        description: 'Does agtech',
        newsSummary: 'Raised seed',
        sourceId: 'agfunder',
        entryStatus: 'new',
        contentHash: 'hash1',
        discoveredAt: new Date().toISOString(),
    };
}

describe('ExcelStoreService', () => {
    let tmpDataDir: string;
    let store: ExcelStoreService;

    beforeEach(async () => {
        tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agritech-xlsx-'));
        store = new ExcelStoreService(tmpDataDir);
    });

    afterEach(async () => {
        await fs.rm(tmpDataDir, { recursive: true, force: true });
    });

    it('creates news file with headers on first upsert', async () => {
        const out = await store.upsertNewsFile([sampleRow('key-1', 'Test Co')]);
        const stat = await fs.stat(out);
        expect(stat.size).toBeGreaterThan(0);
        expect(out).toContain(EXCEL_NEWS_FILENAME);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(out);
        const sheet = workbook.worksheets[0]!;
        expect(sheet.rowCount).toBe(2);
        expect(String(sheet.getRow(1).getCell(1).value)).toBe('entry_key');
        expect(String(sheet.getRow(2).getCell(1).value)).toBe('key-1');
    });

    it('upserts news by entry_key — update existing and add new', async () => {
        await store.upsertNewsFile([sampleRow('key-1', 'Original Name')]);
        await store.upsertNewsFile([sampleRow('key-1', 'Updated Name'), sampleRow('key-2', 'Second Co')]);

        const out = path.join(tmpDataDir, EXCEL_NEWS_FILENAME);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(out);
        const sheet = workbook.worksheets[0]!;

        expect(sheet.rowCount).toBe(3);
        const names = [sheet.getRow(2).getCell(4).value, sheet.getRow(3).getCell(4).value]
            .map((v) => String(v))
            .sort();
        expect(names).toEqual(['Second Co', 'Updated Name']);
    });

    it('appends logs and preserves prior rows', async () => {
        const entry: LogEntry = {
            runId: 'run-1',
            sourceId: 'agfunder',
            event: 'new',
            url: 'https://agfundernews.com/a',
            entryKey: 'key-1',
        };

        const logsPath = await store.appendLogsFile([entry]);
        await store.appendLogsFile([
            {
                runId: 'run-2',
                sourceId: 'inc42',
                event: 'skipped',
                url: 'https://inc42.com/b',
                reason: 'duplicate_in_run',
            },
        ]);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(logsPath);
        const sheet = workbook.worksheets[0]!;
        expect(sheet.rowCount).toBe(3);
        expect(String(sheet.getRow(2).getCell(1).value)).toBe('run-1');
        expect(String(sheet.getRow(3).getCell(1).value)).toBe('run-2');
    });
});
