import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import {
    INC42_ANCHOR_MAX_STEPS,
    INC42_AUTH_STATE_FILE,
    INC42_FEED_IDLE_STEPS,
    INC42_LATEST_NEWS_TEXT,
    INC42_POST_CLICK_RECOVERY_STEPS,
    INC42_READ_MORE_MAX_CLICKS,
    INC42_READ_MORE_SETTLE_MS,
    INC42_READ_MORE_TEXT,
    INC42_SCROLL_MAX_STEPS,
    INC42_SCROLL_SETTLE_MS,
    INC42_SCROLL_STEP_PX,
} from '../constants/inc42-browser';
import { INC42_BROWSER_SESSION } from '../constants/inc42';
import {
    isLatestNewsSectionAnchored,
    mergeNewLinks,
    parseInc42ListingLinksFromSnapshot,
    shouldStopAfterReadMoreClick,
    snapshotIndicatesLoginRequired,
} from '../parsers/inc42-snapshot.parser';
import type { AgentBrowserService } from './agent-browser.service';
import type { PostgresStore } from '../persistence/postgres-store.repository';

export interface Inc42BrowserListingResult {
    articleLinks: string[];
    loginRequired: boolean;
}

/**
 * Fetches Inc42 agritech feed article links via headed agent-browser.
 *
 * Strategy:
 * 1. Anchor at Latest News section; collect initial links.
 * 2. Scroll through the full feed batch (ignore Read More) until no new links.
 * 3. Hunt Read More with additional micro-scrolls if needed; click (max 6).
 * 4. Recover from post-click scroll jump; stop if click adds no new links.
 */
export class Inc42BrowserListingService {
    constructor(
        private readonly config: AgriTechConfig,
        private readonly agentBrowser: AgentBrowserService,
        private readonly postgres: PostgresStore | null,
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
        try {
            await this.agentBrowser.openUrlAndWaitForLoad(sessionId, profileCwd, sectionUrl);

            if (await this.checkLoginRequired(sessionId, profileCwd, sectionUrl)) {
                return { articleLinks: [], loginRequired: true };
            }

            const anchorStepsUsed = await this.anchorAtLatestNewsSection(sessionId, profileCwd, sectionUrl);
            logger.info('Inc42 browser listing anchored at Latest News', { anchorStepsUsed });

            let allCollectedLinks = await this.mergeLinksFromSnapshot(sessionId, profileCwd, []);

            let readMoreClickCount = 0;

            while (readMoreClickCount < INC42_READ_MORE_MAX_CLICKS) {
                allCollectedLinks = await this.scrollFeedAndCollect(sessionId, profileCwd, allCollectedLinks);

                const huntResult = await this.huntReadMoreButton(sessionId, profileCwd, allCollectedLinks);
                allCollectedLinks = huntResult.links;

                if (!huntResult.readMoreVisible) {
                    logger.info('Inc42 browser listing stopping — Read More not found after hunt', {
                        huntSteps: huntResult.huntSteps,
                        feedScrollSteps: huntResult.feedScrollSteps,
                        totalCollected: allCollectedLinks.length,
                    });
                    break;
                }

                const linksBeforeClick = allCollectedLinks.length;

                logger.info('Inc42 browser listing clicking Read More Stories', {
                    clickCount: readMoreClickCount + 1,
                    totalCollected: linksBeforeClick,
                });
                try {
                    await this.agentBrowser.clickByText(sessionId, profileCwd, INC42_READ_MORE_TEXT);
                    await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_READ_MORE_SETTLE_MS);
                    readMoreClickCount++;

                    allCollectedLinks = await this.mergeLinksFromSnapshot(sessionId, profileCwd, allCollectedLinks);

                    allCollectedLinks = await this.recoverAfterReadMoreClick(
                        sessionId,
                        profileCwd,
                        allCollectedLinks,
                    );

                    if (shouldStopAfterReadMoreClick(linksBeforeClick, allCollectedLinks.length)) {
                        logger.warn('Inc42 browser listing stopping — Read More click added no new links', {
                            readMoreClickCount,
                            totalCollected: allCollectedLinks.length,
                        });
                        break;
                    }
                } catch (err) {
                    logger.warn('Inc42 browser listing Read More click failed — continuing with collected links', {
                        readMoreClickCount,
                        collectedLinks: allCollectedLinks.length,
                        err: err instanceof Error ? err.message : String(err),
                    });
                    break;
                }
            }

            const articleLinks = await this.filterKnownUrls(allCollectedLinks);

            logger.info('Inc42 browser listing complete', {
                sectionUrl,
                totalCollected: allCollectedLinks.length,
                freshLinks: articleLinks.length,
                readMoreClicksUsed: readMoreClickCount,
            });
            return { articleLinks, loginRequired: false };
        } finally {
            await this.agentBrowser.closeSession(sessionId, profileCwd).catch(() => undefined);
        }
    }

    /** Micro-scroll until Latest News section is in viewport with article links visible. */
    private async anchorAtLatestNewsSection(
        sessionId: string,
        profileCwd: string,
        sectionUrl: string,
    ): Promise<number> {
        for (let step = 0; step <= INC42_ANCHOR_MAX_STEPS; step++) {
            if (await this.checkLoginRequired(sessionId, profileCwd, sectionUrl)) {
                return step;
            }

            if (await this.isAnchoredAtLatestNews(sessionId, profileCwd)) {
                return step;
            }

            if (step >= INC42_ANCHOR_MAX_STEPS) {
                logger.warn('Inc42 browser listing — Latest News section not anchored within step budget', {
                    anchorStepsUsed: step,
                });
                break;
            }

            await this.agentBrowser.scrollDown(sessionId, profileCwd, INC42_SCROLL_STEP_PX);
            await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_SCROLL_SETTLE_MS);
        }

        return INC42_ANCHOR_MAX_STEPS;
    }

    private async isAnchoredAtLatestNews(sessionId: string, profileCwd: string): Promise<boolean> {
        const interactive = await this.agentBrowser.snapshotInteractive(sessionId, profileCwd);
        const full = await this.agentBrowser.snapshot(sessionId, profileCwd);
        const articleLinkCount = parseInc42ListingLinksFromSnapshot(full).length;
        return isLatestNewsSectionAnchored(interactive, articleLinkCount, INC42_LATEST_NEWS_TEXT);
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

    /**
     * Scroll through the current feed batch, collecting links.
     * Ignores Read More visibility — stops when no new links for INC42_FEED_IDLE_STEPS.
     */
    private async scrollFeedAndCollect(
        sessionId: string,
        profileCwd: string,
        startLinks: string[],
    ): Promise<string[]> {
        let links = [...startLinks];
        let idleScrolls = 0;
        let feedScrollSteps = 0;

        while (feedScrollSteps < INC42_SCROLL_MAX_STEPS) {
            const beforeCount = links.length;
            links = await this.mergeLinksFromSnapshot(sessionId, profileCwd, links);
            const newLinksThisStep = links.length - beforeCount;

            logger.info('Inc42 browser listing feed scroll', {
                feedScrollStep: feedScrollSteps,
                newLinksThisStep,
                totalCollected: links.length,
            });

            if (newLinksThisStep > 0) {
                idleScrolls = 0;
            } else {
                idleScrolls++;
            }

            if (idleScrolls >= INC42_FEED_IDLE_STEPS) {
                logger.info('Inc42 browser listing feed scroll complete — idle threshold reached', {
                    feedScrollSteps,
                    totalCollected: links.length,
                });
                break;
            }

            await this.agentBrowser.scrollDown(sessionId, profileCwd, INC42_SCROLL_STEP_PX);
            await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_SCROLL_SETTLE_MS);
            feedScrollSteps++;
        }

        return links;
    }

    /**
     * After feed scroll, check for Read More; micro-scroll further if not yet visible.
     * Never returns readMoreVisible at huntStep 0 without prior feed scroll in this cycle.
     */
    private async huntReadMoreButton(
        sessionId: string,
        profileCwd: string,
        startLinks: string[],
    ): Promise<{ links: string[]; readMoreVisible: boolean; huntSteps: number; feedScrollSteps: number }> {
        let links = [...startLinks];

        let readMoreVisible = await this.agentBrowser.snapshotContainsVisibleText(
            sessionId,
            profileCwd,
            INC42_READ_MORE_TEXT,
        );

        if (readMoreVisible) {
            logger.info('Inc42 browser listing hunting Read More', {
                huntStep: 0,
                readMoreVisible: true,
                totalCollected: links.length,
                note: 'visible after feed scroll',
            });
            return { links, readMoreVisible: true, huntSteps: 0, feedScrollSteps: 0 };
        }

        let huntSteps = 0;

        while (huntSteps < INC42_SCROLL_MAX_STEPS) {
            links = await this.mergeLinksFromSnapshot(sessionId, profileCwd, links);

            readMoreVisible = await this.agentBrowser.snapshotContainsVisibleText(
                sessionId,
                profileCwd,
                INC42_READ_MORE_TEXT,
            );

            huntSteps++;

            logger.info('Inc42 browser listing hunting Read More', {
                huntStep: huntSteps,
                readMoreVisible,
                totalCollected: links.length,
            });

            if (readMoreVisible) {
                return { links, readMoreVisible: true, huntSteps, feedScrollSteps: 0 };
            }

            await this.agentBrowser.scrollDown(sessionId, profileCwd, INC42_SCROLL_STEP_PX);
            await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_SCROLL_SETTLE_MS);
        }

        return { links, readMoreVisible: false, huntSteps, feedScrollSteps: 0 };
    }

    /** Small scroll-down steps after Read More click to recover from page jump-up. */
    private async recoverAfterReadMoreClick(
        sessionId: string,
        profileCwd: string,
        startLinks: string[],
    ): Promise<string[]> {
        let links = [...startLinks];

        for (let recoveryStep = 1; recoveryStep <= INC42_POST_CLICK_RECOVERY_STEPS; recoveryStep++) {
            await this.agentBrowser.scrollDown(sessionId, profileCwd, INC42_SCROLL_STEP_PX);
            await this.agentBrowser.waitMs(sessionId, profileCwd, INC42_SCROLL_SETTLE_MS);

            const beforeCount = links.length;
            links = await this.mergeLinksFromSnapshot(sessionId, profileCwd, links);
            const newLinks = links.length - beforeCount;

            logger.info('Inc42 browser listing post-click recovery', {
                recoveryStep,
                newLinks,
                totalCollected: links.length,
            });

            if (newLinks > 0) {
                break;
            }
        }

        return links;
    }

    private async checkLoginRequired(
        sessionId: string,
        profileCwd: string,
        sectionUrl: string,
    ): Promise<boolean> {
        const snapshot = await this.agentBrowser.snapshot(sessionId, profileCwd);
        if (snapshotIndicatesLoginRequired(snapshot)) {
            logger.warn('Inc42 session expired or logged out — run: npm run inc42:login (sign in once, then re-run)', {
                profileCwd,
                sectionUrl,
            });
            return true;
        }
        return false;
    }

    private async filterKnownUrls(urls: string[]): Promise<string[]> {
        if (!this.postgres) {
            return urls;
        }
        return this.postgres.filterKnownUrls(urls);
    }
}
