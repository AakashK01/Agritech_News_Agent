import type { AgriTechConfig } from '../config/app-config';
import type { StartupNewsRow } from '../domain/types';
import { buildRunDate, buildRunId, RunContext } from '../domain/run-context';
import type { SourceRunStats } from '../domain/run-context';
import type { PostgresStore, LogEntry } from './postgres-store.repository';
import { ExcelStoreService } from './excel-store.service';

export interface RunSummary {
    runId: string;
    runDate: string;
    startedAt: string;
    completedAt: string;
    storage: { excel: boolean; postgres: boolean };
    excelPaths: { news: string; logs: string } | null;
    totals: SourceRunStats;
    sources: Array<{ id: string } & SourceRunStats>;
}

export class RunHistoryService {
    constructor(
        private readonly config: AgriTechConfig,
        private readonly excelStore: ExcelStoreService,
        private readonly postgres: PostgresStore | null,
    ) {}

    beginRun(): RunContext {
        const now = new Date();
        const runId = buildRunId(now);
        const runDate = buildRunDate(now);
        const runDir = `${this.config.AGRITECH_RUNS_DIR}/${runDate}`;
        return new RunContext(runId, runDate, runDir, now.toISOString());
    }

    /** Returns URLs from the input that are not already stored in agritech.news. */
    async filterFreshUrls(urls: string[]): Promise<string[]> {
        if (!this.postgres) {
            return urls;
        }
        return this.postgres.filterKnownUrls(urls);
    }

    /** Logs an article-level event to agritech.logs and buffers for Excel. */
    async logEvent(
        ctx: RunContext,
        sourceId: string,
        entry: Omit<LogEntry, 'runId' | 'sourceId'>,
    ): Promise<void> {
        const fullEntry: LogEntry = { runId: ctx.runId, sourceId, ...entry };
        ctx.pendingLogs.push(fullEntry);

        if (!this.postgres) {
            return;
        }
        await this.postgres.insertLog(fullEntry).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[RunHistoryService] insertLog failed: ${msg}`);
        });
    }

    async completeRun(ctx: RunContext): Promise<RunSummary> {
        const startedAt = ctx.startedAt;
        const completedAt = new Date().toISOString();

        const sourceSummaries: Array<{ id: string } & SourceRunStats> = [];
        let totals: SourceRunStats = emptyStats();

        for (const [sourceId, log] of ctx.iterateSourceLogs()) {
            const counts = log.counts();
            sourceSummaries.push({ id: sourceId, ...counts });
            totals = mergeStats(totals, counts);
        }

        const summary: RunSummary = {
            runId: ctx.runId,
            runDate: ctx.runDate,
            startedAt,
            completedAt,
            storage: {
                excel: this.config.AGRITECH_EXCEL_ENABLED,
                postgres: this.config.AGRITECH_POSTGRES_ENABLED,
            },
            excelPaths: null,
            totals,
            sources: sourceSummaries,
        };

        const runCompleteEntry: LogEntry = {
            runId: ctx.runId,
            sourceId: 'orchestrator',
            event: 'run_complete',
            meta: summary as unknown as Record<string, unknown>,
        };

        if (this.postgres) {
            await this.postgres.insertLog(runCompleteEntry).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[RunHistoryService] run_complete log failed: ${msg}`);
            });
        }

        if (this.config.AGRITECH_EXCEL_ENABLED) {
            const newsPath = await this.excelStore.upsertNewsFile(ctx.rows);
            const logsPath = await this.excelStore.appendLogsFile([...ctx.pendingLogs, runCompleteEntry]);
            summary.excelPaths = { news: newsPath, logs: logsPath };
        }

        if (this.config.AGRITECH_POSTGRES_ENABLED && this.postgres) {
            await this.postgres.upsertNews(ctx.rows);
        }

        return summary;
    }
}

function emptyStats(): SourceRunStats {
    return {
        sectionsChecked: 0,
        sectionsSkipped: 0,
        articlesScanned: 0,
        new: 0,
        updated: 0,
        skipped: 0,
        notRelevant: 0,
        errors: 0,
        durationMs: 0,
    };
}

function mergeStats(a: SourceRunStats, b: SourceRunStats): SourceRunStats {
    return {
        sectionsChecked: a.sectionsChecked + b.sectionsChecked,
        sectionsSkipped: a.sectionsSkipped + b.sectionsSkipped,
        articlesScanned: a.articlesScanned + b.articlesScanned,
        new: a.new + b.new,
        updated: a.updated + b.updated,
        skipped: a.skipped + b.skipped,
        notRelevant: a.notRelevant + b.notRelevant,
        errors: a.errors + b.errors,
        durationMs: a.durationMs + b.durationMs,
    };
}

export type { StartupNewsRow };
