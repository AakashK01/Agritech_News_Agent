import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgriTechConfig } from '../config/app-config';
import type { StartupNewsRow } from '../domain/types';
import { buildRunDate, buildRunId, RunContext } from '../domain/run-context';
import type { SourceRunLog, SourceRunStats } from '../domain/run-context';
import type { PostgresStore } from './postgres-store.repository';
import { ExcelStoreService } from './excel-store.service';
import type { SectionSnapshotMap } from './section-snapshot.service';
import { SectionSnapshotService } from './section-snapshot.service';
import { UrlContentIndexService } from './url-content-index.service';

export interface RunSummary {
    runId: string;
    runDate: string;
    startedAt: string;
    completedAt: string;
    storage: { excel: boolean; postgres: boolean };
    excelPath: string | null;
    totals: SourceRunStats;
    sources: Array<{ id: string } & SourceRunStats>;
}

export class RunHistoryService {
    constructor(
        private readonly config: AgriTechConfig,
        private readonly excelStore: ExcelStoreService,
        private readonly urlIndexService: UrlContentIndexService,
        private readonly sectionSnapshotService: SectionSnapshotService,
        private readonly postgres: PostgresStore | null,
    ) {}

    beginRun(): RunContext {
        const now = new Date();
        const runId = buildRunId(now);
        const runDate = buildRunDate(now);
        const runDir = path.resolve(process.cwd(), this.config.AGRITECH_RUNS_DIR, runDate);
        return new RunContext(runId, runDate, runDir, now.toISOString());
    }

    async prepareRun(ctx: RunContext): Promise<void> {
        ctx.urlIndex = await this.urlIndexService.load();

        for (const [url, rec] of ctx.urlIndex.entries()) {
            if (rec.extractionComplete === false) {
                ctx.urlsNeedingReextract.add(url);
            }
        }

        if (this.config.AGRITECH_POSTGRES_ENABLED && this.postgres) {
            const incomplete = await this.postgres.loadIncompleteNewsUrls();
            for (const url of incomplete) {
                ctx.urlsNeedingReextract.add(url);
            }
        }
    }

    async completeRun(ctx: RunContext, sectionSnapshots: SectionSnapshotMap): Promise<RunSummary> {
        const startedAt = ctx.startedAt;
        const completedAt = new Date().toISOString();

        let excelPath: string | null = null;
        if (this.config.AGRITECH_EXCEL_ENABLED) {
            excelPath = await this.excelStore.createWorkbook(ctx.runDir, ctx.rows);
        }

        if (this.config.AGRITECH_POSTGRES_ENABLED && this.postgres) {
            await this.postgres.upsertNews(ctx.rows);
        }

        await this.urlIndexService.persist(ctx.urlIndex);
        await this.sectionSnapshotService.persist(sectionSnapshots);

        const logsDir = path.join(ctx.runDir, 'logs');
        await fs.mkdir(logsDir, { recursive: true });

        const sourceSummaries: Array<{ id: string } & SourceRunStats> = [];
        let totals: SourceRunStats = emptyStats();
        const unifiedLog: Array<Record<string, unknown>> = [];

        for (const [sourceId, log] of ctx.iterateSourceLogs()) {
            const counts = log.counts();
            sourceSummaries.push({ id: sourceId, ...counts });
            totals = mergeStats(totals, counts);
            for (const entry of log.entries) {
                unifiedLog.push({ sourceId, ...entry });
            }
        }

        await fs.writeFile(path.join(logsDir, 'crawl.json'), JSON.stringify(unifiedLog, null, 2), 'utf8');

        const summary: RunSummary = {
            runId: ctx.runId,
            runDate: ctx.runDate,
            startedAt,
            completedAt,
            storage: {
                excel: this.config.AGRITECH_EXCEL_ENABLED,
                postgres: this.config.AGRITECH_POSTGRES_ENABLED,
            },
            excelPath,
            totals,
            sources: sourceSummaries,
        };

        await fs.writeFile(path.join(ctx.runDir, 'run-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
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
