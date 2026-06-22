import { spawn } from 'child_process';
import { logger } from '../lib/logger';
import type { AgriTechConfig } from '../config/app-config';
import {
    BROWSER_ARGV_HARD_MAX_COUNT,
    BROWSER_ARG_STRING_HARD_MAX_BYTES,
} from '../constants/browser';
import { resolveAgentBrowserJs } from './agent-browser.paths';
import type { ProfileLockService } from './profile-lock.service';

export interface InvokeResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const SNAPSHOT_WITH_URLS_ARGS = ['--urls'] as const;

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

    async waitMs(sessionId: string, profileCwd: string, ms: number): Promise<void> {
        if (ms < 0 || !Number.isFinite(ms)) {
            throw new Error('waitMs requires a non-negative finite number');
        }
        const res = await this.invoke(sessionId, profileCwd, ['wait', String(Math.floor(ms))]);
        if (res.code !== 0) {
            throw new Error(`agent-browser wait failed: ${res.stderr.slice(0, 400)}`);
        }
    }

    async closeSession(sessionId: string, profileCwd: string): Promise<void> {
        const res = await this.invoke(sessionId, profileCwd, ['close']);
        if (res.code !== 0) {
            throw new Error(`agent-browser close failed: ${res.stderr.slice(0, 400)}`);
        }
    }
}
