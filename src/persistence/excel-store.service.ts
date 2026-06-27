import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    EXCEL_DATA_DIR,
    EXCEL_LOGS_COLUMNS,
    EXCEL_LOGS_FILENAME,
    EXCEL_LOGS_SHEET_NAME,
    EXCEL_NEWS_COLUMNS,
    EXCEL_NEWS_FILENAME,
    EXCEL_NEWS_SHEET_NAME,
} from '../constants/excel';
import type { StartupNewsRow } from '../domain/types';
import type { LogEntry } from './postgres-store.repository';

export class ExcelStoreService {
    constructor(private readonly dataDir: string = EXCEL_DATA_DIR) {}

    private newsFilePath(): string {
        return path.join(this.dataDir, EXCEL_NEWS_FILENAME);
    }

    private logsFilePath(): string {
        return path.join(this.dataDir, EXCEL_LOGS_FILENAME);
    }

    async upsertNewsFile(rows: StartupNewsRow[]): Promise<string> {
        const outPath = this.newsFilePath();
        await fs.mkdir(this.dataDir, { recursive: true });

        const byKey = new Map<string, StartupNewsRow>();

        if (await fileExists(outPath)) {
            const existing = await this.readNewsRows(outPath);
            for (const row of existing) {
                byKey.set(row.entryKey, row);
            }
        }

        for (const row of rows) {
            byKey.set(row.entryKey, row);
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(EXCEL_NEWS_SHEET_NAME);
        sheet.addRow([...EXCEL_NEWS_COLUMNS]);

        for (const row of byKey.values()) {
            sheet.addRow(newsRowToCells(row));
        }

        await workbook.xlsx.writeFile(outPath);
        return outPath;
    }

    async appendLogsFile(entries: LogEntry[]): Promise<string> {
        const outPath = this.logsFilePath();
        await fs.mkdir(this.dataDir, { recursive: true });

        const existingRows: string[][] = [];
        if (await fileExists(outPath)) {
            existingRows.push(...(await this.readLogDataRows(outPath)));
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(EXCEL_LOGS_SHEET_NAME);
        sheet.addRow([...EXCEL_LOGS_COLUMNS]);

        for (const cells of existingRows) {
            sheet.addRow(cells);
        }

        const loggedAt = new Date().toISOString();
        for (const entry of entries) {
            sheet.addRow(logEntryToCells(entry, loggedAt));
        }

        await workbook.xlsx.writeFile(outPath);
        return outPath;
    }

    private async readNewsRows(filePath: string): Promise<StartupNewsRow[]> {
        const sheet = await this.readFirstSheet(filePath);
        const header = sheet.getRow(1).values as Array<string | undefined>;
        const colIndex = buildColumnIndex(header, EXCEL_NEWS_COLUMNS);

        const rows: StartupNewsRow[] = [];
        for (let i = 2; i <= sheet.rowCount; i++) {
            const values = sheet.getRow(i).values as Array<string | undefined>;
            const entryKey = cell(values, colIndex.entry_key);
            if (!entryKey) {
                continue;
            }
            rows.push({
                entryKey,
                sourceUrl: cell(values, colIndex.source_url) ?? '',
                sourceId: cell(values, colIndex.source_id) ?? '',
                startupName: nullableCell(values, colIndex.startup_name),
                startupWebsite: nullableCell(values, colIndex.startup_website),
                description: nullableCell(values, colIndex.description),
                newsSummary: nullableCell(values, colIndex.news_summary),
                entryStatus: (cell(values, colIndex.entry_status) as StartupNewsRow['entryStatus']) ?? 'new',
                contentHash: '',
                discoveredAt: cell(values, colIndex.discovered_at) ?? new Date().toISOString(),
            });
        }
        return rows;
    }

    private async readLogDataRows(filePath: string): Promise<string[][]> {
        const sheet = await this.readFirstSheet(filePath);
        const rows: string[][] = [];
        for (let i = 2; i <= sheet.rowCount; i++) {
            const values = sheet.getRow(i).values as Array<string | undefined>;
            if (!values || values.length <= 1) {
                continue;
            }
            rows.push(EXCEL_LOGS_COLUMNS.map((_, idx) => stringCell(values[idx + 1])));
        }
        return rows;
    }

    private async readFirstSheet(filePath: string): Promise<ExcelJS.Worksheet> {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.worksheets[0];
        if (!sheet) {
            throw new Error(`Excel file has no worksheets: ${filePath}`);
        }
        return sheet;
    }
}

function newsRowToCells(row: StartupNewsRow): string[] {
    return [
        row.entryKey,
        row.sourceUrl,
        row.sourceId,
        row.startupName ?? '',
        row.startupWebsite ?? '',
        row.description ?? '',
        row.newsSummary ?? '',
        row.entryStatus,
        row.discoveredAt,
    ];
}

function logEntryToCells(entry: LogEntry, loggedAt: string): string[] {
    return [
        entry.runId,
        entry.sourceId,
        entry.event,
        entry.url ?? '',
        entry.reason ?? '',
        entry.entryKey ?? '',
        entry.meta ? JSON.stringify(entry.meta) : '',
        loggedAt,
    ];
}

function buildColumnIndex(
    header: Array<string | undefined>,
    columns: readonly string[],
): Record<string, number> {
    const index: Record<string, number> = {};
    for (let i = 1; i < header.length; i++) {
        const name = header[i];
        if (name) {
            index[name] = i;
        }
    }
    for (const col of columns) {
        if (index[col] === undefined) {
            index[col] = columns.indexOf(col) + 1;
        }
    }
    return index;
}

function cell(values: Array<string | undefined>, idx: number | undefined): string | undefined {
    if (idx === undefined) {
        return undefined;
    }
    const v = values[idx];
    return v === undefined || v === null ? undefined : String(v);
}

function nullableCell(values: Array<string | undefined>, idx: number | undefined): string | null {
    const v = cell(values, idx);
    return v === undefined || v.length === 0 ? null : v;
}

function stringCell(value: string | undefined): string {
    return value === undefined || value === null ? '' : String(value);
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
