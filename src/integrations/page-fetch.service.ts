import fs from 'node:fs/promises';
import path from 'node:path';
import { PAGE_FETCH_MIN_HTML_BYTES, HTTP_USER_AGENT } from '../constants/app';
import { AGFUNDER_BROWSER_SESSION } from '../constants/agfunder';
import type { AgriTechConfig } from '../config/app-config';
import { logger } from '../lib/logger';
import { snapshotToMinimalHtml } from '../parsers/snapshot/a11y-tree';
import type { AgentBrowserService } from './agent-browser.service';

/**
 * Fetches page HTML — HTTP first, optional agent-browser fallback for JS-rendered pages.
 * Parsers receive HTML regardless of fetch method.
 */
export class PageFetchService {
    constructor(
        private readonly config: AgriTechConfig,
        private readonly agentBrowser: AgentBrowserService | null,
    ) {}

    async getPageHtml(url: string, sessionId = AGFUNDER_BROWSER_SESSION): Promise<string> {
        const html = await this.httpGet(url);
        if (!this.needsBrowserFallback(html)) {
            return html;
        }
        if (!this.config.AGRITECH_BROWSER_FALLBACK_ENABLED || !this.agentBrowser) {
            logger.debug('Browser fallback skipped', { url, bytes: html.length });
            return html;
        }
        return this.browserGet(url, sessionId);
    }

    private async httpGet(url: string): Promise<string> {
        const signal = AbortSignal.timeout(this.config.HTTP_FETCH_TIMEOUT_MS);
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': HTTP_USER_AGENT,
            },
            signal,
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} fetching ${url}`);
        }
        const text = await res.text();
        logger.debug('HTTP fetch ok', { url, bytes: text.length });
        return text;
    }

    private needsBrowserFallback(html: string): boolean {
        return html.length < PAGE_FETCH_MIN_HTML_BYTES;
    }

    private async browserGet(url: string, sessionId: string): Promise<string> {
        if (!this.agentBrowser) {
            throw new Error('Agent browser not configured');
        }
        const profileCwd = path.resolve(process.cwd(), this.config.AGRITECH_PROFILES_ROOT, sessionId);
        await fs.mkdir(profileCwd, { recursive: true });

        logger.info('Using agent-browser fallback', { url, sessionId });
        await this.agentBrowser.ensureSessionReady(sessionId, profileCwd);
        try {
            await this.agentBrowser.openUrlAndWaitForLoad(sessionId, profileCwd, url);
            const snapshot = await this.agentBrowser.snapshot(sessionId, profileCwd);
            return snapshotToMinimalHtml(snapshot);
        } finally {
            await this.agentBrowser.closeSession(sessionId, profileCwd).catch(() => undefined);
        }
    }
}
