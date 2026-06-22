/** Application-wide defaults and shared literal values. */

export const MAX_ITEMS_SCANNED_PER_RUN_DEFAULT = 50;
export const MAX_NEW_ROWS_PER_RUN_DEFAULT = 20;
export const MAX_SECTIONS_PER_RUN_DEFAULT = 10;
export const AI_INPUT_MAX_CHARS_DEFAULT = 2000;
export const HTTP_FETCH_TIMEOUT_MS_DEFAULT = 30_000;
export const RUNS_DIR_DEFAULT = './data/runs';
export const URL_CONTENT_INDEX_PATH_DEFAULT = './data/url-content-index.json';
export const SECTION_SNAPSHOTS_PATH_DEFAULT = './data/section-snapshots.json';
export const AGRITECH_DEFAULT_INTERVAL_MS_DEFAULT = 604_800_000;
/** Default pause between sequential jobs in one orchestrator cycle (20 minutes). */
export const JOB_STAGGER_DELAY_MS_DEFAULT = 1_200_000;
export const AGRITECH_POSTGRES_SCHEMA_DEFAULT = 'agritech';

export const NEWS_ENTRY_KEY_PREFIX = 'agritech.news';
export const HTTP_USER_AGENT = 'agritech-tracker/0.1 (+https://github.com/agritech-tracker)';

/** Minimum HTML length before browser fallback is considered (bytes). */
export const PAGE_FETCH_MIN_HTML_BYTES = 500;
