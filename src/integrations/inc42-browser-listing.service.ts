import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import {
    INC42_FEED_SCROLL_CONTAINER_SELECTOR,
    INC42_FEED_SCROLL_ITERATIONS,
    INC42_FEED_SCROLL_SETTLE_MS,
    INC42_FEED_SCROLL_STEP_PX,
} from '../constants/inc42-browser';
import { INC42_BROWSER_SESSION } from '../constants/inc42';
import {
    parseInc42ListingLinksFromSnapshot,
    snapshotIndicatesLoginRequired,
} from '../parsers/inc42-snapshot.parser';
import type { AgentBrowserService } from './agent-browser.service';

export interface Inc42BrowserListingResult {
    articleLinks: string[];
    loginRequired: boolean;
}

/**
 * Fetches Inc42 Datalabs industry feed links via headed agent-browser (login + scroll).
 * Operator must log in manually once into profiles/inc42/browser-data.
 */
export class Inc42BrowserListingService {
    constructor(
        private readonly config: AgriTechConfig,
        private readonly agentBrowser: AgentBrowserService,
    ) {}

    async fetchListingLinks(sectionUrl: string): Promise<Inc42BrowserListingResult> {
        const sessionId = INC42_BROWSER_SESSION;
        const profileCwd = path.resolve(process.cwd(), this.config.AGRITECH_PROFILES_ROOT, sessionId);
        await fs.mkdir(profileCwd, { recursive: true });

        logger.info('Inc42 browser listing fetch', { sectionUrl, sessionId, profileCwd });

        await this.agentBrowser.ensureSessionReady(sessionId, profileCwd);
        try {
            await this.agentBrowser.openUrlAndWaitForLoad(sessionId, profileCwd, sectionUrl);
            await this.scrollFeed(sessionId, profileCwd);
            const snapshot = await this.agentBrowser.snapshot(sessionId, profileCwd);

            if (snapshotIndicatesLoginRequired(snapshot)) {
                logger.warn('Inc42 session appears logged out — log in via headed browser profile', {
                    profileCwd,
                    sectionUrl,
                });
                return { articleLinks: [], loginRequired: true };
            }

            const articleLinks = parseInc42ListingLinksFromSnapshot(snapshot);
            logger.info('Inc42 browser listing complete', { sectionUrl, linkCount: articleLinks.length });
            return { articleLinks, loginRequired: false };
        } finally {
            await this.agentBrowser.closeSession(sessionId, profileCwd).catch(() => undefined);
        }
    }

    private async scrollFeed(sessionId: string, profileCwd: string): Promise<void> {
        const selector = INC42_FEED_SCROLL_CONTAINER_SELECTOR.trim().length > 0
            ? INC42_FEED_SCROLL_CONTAINER_SELECTOR
            : undefined;

        for (let i = 0; i < INC42_FEED_SCROLL_ITERATIONS; i += 1) {
            try {
                await this.agentBrowser.scrollDown(sessionId, profileCwd, INC42_FEED_SCROLL_STEP_PX, selector);
            } catch {
                await this.agentBrowser.scrollDown(sessionId, profileCwd, INC42_FEED_SCROLL_STEP_PX, undefined);
            }
            await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_FEED_SCROLL_SETTLE_MS);
        }
    }
}
