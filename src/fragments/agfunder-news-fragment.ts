import { BaseFragment } from '../lib/fragment';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import { AGFUNDER_SECTION_SEEDS, AGFUNDER_SOURCE_ID } from '../constants/agfunder';
import { isCompleteExtraction } from '../domain/extraction';
import type { IStartupNewsExtractor } from '../domain/types';
import { computeContentHash, computeNewsEntryId, hashArticleLinkList } from '../domain/dedup';
import type { RunContext, SourceRunLog } from '../domain/run-context';
import type { PageFetchService } from '../integrations/page-fetch.service';
import { agfunderParser } from '../parsers/agfunder.parser';
import type { RunHistoryService } from '../persistence/run-history.service';
import { canonicalizeSourceUrl } from '../utils/url';

const LOG_PREFIX = 'AgfunderNewsFragment';

function countNewRows(ctx: RunContext): number {
    return ctx.rows.filter((r) => r.entryStatus === 'new').length;
}

export class AgfunderNewsFragment extends BaseFragment {
    /** In-process section hash map (replaces SectionSnapshotService for AgFunder). */
    private readonly sectionHashes = new Map<string, string>();

    constructor(
        id: string,
        private readonly appConfig: AgriTechConfig,
        private readonly pageFetch: PageFetchService,
        private readonly extractor: IStartupNewsExtractor | null,
        private readonly runHistory: RunHistoryService,
    ) {
        super(id);
    }

    protected async execute(): Promise<void> {
        if (!this.appConfig.AGRITECH_AGFUNDER_ENABLED) {
            logger.info(`${LOG_PREFIX} disabled via AGRITECH_AGFUNDER_ENABLED=false`);
            return;
        }

        if (this.appConfig.AGRITECH_AI_ENABLED && !this.extractor) {
            logger.warn(`${LOG_PREFIX} skipped — AI enabled but Ollama extractor not configured`);
            return;
        }

        const ctx = this.runHistory.beginRun();
        const sourceLog = ctx.startSourceLog(AGFUNDER_SOURCE_ID);
        const sections = AGFUNDER_SECTION_SEEDS.slice(0, this.appConfig.MAX_SECTIONS_PER_RUN);

        for (const section of sections) {
            sourceLog.sectionsChecked++;
            await this.processSection(section.url, ctx, sourceLog);
        }

        const summary = await this.runHistory.completeRun(ctx);
        logger.info(`${LOG_PREFIX} run complete`, {
            runId: ctx.runId,
            newRows: summary.totals.new,
            updatedRows: summary.totals.updated,
            excelPath: summary.excelPath,
        });
    }

    private async processSection(
        sectionUrl: string,
        ctx: RunContext,
        sourceLog: SourceRunLog,
    ): Promise<void> {
        let listingHtml: string;
        try {
            listingHtml = await this.pageFetch.getPageHtml(sectionUrl);
        } catch (err: unknown) {
            sourceLog.error(sectionUrl, `section_fetch: ${errorMessage(err)}`);
            return;
        }

        const articleLinks = agfunderParser.parseListingLinks(listingHtml, sectionUrl);
        const linkListHash = hashArticleLinkList(articleLinks);
        const prevHash = this.sectionHashes.get(sectionUrl);

        if (prevHash === linkListHash) {
            sourceLog.skipSection(sectionUrl, 'unchanged');
            return;
        }
        this.sectionHashes.set(sectionUrl, linkListHash);

        for (const link of articleLinks) {
            if (sourceLog.articlesScanned >= this.appConfig.MAX_ITEMS_SCANNED_PER_RUN) break;
            if (countNewRows(ctx) >= this.appConfig.MAX_NEW_ROWS_PER_RUN) break;

            sourceLog.articlesScanned++;
            await this.processArticle(link, ctx, sourceLog);
        }
    }

    private async processArticle(
        url: string,
        ctx: RunContext,
        sourceLog: SourceRunLog,
    ): Promise<void> {
        const canonical = canonicalizeSourceUrl(url);

        let articleHtml: string;
        try {
            articleHtml = await this.pageFetch.getPageHtml(canonical);
        } catch (err: unknown) {
            sourceLog.error(canonical, `article_fetch: ${errorMessage(err)}`);
            return;
        }

        const { title, bodyExcerpt } = agfunderParser.parseArticle(articleHtml, this.appConfig.AI_INPUT_MAX_CHARS);
        if (!title) {
            sourceLog.skip(canonical, 'missing_title');
            return;
        }
        if (!bodyExcerpt.trim()) {
            sourceLog.skip(canonical, 'empty_body');
            return;
        }

        const contentHash = computeContentHash(title, bodyExcerpt);
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
            return;
        }

        if (!isCompleteExtraction(extracted)) {
            sourceLog.error(canonical, 'incomplete_extraction');
            return;
        }

        ctx.bufferRow({
            entryKey,
            sourceUrl: canonical,
            startupName: extracted.startupName,
            startupWebsite: extracted.startupWebsite,
            description: extracted.description,
            newsSummary: extracted.newsSummary,
            sourceId: AGFUNDER_SOURCE_ID,
            entryStatus: 'new',
            contentHash,
            discoveredAt: new Date().toISOString(),
        });

        sourceLog.record(canonical, 'new', entryKey);
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
