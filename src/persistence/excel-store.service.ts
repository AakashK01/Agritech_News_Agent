import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EXCEL_COLUMNS, EXCEL_SHEET_NAME, EXCEL_WORKBOOK_FILENAME } from '../constants/excel';
import type { StartupNewsRow } from '../domain/types';

export class ExcelStoreService {
    async createWorkbook(runDir: string, rows: StartupNewsRow[]): Promise<string> {
        const outPath = path.join(runDir, EXCEL_WORKBOOK_FILENAME);
        await fs.mkdir(runDir, { recursive: true });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(EXCEL_SHEET_NAME);
        sheet.addRow([...EXCEL_COLUMNS]);

        for (const row of rows) {
            sheet.addRow([
                row.startupName ?? '',
                row.sourceUrl,
                row.startupWebsite ?? '',
                row.description ?? '',
                row.newsSummary ?? '',
                row.sourceId,
                row.entryStatus,
                row.discoveredAt,
            ]);
        }

        await workbook.xlsx.writeFile(outPath);
        return outPath;
    }
}
