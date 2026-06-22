import { BaseFragment } from '../lib/fragment';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import { INC42_BROWSER_SESSION, INC42_SECTION_SEEDS, INC42_SOURCE_ID, type Inc42SectionSeed } from '../constants/inc42';
import { isCompleteExtraction } from '../domain/extraction';
import type { IStartupNewsExtractor } from '../domain/types';
import { computeContentHash, computeNewsEntryId, hashArticleLinkList } from '../domain/dedup';
import type { RunContext, SourceRunLog } from '../domain/run-context';
import type { Inc42BrowserListingService } from '../integrations/inc42-browser-listing.service';
import type { PageFetchService } from '../integrations/page-fetch.service';
import { inc42Parser } from '../parsers/inc42.parser';
import type { RunHistoryService } from '../persistence/run-history.service';
import type { SectionSnapshotMap, SectionSnapshotService } from '../persistence/section-snapshot.service';
import type { UrlContentRecord } from '../persistence/url-content-index.service';
import { canonicalizeSourceUrl } from '../utils/url';

const LOG_PREFIX = 'Inc42NewsFragment';

function countNewRows(ctx: RunContext): number {
    return ctx.rows.filter((r) => r.entryStatus === 'new').length;
}

export class Inc42NewsFragment extends BaseFragment {
    constructor(
        id: string,
        private readonly appConfig: AgriTechConfig,
        private readonly pageFetch: PageFetchService,
        private readonly browserListing: Inc42BrowserListingService | null,
        private readonly extractor: IStartupNewsExtractor | null,
        private readonly runHistory: RunHistoryService,
        private readonly sectionSnapshotService: SectionSnapshotService,
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
        await this.runHistory.prepareRun(ctx);
        const sectionSnapshots = await this.sectionSnapshotService.load();

        if (ctx.urlsNeedingReextract.size > 0) {
            logger.info(`${LOG_PREFIX} will re-extract ${ctx.urlsNeedingReextract.size} article(s) with incomplete data`);
        }

        const sourceLog = ctx.startSourceLog(INC42_SOURCE_ID);
        const sections = INC42_SECTION_SEEDS.slice(0, this.appConfig.MAX_SECTIONS_PER_RUN);

        for (const section of sections) {
            sourceLog.sectionsChecked++;
            await this.processSection(section, ctx, sourceLog, sectionSnapshots);
        }

        for (const url of [...ctx.urlsNeedingReextract]) {
            if (sourceLog.articlesScanned >= this.appConfig.MAX_ITEMS_SCANNED_PER_RUN) break;
            if (countNewRows(ctx) >= this.appConfig.MAX_NEW_ROWS_PER_RUN) break;

            sourceLog.articlesScanned++;
            await this.processArticle(url, ctx, sourceLog);
        }

        const summary = await this.runHistory.completeRun(ctx, sectionSnapshots);
        logger.info(`${LOG_PREFIX} run complete`, {
            runId: ctx.runId,
            newRows: summary.totals.new,
            updatedRows: summary.totals.updated,
            excelPath: summary.excelPath,
        });
    }

    private async processSection(
        section: Inc42SectionSeed,
        ctx: RunContext,
        sourceLog: SourceRunLog,
        sectionSnapshots: SectionSnapshotMap,
    ): Promise<void> {
        let articleLinks: string[];
        try {
            articleLinks = await this.fetchSectionLinks(section);
        } catch (err: unknown) {
            sourceLog.error(section.url, `section_fetch: ${errorMessage(err)}`);
            return;
        }

        const linkListHash = hashArticleLinkList(articleLinks);
        const prevSection = sectionSnapshots.get(section.url);
        const sectionUnchanged = prevSection?.contentHash === linkListHash;

        const linksToProcess = sectionUnchanged
            ? articleLinks.filter((link) => ctx.urlsNeedingReextract.has(canonicalizeSourceUrl(link)))
            : articleLinks;

        if (sectionUnchanged && linksToProcess.length === 0) {
            sourceLog.skipSection(section.url, 'unchanged');
            return;
        }

        for (const link of linksToProcess) {
            if (sourceLog.articlesScanned >= this.appConfig.MAX_ITEMS_SCANNED_PER_RUN) break;
            if (countNewRows(ctx) >= this.appConfig.MAX_NEW_ROWS_PER_RUN) break;

            sourceLog.articlesScanned++;
            await this.processArticle(link, ctx, sourceLog);
        }

        sectionSnapshots.set(section.url, {
            contentHash: linkListHash,
            lastCheckedAt: new Date().toISOString(),
        });
    }

    private async fetchSectionLinks(section: Inc42SectionSeed): Promise<string[]> {
        if (section.fetchMode === 'http') {
            const html = await this.pageFetch.getPageHtml(section.url, INC42_BROWSER_SESSION);
            return inc42Parser.parseListingLinks(html, section.url);
        }

        if (!this.browserListing) {
            throw new Error(
                'Inc42 browser listing requires agent-browser — set AGRITECH_INC42_BROWSER_ENABLED=true and ensure profiles/inc42 is configured',
            );
        }

        const result = await this.browserListing.fetchListingLinks(section.url);
        if (result.loginRequired) {
            throw new Error('inc42_login_required — open profiles/inc42 in headed mode and sign in manually');
        }
        return result.articleLinks;
    }

    private async processArticle(
        url: string,
        ctx: RunContext,
        sourceLog: SourceRunLog,
    ): Promise<void> {
        const canonical = canonicalizeSourceUrl(url);
        const prev = ctx.urlIndex.get(canonical);
        const needsReextract = ctx.urlsNeedingReextract.has(canonical);

        let articleHtml: string;
        try {
            articleHtml = await this.pageFetch.getPageHtml(canonical, INC42_BROWSER_SESSION);
        } catch (err: unknown) {
            sourceLog.error(canonical, `article_fetch: ${errorMessage(err)}`);
            return;
        }

        const { title, bodyExcerpt } = inc42Parser.parseArticle(articleHtml, this.appConfig.AI_INPUT_MAX_CHARS);
        if (!title) {
            sourceLog.skip(canonical, 'missing_title');
            return;
        }
        if (!bodyExcerpt.trim()) {
            sourceLog.skip(canonical, 'empty_body');
            return;
        }

        const contentHash = computeContentHash(title, bodyExcerpt);
        if (prev?.contentHash === contentHash && !needsReextract) {
            sourceLog.skip(canonical, 'exact_duplicate');
            return;
        }

        const entryKey = computeNewsEntryId(canonical, contentHash);
        if (ctx.seenEntryKeys.has(entryKey)) {
            sourceLog.skip(canonical, 'duplicate_in_run');
            return;
        }
        ctx.seenEntryKeys.add(entryKey);

        if (!this.appConfig.AGRITECH_AI_ENABLED || !this.extractor) {
            sourceLog.skip(canonical, 'ai_disabled');
            return;
        }

        const extracted = await this.extractor.extract({ title, bodyExcerpt, sourceUrl: canonical });

        if (extracted.extractionFailed) {
            sourceLog.error(canonical, 'ollama_extraction_failed');
            return;
        }

        if (!extracted.isRelevant) {
            sourceLog.notRelevant(canonical);
            this.markUrlIndex(ctx, canonical, contentHash, ctx.runId, true);
            return;
        }

        if (!isCompleteExtraction(extracted)) {
            sourceLog.error(canonical, 'incomplete_extraction');
            this.markUrlIndex(ctx, canonical, contentHash, ctx.runId, false);
            return;
        }

        const status = prev || needsReextract ? 'updated' : 'new';
        ctx.bufferRow({
            entryKey,
            sourceUrl: canonical,
            startupName: extracted.startupName,
            startupWebsite: extracted.startupWebsite,
            description: extracted.description,
            newsSummary: extracted.newsSummary,
            sourceId: INC42_SOURCE_ID,
            entryStatus: status,
            contentHash,
            discoveredAt: new Date().toISOString(),
        });

        this.markUrlIndex(ctx, canonical, contentHash, ctx.runId, true);
        ctx.urlsNeedingReextract.delete(canonical);
        sourceLog.record(canonical, status, entryKey);
    }

    private markUrlIndex(
        ctx: RunContext,
        url: string,
        contentHash: string,
        runId: string,
        extractionComplete: boolean,
    ): void {
        const rec: UrlContentRecord = {
            contentHash,
            lastSeenAt: new Date().toISOString(),
            lastRunId: runId,
            extractionComplete,
        };
        ctx.urlIndex.set(url, rec);
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
