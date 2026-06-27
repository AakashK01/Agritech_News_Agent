import path from 'node:path';
import { BaseFragment } from '../lib/fragment';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import {
    INC42_ARTICLE_DEBUG_PAUSE_MS,
    INC42_ARTICLE_MIN_BODY_CHARS,
    INC42_ARTICLE_SETTLE_MS,
    INC42_ARTICLE_SNAPSHOT_MAX_RETRIES,
} from '../constants/inc42-browser';
import { INC42_BROWSER_SESSION, INC42_SOURCE_ID } from '../constants/inc42';
import { isCompleteExtraction } from '../domain/extraction';
import type { IStartupNewsExtractor } from '../domain/types';
import { computeContentHash, computeNewsEntryId } from '../domain/dedup';
import type { RunContext, SourceRunLog } from '../domain/run-context';
import type { Inc42BrowserListingService } from '../integrations/inc42-browser-listing.service';
import type { AgentBrowserService } from '../integrations/agent-browser.service';
import {
    isArticleSnapshotComplete,
    parseArticleFromSnapshot,
    snapshotIndicatesLoginRequired,
} from '../parsers/inc42-snapshot.parser';
import type { RunHistoryService } from '../persistence/run-history.service';
import { canonicalizeSourceUrl } from '../utils/url';

const LOG_PREFIX = 'Inc42NewsFragment';

function countWords(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return 0;
    }
    return trimmed.split(/\s+/).length;
}

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

        const sessionId = INC42_BROWSER_SESSION;
        const profileCwd = path.resolve(process.cwd(), this.appConfig.AGRITECH_PROFILES_ROOT, sessionId);

        try {
            const result = await this.browserListing.fetchListingLinks(
                'https://inc42.com/industry/agritech/',
            );

            if (result.loginRequired) {
                throw new Error('inc42_login_required — run: npm run inc42:login to sign in, then re-run');
            }

            sourceLog.sectionsChecked = 1;

            const linksToProcess = await this.runHistory.filterFreshUrls(result.articleLinks);
            logger.info(`${LOG_PREFIX} starting article processing`, {
                totalCollected: result.articleLinks.length,
                freshLinks: linksToProcess.length,
                alreadyKnown: result.articleLinks.length - linksToProcess.length,
            });

            if (linksToProcess.length === 0 && result.articleLinks.length > 0) {
                logger.info(`${LOG_PREFIX} all collected URLs already in database — skipping article fetch`);
            }

            for (const link of linksToProcess) {
                if (sourceLog.articlesScanned >= this.appConfig.MAX_ITEMS_SCANNED_PER_RUN) break;
                if (countNewRows(ctx) >= this.appConfig.MAX_NEW_ROWS_PER_RUN) break;

                sourceLog.articlesScanned++;
                logger.info(`${LOG_PREFIX} processing article`, {
                    url: link,
                    index: sourceLog.articlesScanned,
                    of: linksToProcess.length,
                });
                await this.agentBrowser.ensureListingTabOnly(sessionId, profileCwd);
                await this.processArticle(link, ctx, sourceLog, sessionId, profileCwd);
            }

            const summary = await this.runHistory.completeRun(ctx);
            logger.info(`${LOG_PREFIX} run complete`, {
                runId: ctx.runId,
                articlesScanned: summary.totals.articlesScanned,
                newRows: summary.totals.new,
                updatedRows: summary.totals.updated,
                excelPaths: summary.excelPaths,
            });
        } finally {
            await this.agentBrowser.closeSession(sessionId, profileCwd).catch(() => undefined);
        }
    }

    private async processArticle(
        url: string,
        ctx: RunContext,
        sourceLog: SourceRunLog,
        sessionId: string,
        profileCwd: string,
    ): Promise<void> {
        const canonical = canonicalizeSourceUrl(url);

        let title = '';
        let bodyExcerpt = '';
        let articleTabOpened = false;
        let articleTabIndex: number | undefined;
        let lastSnapshot = '';

        try {
            try {
                articleTabIndex = await this.agentBrowser.openArticleInNewTab(sessionId, profileCwd, canonical);
                articleTabOpened = true;

                for (let attempt = 1; attempt <= INC42_ARTICLE_SNAPSHOT_MAX_RETRIES; attempt++) {
                    const snapshot = await this.agentBrowser.snapshot(sessionId, profileCwd);
                    lastSnapshot = snapshot;

                    if (snapshotIndicatesLoginRequired(snapshot)) {
                        logger.warn(`${LOG_PREFIX} login required on article page`, { url: canonical });
                        sourceLog.error(canonical, 'login_required');
                        await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, {
                            event: 'error',
                            url: canonical,
                            reason: 'login_required',
                        });
                        return;
                    }

                    const parsed = parseArticleFromSnapshot(snapshot, this.appConfig.AI_INPUT_MAX_CHARS);
                    title = parsed.title;
                    bodyExcerpt = parsed.bodyExcerpt;

                    if (isArticleSnapshotComplete(title, bodyExcerpt, INC42_ARTICLE_MIN_BODY_CHARS)) {
                        break;
                    }

                    if (attempt < INC42_ARTICLE_SNAPSHOT_MAX_RETRIES) {
                        logger.info(`${LOG_PREFIX} snapshot incomplete — retrying`, {
                            url: canonical,
                            attempt,
                            titleLength: title.length,
                            bodyLength: bodyExcerpt.trim().length,
                        });
                        await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_ARTICLE_SETTLE_MS);
                    }
                }

                logger.info(`${LOG_PREFIX} [debug] snapshot content`, {
                    url: canonical,
                    snapshotChars: lastSnapshot.length,
                    snapshotWords: countWords(lastSnapshot),
                    titleChars: title.length,
                    titleWords: countWords(title),
                    bodyChars: bodyExcerpt.length,
                    bodyWords: countWords(bodyExcerpt),
                });
                await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_ARTICLE_DEBUG_PAUSE_MS);
            } catch (err: unknown) {
                const reason = `article_fetch: ${err instanceof Error ? err.message : String(err)}`;
                logger.warn(`${LOG_PREFIX} article fetch failed`, { url: canonical, reason });
                sourceLog.error(canonical, reason);
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'error', url: canonical, reason });
                return;
            } finally {
                if (articleTabOpened) {
                    try {
                        await this.agentBrowser.closeArticleTab(
                            sessionId,
                            profileCwd,
                            articleTabIndex,
                        );
                    } catch (err: unknown) {
                        logger.warn(`${LOG_PREFIX} failed to close article tab`, {
                            url: canonical,
                            articleTabIndex,
                            reason: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }

            if (!title) {
                logger.warn(`${LOG_PREFIX} missing title in snapshot`, { url: canonical });
                sourceLog.skip(canonical, 'missing_title');
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, {
                    event: 'skipped',
                    url: canonical,
                    reason: 'missing_title',
                });
                return;
            }
            if (!isArticleSnapshotComplete(title, bodyExcerpt, INC42_ARTICLE_MIN_BODY_CHARS)) {
                logger.warn(`${LOG_PREFIX} empty or incomplete body in snapshot`, {
                    url: canonical,
                    title,
                    bodyLength: bodyExcerpt.trim().length,
                });
                sourceLog.skip(canonical, 'empty_body');
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, {
                    event: 'skipped',
                    url: canonical,
                    reason: 'empty_body',
                });
                return;
            }

            logger.info(`${LOG_PREFIX} article fetched`, { url: canonical, title });

            const contentHash = computeContentHash(title, bodyExcerpt);
            const entryKey = computeNewsEntryId(canonical, contentHash);

            if (ctx.seenEntryKeys.has(entryKey)) {
                logger.warn(`${LOG_PREFIX} duplicate in run`, { url: canonical, entryKey });
                sourceLog.skip(canonical, 'duplicate_in_run');
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, {
                    event: 'skipped',
                    url: canonical,
                    reason: 'duplicate_in_run',
                });
                return;
            }
            ctx.seenEntryKeys.add(entryKey);

            if (!this.appConfig.AGRITECH_AI_ENABLED || !this.extractor) {
                logger.warn(`${LOG_PREFIX} AI disabled — skipping extraction`, { url: canonical });
                sourceLog.skip(canonical, 'ai_disabled');
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, {
                    event: 'skipped',
                    url: canonical,
                    reason: 'ai_disabled',
                });
                return;
            }

            const extracted = await this.extractor.extract({ title, bodyExcerpt, sourceUrl: canonical });

            logger.info(`${LOG_PREFIX} [debug] ollama output`, {
                url: canonical,
                extractionFailed: extracted.extractionFailed,
                isRelevant: extracted.isRelevant,
                startupNameChars: extracted.startupName?.length ?? 0,
                startupNameWords: countWords(extracted.startupName ?? ''),
                startupWebsiteChars: extracted.startupWebsite?.length ?? 0,
                descriptionChars: extracted.description?.length ?? 0,
                descriptionWords: countWords(extracted.description ?? ''),
                newsSummaryChars: extracted.newsSummary?.length ?? 0,
                newsSummaryWords: countWords(extracted.newsSummary ?? ''),
            });

            if (extracted.extractionFailed) {
                logger.warn(`${LOG_PREFIX} Ollama extraction failed`, { url: canonical, title });
                sourceLog.error(canonical, 'ollama_extraction_failed');
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, {
                    event: 'error',
                    url: canonical,
                    reason: 'ollama_extraction_failed',
                });
                return;
            }

            if (!extracted.isRelevant) {
                logger.warn(`${LOG_PREFIX} not relevant`, { url: canonical, title });
                sourceLog.notRelevant(canonical);
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'not_relevant', url: canonical });
                return;
            }

            if (!isCompleteExtraction(extracted)) {
                logger.warn(`${LOG_PREFIX} incomplete extraction`, { url: canonical, title });
                sourceLog.error(canonical, 'incomplete_extraction');
                await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, {
                    event: 'error',
                    url: canonical,
                    reason: 'incomplete_extraction',
                });
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

            logger.info(`${LOG_PREFIX} new row buffered`, {
                url: canonical,
                startupName: extracted.startupName,
                entryKey,
            });
            sourceLog.record(canonical, 'new', entryKey);
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'new', url: canonical, entryKey });
        } catch (err: unknown) {
            const reason = err instanceof Error ? err.message : String(err);
            logger.warn(`${LOG_PREFIX} unexpected article processing error`, { url: canonical, reason });
            sourceLog.error(canonical, reason);
            await this.runHistory.logEvent(ctx, INC42_SOURCE_ID, { event: 'error', url: canonical, reason });
        }
    }
}
