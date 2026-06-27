export const EXCEL_DATA_DIR = './data';
export const EXCEL_NEWS_FILENAME = 'agritech-news.xlsx';
export const EXCEL_LOGS_FILENAME = 'agritech-logs.xlsx';
export const EXCEL_NEWS_SHEET_NAME = 'news';
export const EXCEL_LOGS_SHEET_NAME = 'logs';

/** Mirrors agritech.news columns. */
export const EXCEL_NEWS_COLUMNS = [
    'entry_key',
    'source_url',
    'source_id',
    'startup_name',
    'startup_website',
    'description',
    'news_summary',
    'entry_status',
    'discovered_at',
] as const;

/** Mirrors agritech.logs columns (Postgres id omitted). */
export const EXCEL_LOGS_COLUMNS = [
    'run_id',
    'source_id',
    'event',
    'url',
    'reason',
    'entry_key',
    'meta',
    'logged_at',
] as const;
