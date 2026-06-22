import type { StartupNewsRow } from './types';

export type SourceLogAction =
    | 'new'
    | 'updated'
    | 'skipped'
    | 'not_relevant'
    | 'section_unchanged'
    | 'error';

export interface SourceLogEntry {
    url: string;
    action: SourceLogAction;
    at: string;
    reason?: string;
    entryKey?: string;
}

export interface SourceRunStats {
    sectionsChecked: number;
    sectionsSkipped: number;
    articlesScanned: number;
    new: number;
    updated: number;
    skipped: number;
    notRelevant: number;
    errors: number;
    durationMs: number;
}

export class SourceRunLog {
    readonly entries: SourceLogEntry[] = [];
    sectionsChecked = 0;
    sectionsSkipped = 0;
    articlesScanned = 0;
    newCount = 0;
    updatedCount = 0;
    skippedCount = 0;
    notRelevantCount = 0;
    errorCount = 0;
    private readonly startedAt = Date.now();

    skipSection(sectionUrl: string, reason: string): void {
        this.sectionsSkipped++;
        this.entries.push({
            url: sectionUrl,
            action: 'section_unchanged',
            at: new Date().toISOString(),
            reason,
        });
    }

    skip(url: string, reason: string): void {
        this.skippedCount++;
        this.entries.push({ url, action: 'skipped', at: new Date().toISOString(), reason });
    }

    notRelevant(url: string): void {
        this.notRelevantCount++;
        this.entries.push({ url, action: 'not_relevant', at: new Date().toISOString() });
    }

    error(url: string, reason: string): void {
        this.errorCount++;
        this.entries.push({ url, action: 'error', at: new Date().toISOString(), reason });
    }

    record(url: string, status: 'new' | 'updated', entryKey: string): void {
        if (status === 'new') {
            this.newCount++;
        } else {
            this.updatedCount++;
        }
        this.entries.push({ url, action: status, at: new Date().toISOString(), entryKey });
    }

    counts(): SourceRunStats {
        return {
            sectionsChecked: this.sectionsChecked,
            sectionsSkipped: this.sectionsSkipped,
            articlesScanned: this.articlesScanned,
            new: this.newCount,
            updated: this.updatedCount,
            skipped: this.skippedCount,
            notRelevant: this.notRelevantCount,
            errors: this.errorCount,
            durationMs: Date.now() - this.startedAt,
        };
    }
}

export class RunContext {
    readonly runId: string;
    readonly runDate: string;
    readonly runDir: string;
    readonly startedAt: string;
    readonly rows: StartupNewsRow[] = [];
    readonly seenEntryKeys = new Set<string>();
    /** URLs with missing summaries in storage or failed prior extraction — re-process even if content unchanged. */
    readonly urlsNeedingReextract = new Set<string>();
    urlIndex: Map<string, { contentHash: string; lastSeenAt: string; lastRunId?: string; extractionComplete?: boolean }> = new Map();
    private sourceLogs = new Map<string, SourceRunLog>();

    constructor(runId: string, runDate: string, runDir: string, startedAt: string) {
        this.runId = runId;
        this.runDate = runDate;
        this.runDir = runDir;
        this.startedAt = startedAt;
    }

    startSourceLog(sourceId: string): SourceRunLog {
        const log = new SourceRunLog();
        this.sourceLogs.set(sourceId, log);
        return log;
    }

    getSourceLog(sourceId: string): SourceRunLog | undefined {
        return this.sourceLogs.get(sourceId);
    }

    *iterateSourceLogs(): Generator<[string, SourceRunLog]> {
        for (const [sourceId, log] of this.sourceLogs) {
            yield [sourceId, log];
        }
    }

    bufferRow(row: StartupNewsRow): void {
        this.rows.push(row);
    }
}

export function buildRunId(now = new Date()): string {
    return now.toISOString().replace(/[:.]/g, '-');
}

export function buildRunDate(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}
