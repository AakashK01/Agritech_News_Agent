import { spawn } from 'child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import {
    INC42_ARTICLE_SETTLE_MS,
    INC42_AUTH_STATE_FILE,
    INC42_READ_MORE_SETTLE_MS,
} from '../constants/inc42-browser';
import {
    BROWSER_ARGV_HARD_MAX_COUNT,
    BROWSER_ARG_STRING_HARD_MAX_BYTES,
} from '../constants/browser';
import { resolveAgentBrowserJs } from './agent-browser.paths';
import type { ProfileLockService } from './profile-lock.service';
import { extractInteractiveRefForQuotedText } from '../parsers/inc42-snapshot.parser';

export interface InvokeResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const SNAPSHOT_WITH_URLS_ARGS = ['--urls'] as const;
const SNAPSHOT_INTERACTIVE_ARGS = ['-i', '--urls'] as const;

export class AgentBrowserService {
    private readonly cliJsPath: string;

    constructor(
        private readonly config: AgriTechConfig,
        private readonly profileLock: ProfileLockService,
        projectRoot: string,
    ) {
        this.cliJsPath = resolveAgentBrowserJs(projectRoot, config.AGENT_BROWSER_CLI_PATH);
    }

    private validateArgv(sessionId: string, agentArgs: string[]): void {
        if (agentArgs.length > this.config.BROWSER_MAX_ARGV_COUNT || agentArgs.length > BROWSER_ARGV_HARD_MAX_COUNT) {
            throw new Error('agent-browser argv count exceeds configured limit');
        }
        const all = [sessionId, ...agentArgs].join(' ');
        if (Buffer.byteLength(all, 'utf8') > this.config.BROWSER_MAX_ARG_STRING_BYTES) {
            throw new Error('agent-browser argv payload exceeds configured byte limit');
        }
        for (const a of agentArgs) {
            if (Buffer.byteLength(a, 'utf8') > BROWSER_ARG_STRING_HARD_MAX_BYTES) {
                throw new Error('agent-browser single arg exceeds hard byte limit');
            }
        }
    }

    async invoke(sessionId: string, profileCwd: string, agentArgs: string[]): Promise<InvokeResult> {
        this.validateArgv(sessionId, agentArgs);
        const argv = ['--session', sessionId, ...agentArgs];
        return this.profileLock.runExclusive(profileCwd, () => this.spawnLocked(profileCwd, argv));
    }

    private spawnLocked(profileCwd: string, argv: string[]): Promise<InvokeResult> {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [this.cliJsPath, ...argv], {
                cwd: profileCwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: process.env,
            });

            let stdout = '';
            let stderr = '';
            const timeoutMs = this.config.BROWSER_COMMAND_TIMEOUT_MS;
            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new Error(`agent-browser timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            child.stdout?.on('data', (d: Buffer) => {
                stdout += d.toString('utf8');
            });
            child.stderr?.on('data', (d: Buffer) => {
                stderr += d.toString('utf8');
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

            child.on('close', (code) => {
                clearTimeout(timer);
                resolve({ code, stdout, stderr });
            });
        });
    }

    async ensureSessionReady(sessionId: string, profileCwd: string): Promise<void> {
        const authStatePath = path.join(profileCwd, INC42_AUTH_STATE_FILE);
        try {
            await fs.access(authStatePath);
            logger.debug('Loading saved auth state before crawl', { authStatePath });
            const loadRes = await this.invoke(sessionId, profileCwd, ['state', 'load', INC42_AUTH_STATE_FILE]);
            if (loadRes.code !== 0) {
                throw new Error(`agent-browser state load failed: ${loadRes.stderr.slice(0, 400)}`);
            }
            return;
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('agent-browser state load failed')) {
                throw err;
            }
            // No saved auth state; warm up browser with about:blank as before.
        }

        const deadline = Date.now() + this.config.BROWSER_READY_TIMEOUT_MS;
        let attempt = 0;
        while (Date.now() < deadline) {
            attempt += 1;
            const res = await this.invoke(sessionId, profileCwd, ['open', 'about:blank']);
            if (res.code === 0) {
                const waitRes = await this.invoke(sessionId, profileCwd, ['wait', '--load', 'networkidle']);
                if (waitRes.code === 0) {
                    return;
                }
                logger.debug('agent-browser wait after about:blank failed', {
                    code: waitRes.code,
                    stderrTail: waitRes.stderr.slice(-200),
                    attempt,
                });
            } else {
                logger.debug('agent-browser open about:blank failed', {
                    code: res.code,
                    stderrTail: res.stderr.slice(-200),
                    attempt,
                });
            }
            await sleep(this.config.BROWSER_READY_POLL_MS);
        }
        throw new Error('Browser session did not become ready within BROWSER_READY_TIMEOUT_MS');
    }

    async openUrlAndWaitForLoad(sessionId: string, profileCwd: string, url: string): Promise<void> {
        const navDeadline = Date.now() + this.config.BROWSER_NAVIGATION_TIMEOUT_MS;
        const openRes = await this.invoke(sessionId, profileCwd, ['open', url]);
        if (openRes.code !== 0) {
            throw new Error(`agent-browser open failed: ${openRes.stderr.slice(0, 400)}`);
        }
        const waitRes = await this.invoke(sessionId, profileCwd, ['wait', '--load', 'networkidle']);
        if (waitRes.code !== 0) {
            if (Date.now() > navDeadline) {
                throw new Error(`agent-browser wait load failed: ${waitRes.stderr.slice(0, 400)}`);
            }
            logger.warn('agent-browser wait networkidle non-zero; continuing', { code: waitRes.code });
        }
    }

    async snapshot(sessionId: string, profileCwd: string): Promise<string> {
        const res = await this.invoke(sessionId, profileCwd, ['snapshot', ...SNAPSHOT_WITH_URLS_ARGS]);
        if (res.code !== 0) {
            throw new Error(`agent-browser snapshot failed: ${res.stderr.slice(0, 400)}`);
        }
        return res.stdout;
    }

    /** Viewport/interactive elements only — use for visibility checks, not link extraction. */
    async snapshotInteractive(sessionId: string, profileCwd: string): Promise<string> {
        const res = await this.invoke(sessionId, profileCwd, ['snapshot', ...SNAPSHOT_INTERACTIVE_ARGS]);
        if (res.code !== 0) {
            throw new Error(`agent-browser interactive snapshot failed: ${res.stderr.slice(0, 400)}`);
        }
        return res.stdout;
    }

    async snapshotContainsVisibleText(sessionId: string, profileCwd: string, text: string): Promise<boolean> {
        const snapshot = await this.snapshotInteractive(sessionId, profileCwd);
        return this.snapshotContainsText(snapshot, text);
    }

    async scrollDown(sessionId: string, profileCwd: string, pixels: number, selector?: string): Promise<void> {
        const px = Math.max(1, Math.floor(pixels));
        const args = ['scroll', 'down', String(px)];
        if (selector !== undefined && selector.trim().length > 0) {
            args.push('--selector', selector.trim());
        }
        const res = await this.invoke(sessionId, profileCwd, args);
        if (res.code !== 0) {
            throw new Error(`agent-browser scroll failed: ${res.stderr.slice(0, 400)}`);
        }
    }

    async scrollUp(sessionId: string, profileCwd: string, pixels: number, selector?: string): Promise<void> {
        const px = Math.max(1, Math.floor(pixels));
        const args = ['scroll', 'up', String(px)];
        if (selector !== undefined && selector.trim().length > 0) {
            args.push('--selector', selector.trim());
        }
        const res = await this.invoke(sessionId, profileCwd, args);
        if (res.code !== 0) {
            throw new Error(`agent-browser scroll up failed: ${res.stderr.slice(0, 400)}`);
        }
    }

    async scrollToTop(sessionId: string, profileCwd: string): Promise<void> {
        for (let i = 0; i < 5; i++) {
            await this.scrollUp(sessionId, profileCwd, 3000);
            await this.waitMs(sessionId, profileCwd, 200);
        }
    }

    /**
     * Scroll down until label text appears in the interactive (viewport) snapshot.
     * Returns true if the text was found, including on the first check without scrolling.
     */
    async scrollUntilTextVisible(
        sessionId: string,
        profileCwd: string,
        text: string,
        maxSteps: number,
        stepPx: number,
        settleMs: number,
    ): Promise<boolean> {
        for (let step = 0; step <= maxSteps; step++) {
            if (await this.snapshotContainsVisibleText(sessionId, profileCwd, text)) {
                return true;
            }
            if (step >= maxSteps) {
                break;
            }
            await this.scrollDown(sessionId, profileCwd, stepPx);
            await this.waitMs(sessionId, profileCwd, settleMs);
        }
        return false;
    }

    async waitMs(sessionId: string, profileCwd: string, ms: number): Promise<void> {
        if (ms < 0 || !Number.isFinite(ms)) {
            throw new Error('waitMs requires a non-negative finite number');
        }
        const res = await this.invoke(sessionId, profileCwd, ['wait', String(Math.floor(ms))]);
        if (res.code !== 0) {
            throw new Error(`agent-browser wait failed: ${res.stderr.slice(0, 400)}`);
        }
    }

    async pressKey(sessionId: string, profileCwd: string, key: string): Promise<void> {
        const res = await this.invoke(sessionId, profileCwd, ['press', key]);
        if (res.code !== 0) {
            throw new Error(`agent-browser press failed: ${res.stderr.slice(0, 400)}`);
        }
    }

    /** Click by visible text without waiting for networkidle (Inc42 SPA buttons). */
    async clickByTextWithoutNetworkIdle(
        sessionId: string,
        profileCwd: string,
        text: string,
        settleMs = 500,
    ): Promise<void> {
        const res = await this.invoke(sessionId, profileCwd, ['find', 'text', text, 'click']);
        if (res.code !== 0) {
            throw new Error(`agent-browser click failed: ${res.stderr.slice(0, 400)}`);
        }
        await this.waitMs(sessionId, profileCwd, settleMs);
    }

    /** Click Read More by @eN ref; falls back to text click if ref is missing. */
    async clickReadMoreButton(
        sessionId: string,
        profileCwd: string,
        interactiveSnapshot: string,
        text: string,
        settleMs = INC42_READ_MORE_SETTLE_MS,
    ): Promise<void> {
        const ref = extractInteractiveRefForQuotedText(interactiveSnapshot, text);
        if (ref) {
            const res = await this.invoke(sessionId, profileCwd, ['click', ref]);
            if (res.code !== 0) {
                logger.warn('Read More ref click failed — falling back to text click', {
                    ref,
                    stderr: res.stderr.slice(0, 200),
                });
                await this.clickByTextWithoutNetworkIdle(sessionId, profileCwd, text, settleMs);
                return;
            }
            await this.waitMs(sessionId, profileCwd, settleMs);
            return;
        }
        await this.clickByTextWithoutNetworkIdle(sessionId, profileCwd, text, settleMs);
    }

    async closeSession(sessionId: string, profileCwd: string): Promise<void> {
        const res = await this.invoke(sessionId, profileCwd, ['close']);
        if (res.code !== 0) {
            throw new Error(`agent-browser close failed: ${res.stderr.slice(0, 400)}`);
        }
    }

    /** Open an article URL in a new tab, switch to it, and wait for the page to settle. */
    async openArticleInNewTab(
        sessionId: string,
        profileCwd: string,
        url: string,
        settleMs = INC42_ARTICLE_SETTLE_MS,
    ): Promise<void> {
        const tabsBefore = await this.getTabCount(sessionId, profileCwd);
        const res = await this.invoke(sessionId, profileCwd, ['tab', 'new', url]);
        if (res.code !== 0) {
            throw new Error(`agent-browser tab new failed: ${res.stderr.slice(0, 400)}`);
        }

        const tabsAfter = await this.getTabCount(sessionId, profileCwd);
        if (tabsAfter > tabsBefore) {
            await this.switchToTab(sessionId, profileCwd, tabsAfter - 1);
        }

        await this.waitMs(sessionId, profileCwd, settleMs);
    }

    /**
     * Close the article tab without closing the listing tab.
     * Never closes when only one tab remains — avoids killing the browser session.
     */
    async closeArticleTab(sessionId: string, profileCwd: string): Promise<void> {
        const tabCount = await this.getTabCount(sessionId, profileCwd);
        if (tabCount <= 1) {
            return;
        }

        const articleTabIndex = tabCount - 1;
        await this.switchToTab(sessionId, profileCwd, articleTabIndex);
        const closeRes = await this.invoke(sessionId, profileCwd, ['tab', 'close']);
        if (closeRes.code !== 0) {
            logger.warn('agent-browser tab close failed — leaving session open', {
                code: closeRes.code,
                stderr: closeRes.stderr.slice(0, 200),
            });
            return;
        }

        await this.switchToTab(sessionId, profileCwd, 0).catch(() => undefined);
    }

    private async getTabCount(sessionId: string, profileCwd: string): Promise<number> {
        const res = await this.invoke(sessionId, profileCwd, ['tab', 'list', '--json']);
        if (res.code !== 0) {
            return 1;
        }

        try {
            const parsed = JSON.parse(res.stdout.trim()) as unknown;
            if (Array.isArray(parsed)) {
                return parsed.length;
            }
            if (parsed && typeof parsed === 'object') {
                const tabs = (parsed as { tabs?: unknown[] }).tabs;
                if (Array.isArray(tabs)) {
                    return tabs.length;
                }
                const count = (parsed as { count?: number }).count;
                if (typeof count === 'number' && count > 0) {
                    return count;
                }
            }
        } catch {
            // Fall through to default.
        }

        return 1;
    }

    private async switchToTab(sessionId: string, profileCwd: string, index: number): Promise<void> {
        const res = await this.invoke(sessionId, profileCwd, ['tab', String(index)]);
        if (res.code !== 0) {
            throw new Error(`agent-browser tab switch failed: ${res.stderr.slice(0, 400)}`);
        }
    }

    /** @deprecated Use closeArticleTab — closing the only tab kills the browser. */
    async closeCurrentTab(sessionId: string, profileCwd: string): Promise<void> {
        await this.closeArticleTab(sessionId, profileCwd);
    }

    /** Click an element by its visible text label, then wait for the page to settle. */
    async clickByText(sessionId: string, profileCwd: string, text: string): Promise<void> {
        const res = await this.invoke(sessionId, profileCwd, ['find', 'text', text, 'click']);
        if (res.code !== 0) {
            throw new Error(`agent-browser click failed: ${res.stderr.slice(0, 400)}`);
        }
        const waitRes = await this.invoke(sessionId, profileCwd, ['wait', '--load', 'networkidle']);
        if (waitRes.code !== 0) {
            logger.warn('agent-browser wait after click non-zero; continuing', { code: waitRes.code });
        }
    }

    /** Returns true if the given label text appears anywhere in the snapshot string. */
    snapshotContainsText(snapshot: string, label: string): boolean {
        return snapshot.toLowerCase().includes(label.toLowerCase());
    }
}
