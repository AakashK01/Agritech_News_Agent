export const SERVICE_NAMES = {
    CONFIG: 'config',
    PROFILE_LOCK: 'profileLock',
    AGENT_BROWSER: 'agentBrowser',
    PAGE_FETCH: 'pageFetch',
    STARTUP_EXTRACTOR: 'startupExtractor',
    EXCEL_STORE: 'excelStore',
    POSTGRES_STORE: 'postgresStore',
    RUN_HISTORY: 'runHistory',
    AGFUNDER_JOB_MANAGER: 'agfunderJobManager',
    INC42_JOB_MANAGER: 'inc42JobManager',
    INC42_BROWSER_LISTING: 'inc42BrowserListing',
} as const;

export type ServiceName = (typeof SERVICE_NAMES)[keyof typeof SERVICE_NAMES];
