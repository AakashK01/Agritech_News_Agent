export type SectionPriority = 'high' | 'medium' | 'low';

export interface SectionSeed {
    id: string;
    url: string;
    priority: SectionPriority;
}

export type EntryStatus = 'new' | 'updated';

export type CrawlLogEvent = 'new' | 'updated' | 'skipped' | 'not_relevant' | 'error' | 'run_complete';

export interface CrawlLogEntry {
    runId: string;
    sourceId: string;
    event: CrawlLogEvent;
    url?: string | null;
    reason?: string | null;
    entryKey?: string | null;
    meta?: Record<string, unknown> | null;
}

export interface StartupNewsRow {
    entryKey: string;
    sourceUrl: string;
    startupName: string | null;
    startupWebsite: string | null;
    description: string | null;
    newsSummary: string | null;
    sourceId: string;
    entryStatus: EntryStatus;
    contentHash: string;
    discoveredAt: string;
}

export interface StartupNewsExtractResult {
    isRelevant: boolean;
    startupName: string | null;
    startupWebsite: string | null;
    description: string | null;
    newsSummary: string | null;
    /** Ollama call failed (timeout, parse error, etc.) — distinct from not_relevant. */
    extractionFailed?: boolean;
}

export interface StartupNewsExtractInput {
    title: string;
    bodyExcerpt: string;
    sourceUrl: string;
}

export interface IStartupNewsExtractor {
    extract(input: StartupNewsExtractInput): Promise<StartupNewsExtractResult>;
}
