import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import {
    INC42_AUTH_STATE_FILE,
    INC42_LATEST_NEWS_TEXT,
    INC42_READ_MORE_TEXT,
    INC42_SCROLL_MAX_STEPS,
    INC42_SCROLL_SETTLE_MS,
    INC42_SCROLL_STEP_PX,
} from '../constants/inc42-browser';
import { INC42_BROWSER_SESSION } from '../constants/inc42';
import {
    mergeNewLinks,
    parseInc42ListingLinksFromSnapshot,
    snapshotIndicatesLoginRequired,
} from '../parsers/inc42-snapshot.parser';
import type { AgentBrowserService } from './agent-browser.service';

export interface Inc42BrowserListingResult {
    articleLinks: string[];
    loginRequired: boolean;
}

/**
 * Fetches Inc42 agritech feed article links via headed agent-browser.
 *
 * Simple loop (max 12 scrolls, max 7 Read More clicks):
 * 1. Open page, activate Latest News tab.
 * 2. Each step: small scroll → wait → extract links → always try Read More click.
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

        const authStatePath = path.join(profileCwd, INC42_AUTH_STATE_FILE);
        try {
            await fs.access(authStatePath);
        } catch {
            throw new Error(
                'inc42_auth_missing — run: npm run inc42:login (Google sign-in, press Enter to save session, then re-run)',
            );
        }

        await this.agentBrowser.ensureSessionReady(sessionId, profileCwd);
        await this.agentBrowser.openUrlAndWaitForLoad(sessionId, profileCwd, sectionUrl);

        if (await this.checkLoginRequired(sessionId, profileCwd, sectionUrl)) {
            return { articleLinks: [], loginRequired: true };
        }

        await this.activateLatestNewsTab(sessionId, profileCwd, sectionUrl);

        let allCollectedLinks: string[] = [];
        let readMoreAttempts = 0;
        let readMoreSuccessfulClicks = 0;

        for (let scrollStep = 0; scrollStep < INC42_SCROLL_MAX_STEPS; scrollStep++) {
            if (await this.checkLoginRequired(sessionId, profileCwd, sectionUrl)) {
                break;
            }

            await this.agentBrowser.scrollDown(sessionId, profileCwd, INC42_SCROLL_STEP_PX);
            await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_SCROLL_SETTLE_MS);

            allCollectedLinks = await this.mergeLinksFromSnapshot(sessionId, profileCwd, allCollectedLinks);

            readMoreAttempts++;
            const linksBeforeClick = allCollectedLinks.length;
            logger.info('Inc42 browser listing attempting Read More Stories', {
                scrollStep,
                attempt: readMoreAttempts,
                successfulClicks: readMoreSuccessfulClicks,
                totalCollected: linksBeforeClick,
            });
            try {
                const interactive = await this.agentBrowser.snapshotInteractive(sessionId, profileCwd);
                await this.agentBrowser.clickReadMoreButton(
                    sessionId,
                    profileCwd,
                    interactive,
                    INC42_READ_MORE_TEXT,
                );
                allCollectedLinks = await this.mergeLinksFromSnapshot(
                    sessionId,
                    profileCwd,
                    allCollectedLinks,
                );
                const newLinks = allCollectedLinks.length - linksBeforeClick;
                if (newLinks > 0) {
                    readMoreSuccessfulClicks++;
                }
                logger.info('Inc42 browser listing Read More click complete', {
                    scrollStep,
                    readMoreAttempts,
                    readMoreSuccessfulClicks,
                    newLinks,
                    totalCollected: allCollectedLinks.length,
                });
            } catch (err) {
                logger.warn('Inc42 browser listing Read More click failed — continuing scroll', {
                    scrollStep,
                    readMoreAttempts,
                    err: err instanceof Error ? err.message : String(err),
                });
            }

            logger.info('Inc42 browser listing scroll', {
                scrollStep,
                readMoreAttempts,
                readMoreSuccessfulClicks,
                totalCollected: allCollectedLinks.length,
            });
        }

        logger.info('Inc42 browser listing complete', {
            sectionUrl,
            totalCollected: allCollectedLinks.length,
            readMoreAttempts,
            readMoreSuccessfulClicks,
        });
        return { articleLinks: allCollectedLinks, loginRequired: false };
    }

    /** Select the Latest News tab so feed content (not Overview teasers) is active. */
    private async activateLatestNewsTab(
        sessionId: string,
        profileCwd: string,
        sectionUrl: string,
    ): Promise<void> {
        logger.info('Inc42 browser listing activating Latest News tab');
        await this.agentBrowser.scrollToTop(sessionId, profileCwd);
        await this.agentBrowser.clickByText(sessionId, profileCwd, INC42_LATEST_NEWS_TEXT);
        await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_SCROLL_SETTLE_MS);

        if (await this.checkLoginRequired(sessionId, profileCwd, sectionUrl)) {
            throw new Error('inc42_login_required after Latest News tab activation');
        }
    }

    private async mergeLinksFromSnapshot(
        sessionId: string,
        profileCwd: string,
        existing: string[],
    ): Promise<string[]> {
        const snapshot = await this.agentBrowser.snapshot(sessionId, profileCwd);
        const pageLinks = parseInc42ListingLinksFromSnapshot(snapshot);
        return mergeNewLinks(existing, pageLinks).merged;
    }

    private async checkLoginRequired(
        sessionId: string,
        profileCwd: string,
        sectionUrl: string,
    ): Promise<boolean> {
        const snapshot = await this.agentBrowser.snapshot(sessionId, profileCwd);
        if (!snapshotIndicatesLoginRequired(snapshot)) {
            return false;
        }

        logger.warn('Inc42 session expired or logged out — run: npm run inc42:login (sign in once, then re-run)', {
            profileCwd,
            sectionUrl,
        });
        return true;
    }
}
