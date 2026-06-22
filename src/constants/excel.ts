export const EXCEL_WORKBOOK_FILENAME = 'agritech-startups.xlsx';
export const EXCEL_SHEET_NAME = 'startups';

/** Assignment-facing columns only — no internal dedup ids in the export. */
export const EXCEL_COLUMNS = [
    'startup_name',
    'source_url',
    'startup_website',
    'description',
    'news_summary',
    'source_id',
    'entry_status',
    'discovered_at',
] as const;
