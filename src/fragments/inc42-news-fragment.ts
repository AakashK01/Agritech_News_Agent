import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseFragment } from '../lib/fragment';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import { INC42_BROWSER_SESSION, INC42_SOURCE_ID } from '../constants/inc42';
import { isCompleteExtraction } from '../domain/extraction';
import type { IStartupNewsExtractor } from '../domain/types';
import { computeContentHash, computeNewsEntryId } from '../domain/dedup';
import type { RunContext, SourceRunLog } from '../domain/run-context';
import type { Inc42BrowserListingService } from '../integrations/inc42-browser-listing.service';
import type { AgentBrowserService } from '../integrations/agent-browser.service';
import { parseArticleFromSnapshot, snapshotIndicatesLoginRequired } from '../parsers/inc42-snapshot.parser';
import type { RunHistoryService } from '../persistence/run-history.service';
import { canonicalizeSourceUrl } from '../utils/url';

const LOG_PREFIX = 'Inc42NewsFragment';

function countNewRows(ctx: RunContext): number {
    return ctx.rows.filter((r) => r.entryStatus === 'new').length;
}

export class Inc42NewsFragment extends BaseFragment {
    constructor(
        id: string,
        private readonly appConfig: AgriTechConfig,
        private readonly agentBrowser: AgentBrowserService,
        private readonly browserListing: Inc42BrowserListingService | null,
        private readonly extractor: IStartupNewsExtractor | null,
        private readonly runHistory: RunHistoryService,
    ) {
        super(id);
    }

    protected async execute(): Promise<void> {
        if (!this.appConfig.AGRITECH_INC42_ENABLED) {
            logger.info(`${LOG_PREFIX} disabled via AGRITECH_INC42_ENABLED=false`);
            return;
        }

        if (this.appConfig.AGRITECH_AI_ENABLED && !this.extractor) {
            logger.warn(`${LOG_PREFIX} skipped — AI enabled but Ollama extractor not configured`);
            return;
        }

        const ctx = this.runHistory.beginRun();
        const sourceLog = ctx.startSourceLog(INC42_SOURCE_ID);

        if (!this.browserListing) {
            logger.warn(`${LOG_PREFIX} skipped — Inc42 browser listing not configured (AGRITECH_INC42_BROWSER_ENABLED=false)`);
            return;
        }

        const result = await this.browserListing.fetchListingLinks(
            'https://inc42.com/industry/agritech/',
        );

        if (result.loginRequired) {
            throw new Error('inc42_login_required — run: npm run inc42:login to sign in, then re-run');
        }

        sourceLog.sectionsChecked = 1;

        for (const link of result.articleLinks) {
            if (sourceLog.articlesScanned >= this.appConfig.MAX_ITEMS_SCANNED_PER_RUN) break;
            if (countNewRows(ctx) >= this.appConfig.MAX_NEW_ROWS_PER_RUN) break;

            sourceLog.articlesScanned++;
            await this.processArticle(link, ctx, sourceLog);
        }

        const summary = await this.runHistory.completeRun(ctx);
        logger.info(`${LOG_PREFIX} run complete`, {
            runId: ctx.runId,
            newRows: summary.totals.new,
            updatedRows: summary.totals.updated,
            excelPath: summary.excelPath,
        });
    }

    private async processArticle(
        url: string,
        ctx: RunContext,
        sourceLog: SourceRunLog,
    ): Promise<void> {
        const canonical = canonicalizeSourceUrl(url);

        const sessionId = INC42_BROWSER_SESSION;
        const profileCwd = path.resolve(process.cwd(), this.appConfig.AGRITECH_PROFILES_ROOT, sessionId);
        await fs.mkdir(profileCwd, { recursive: true });

        let snapshot: string;
        try {
            await this.agentBrowser.openUrlAndWaitForLoad(sessionId, profileCwd, canonical);
            snapshot = await this.agentBrowser.snapshot(sessionId, profileCwd);
        } catch (err: unknown) {
            const reason = `article_fetch: ${err instanceof Error ? err.message : String(err)}`;
            sourceLog.error(canonical, reason);
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'error', url: canonical, reason });
            return;
        }

        if (snapshotIndicatesLoginRequired(snapshot)) {
            sourceLog.error(canonical, 'login_required');
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'error', url: canonical, reason: 'login_required' });
            return;
        }

        const { title, bodyExcerpt } = parseArticleFromSnapshot(snapshot, this.appConfig.AI_INPUT_MAX_CHARS);

        if (!title) {
            sourceLog.skip(canonical, 'missing_title');
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'skipped', url: canonical, reason: 'missing_title' });
            return;
        }
        if (!bodyExcerpt.trim()) {
            sourceLog.skip(canonical, 'empty_body');
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'skipped', url: canonical, reason: 'empty_body' });
            return;
        }

        const contentHash = computeContentHash(title, bodyExcerpt);
        const entryKey = computeNewsEntryId(canonical, contentHash);

        if (ctx.seenEntryKeys.has(entryKey)) {
            sourceLog.skip(canonical, 'duplicate_in_run');
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'skipped', url: canonical, reason: 'duplicate_in_run' });
            return;
        }
        ctx.seenEntryKeys.add(entryKey);

        if (!this.appConfig.AGRITECH_AI_ENABLED || !this.extractor) {
            sourceLog.skip(canonical, 'ai_disabled');
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'skipped', url: canonical, reason: 'ai_disabled' });
            return;
        }

        const extracted = await this.extractor.extract({ title, bodyExcerpt, sourceUrl: canonical });

        if (extracted.extractionFailed) {
            sourceLog.error(canonical, 'ollama_extraction_failed');
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'error', url: canonical, reason: 'ollama_extraction_failed' });
            return;
        }

        if (!extracted.isRelevant) {
            sourceLog.notRelevant(canonical);
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'not_relevant', url: canonical });
            return;
        }

        if (!isCompleteExtraction(extracted)) {
            sourceLog.error(canonical, 'incomplete_extraction');
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'error', url: canonical, reason: 'incomplete_extraction' });
            return;
        }

        ctx.bufferRow({
            entryKey,
            sourceUrl: canonical,
            startupName: extracted.startupName,
            startupWebsite: extracted.startupWebsite,
            description: extracted.description,
            newsSummary: extracted.newsSummary,
            sourceId: INC42_SOURCE_ID,
            entryStatus: 'new',
            contentHash,
            discoveredAt: new Date().toISOString(),
        });

        sourceLog.record(canonical, 'new', entryKey);
        await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'new', url: canonical, entryKey });
    }
}
